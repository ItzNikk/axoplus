'use strict';

/**
 * StorageManager — Full IndexedDB layer for Vitalux v2
 * Stores: steps, weight, calories, profile, goals, streaks
 */
const StorageManager = (() => {
  const DB_NAME    = 'VitaluxV2';
  const DB_VERSION = 3;
  const S = { STEPS:'steps', WEIGHT:'weight', CALORIES:'calories', PROFILE:'profile', GOALS:'goals' };
  let db = null;

  // ── Open DB ──────────────────────────────────────────────────────────────────
  function open() {
    return new Promise((res, rej) => {
      if (db) return res(db);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = ({ target }) => {
        const d = target.result;
        if (!d.objectStoreNames.contains(S.STEPS))
          d.createObjectStore(S.STEPS, { keyPath:'date' });
        if (!d.objectStoreNames.contains(S.WEIGHT)) {
          const ws = d.createObjectStore(S.WEIGHT, { keyPath:'id', autoIncrement:true });
          ws.createIndex('date','date',{unique:false});
        }
        if (!d.objectStoreNames.contains(S.CALORIES))
          d.createObjectStore(S.CALORIES, { keyPath:'date' });
        if (!d.objectStoreNames.contains(S.PROFILE))
          d.createObjectStore(S.PROFILE, { keyPath:'id' });
        if (!d.objectStoreNames.contains(S.GOALS))
          d.createObjectStore(S.GOALS, { keyPath:'id' });
      };
      req.onsuccess  = e => { db = e.target.result; res(db); };
      req.onerror    = e => rej(e.target.error);
    });
  }

  // ── Primitives ───────────────────────────────────────────────────────────────
  const tx = (store, mode='readonly') => db.transaction(store, mode).objectStore(store);
  const get    = (s, k)  => new Promise((r,j) => { const q=tx(s).get(k);    q.onsuccess=()=>r(q.result||null); q.onerror=()=>j(q.error); });
  const put    = (s, v)  => new Promise((r,j) => { const q=tx(s,'readwrite').put(v); q.onsuccess=()=>r(q.result); q.onerror=()=>j(q.error); });
  const getAll = (s)     => new Promise((r,j) => { const q=tx(s).getAll();   q.onsuccess=()=>r(q.result||[]); q.onerror=()=>j(q.error); });
  const clear  = (s)     => new Promise((r,j) => { const q=tx(s,'readwrite').clear(); q.onsuccess=()=>r(); q.onerror=()=>j(q.error); });

  // ── Date utils ───────────────────────────────────────────────────────────────
  function today() { return fmt(new Date()); }
  function fmt(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function daysAgo(n) { const d=new Date(); d.setDate(d.getDate()-n); return d; }
  function dateRange(days) {
    return Array.from({length:days},(_,i)=>fmt(daysAgo(days-1-i)));
  }

  // ── Steps ────────────────────────────────────────────────────────────────────
  async function getTodaySteps() {
    await open(); const r=await get(S.STEPS,today()); return r?r.count:0;
  }
  async function saveTodaySteps(count) {
    await open(); await put(S.STEPS,{date:today(),count,ts:Date.now()});
  }
  async function getStepsHistory(days=7) {
    await open();
    const dates = dateRange(days);
    const recs  = await Promise.all(dates.map(d=>get(S.STEPS,d)));
    return dates.map((date,i)=>({date, count:recs[i]?recs[i].count:0}));
  }

  // ── Weight ───────────────────────────────────────────────────────────────────
  async function addWeightEntry(value, unit='kg') {
    await open();
    // Remove existing entry for today
    const all = await getAll(S.WEIGHT);
    const existing = all.find(e=>e.date===today());
    if (existing) {
      await new Promise((r,j)=>{
        const q=tx(S.WEIGHT,'readwrite').delete(existing.id);
        q.onsuccess=r; q.onerror=j;
      });
    }
    await put(S.WEIGHT,{date:today(),value,unit,ts:Date.now()});
  }
  async function getWeightHistory(days=30) {
    await open();
    const all    = await getAll(S.WEIGHT);
    const cutoff = daysAgo(days);
    const dedup  = {};
    all.forEach(e=>{ if(new Date(e.date)>=cutoff) dedup[e.date]=e; });
    return Object.values(dedup).sort((a,b)=>new Date(a.date)-new Date(b.date));
  }
  async function getWeightTrend() {
    const h = await getWeightHistory(14);
    if (h.length<2) return { direction:'stable', delta:0, latest: null };
    const first=h[0].value, last=h[h.length-1].value;
    const delta=+(last-first).toFixed(2);
    return { direction: delta>0.2?'gaining':delta<-0.2?'losing':'stable', delta, latest:last };
  }

  // ── Calories ─────────────────────────────────────────────────────────────────
  async function getTodayCalories() {
    await open(); const r=await get(S.CALORIES,today());
    return r||{date:today(),intake:0,burned:0};
  }
  async function saveTodayCalories(data) {
    await open(); await put(S.CALORIES,{date:today(),...data,ts:Date.now()});
  }
  async function getCaloriesHistory(days=7) {
    await open();
    const dates = dateRange(days);
    const recs  = await Promise.all(dates.map(d=>get(S.CALORIES,d)));
    return dates.map((date,i)=>({date, intake:recs[i]?recs[i].intake:0, burned:recs[i]?recs[i].burned:0}));
  }

  // ── Profile ──────────────────────────────────────────────────────────────────
  async function getProfile() { await open(); return await get(S.PROFILE,1); }
  async function saveProfile(p) { await open(); await put(S.PROFILE,{id:1,...p}); }

  // ── Goals ────────────────────────────────────────────────────────────────────
  async function getGoals() {
    await open();
    const g = await get(S.GOALS,1);
    return g || { id:1, stepGoal:8000, calorieGoal:2000, weightGoal:null };
  }
  async function saveGoals(g) { await open(); await put(S.GOALS,{id:1,...g}); }

  // ── Streak ───────────────────────────────────────────────────────────────────
  async function calculateStreak() {
    const goals   = await getGoals();
    const goal    = goals.stepGoal || 8000;
    const history = await getStepsHistory(30);
    let streak    = 0;
    // Walk backwards; skip today if count=0 (day just started)
    for (let i=history.length-1; i>=0; i--) {
      const { count, date } = history[i];
      if (count >= goal) {
        streak++;
      } else if (date === today() && count === 0) {
        continue; // day hasn't started yet
      } else {
        break;
      }
    }
    return streak;
  }

  // ── Weekly insights ───────────────────────────────────────────────────────────
  async function getWeeklyInsights() {
    const [stepsHist, calHist, weightTrend] = await Promise.all([
      getStepsHistory(14), getCaloriesHistory(14), getWeightTrend()
    ]);
    const thisWeek = stepsHist.slice(7);
    const lastWeek = stepsHist.slice(0,7);
    const thisTotal = thisWeek.reduce((s,d)=>s+d.count,0);
    const lastTotal = lastWeek.reduce((s,d)=>s+d.count,0);
    const stepChange = lastTotal > 0 ? ((thisTotal-lastTotal)/lastTotal*100).toFixed(0) : 0;

    const thisCalAvg = calHist.slice(7).reduce((s,d)=>s+(d.intake||0),0) / 7;
    const lastCalAvg = calHist.slice(0,7).reduce((s,d)=>s+(d.intake||0),0) / 7;

    return {
      thisWeekSteps: thisTotal,
      lastWeekSteps: lastTotal,
      stepChangePercent: Number(stepChange),
      avgCaloriesThisWeek: Math.round(thisCalAvg),
      avgCaloriesLastWeek: Math.round(lastCalAvg),
      weightTrend,
      activeDaysThisWeek: thisWeek.filter(d=>d.count>2000).length
    };
  }

  // ── Export ────────────────────────────────────────────────────────────────────
  async function exportAllData() {
    await open();
    const [steps,weight,calories,profile,goals] = await Promise.all([
      getAll(S.STEPS), getAll(S.WEIGHT), getAll(S.CALORIES),
      get(S.PROFILE,1), get(S.GOALS,1)
    ]);
    return JSON.stringify({ exportedAt:new Date().toISOString(), steps, weight, calories, profile, goals }, null, 2);
  }

  // ── Clear all ────────────────────────────────────────────────────────────────
  async function clearAll() {
    await open();
    await Promise.all(Object.values(S).map(s=>clear(s)));
    localStorage.clear();
  }

  return {
    init: open, today, fmt, daysAgo,
    getTodaySteps, saveTodaySteps, getStepsHistory,
    addWeightEntry, getWeightHistory, getWeightTrend,
    getTodayCalories, saveTodayCalories, getCaloriesHistory,
    getProfile, saveProfile,
    getGoals, saveGoals,
    calculateStreak, getWeeklyInsights,
    exportAllData, clearAll
  };
})();
