'use strict';

/**
 * StorageManager v3 — Full IndexedDB layer
 * Stores: steps, weight, calories, profile, goals, water, sleep, meals, measurements, achievements
 */
const StorageManager = (() => {
  const DB_NAME='VitaluxV3', DB_VER=4;
  const S={
    STEPS:'steps', WEIGHT:'weight', CALORIES:'calories',
    PROFILE:'profile', GOALS:'goals', WATER:'water',
    SLEEP:'sleep', MEALS:'meals', MEASUREMENTS:'measurements'
  };
  let db=null;

  function open(){
    return new Promise((res,rej)=>{
      if(db) return res(db);
      const req=indexedDB.open(DB_NAME,DB_VER);
      req.onupgradeneeded=({target})=>{
        const d=target.result;
        const ensure=(name,opts={})=>{ if(!d.objectStoreNames.contains(name)) d.createObjectStore(name,opts); return d.transaction; };
        ensure(S.STEPS,   {keyPath:'date'});
        ensure(S.WATER,   {keyPath:'date'});
        ensure(S.SLEEP,   {keyPath:'date'});
        ensure(S.CALORIES,{keyPath:'date'});
        ensure(S.MEALS,   {keyPath:'date'});
        ensure(S.PROFILE, {keyPath:'id'});
        ensure(S.GOALS,   {keyPath:'id'});
        if(!d.objectStoreNames.contains(S.WEIGHT)){
          const ws=d.createObjectStore(S.WEIGHT,{keyPath:'id',autoIncrement:true});
          ws.createIndex('date','date',{unique:false});
        }
        if(!d.objectStoreNames.contains(S.MEASUREMENTS)){
          const ms=d.createObjectStore(S.MEASUREMENTS,{keyPath:'id',autoIncrement:true});
          ms.createIndex('date','date',{unique:false});
        }
      };
      req.onsuccess=e=>{db=e.target.result;res(db);};
      req.onerror=e=>rej(e.target.error);
    });
  }

  const tx=(s,m='readonly')=>db.transaction(s,m).objectStore(s);
  const iget  =(s,k)=>new Promise((r,j)=>{const q=tx(s).get(k);      q.onsuccess=()=>r(q.result||null);q.onerror=()=>j(q.error);});
  const iput  =(s,v)=>new Promise((r,j)=>{const q=tx(s,'readwrite').put(v); q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error);});
  const iall  =(s)  =>new Promise((r,j)=>{const q=tx(s).getAll();    q.onsuccess=()=>r(q.result||[]);q.onerror=()=>j(q.error);});
  const iclear=(s)  =>new Promise((r,j)=>{const q=tx(s,'readwrite').clear();q.onsuccess=()=>r();q.onerror=()=>j(q.error);});
  const idel  =(s,k)=>new Promise((r,j)=>{const q=tx(s,'readwrite').delete(k);q.onsuccess=()=>r();q.onerror=()=>j(q.error);});

  // ── Date utils ───────────────────────────────────────────────────────────────
  function today(){return fmt(new Date());}
  function fmt(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
  function daysAgo(n){const d=new Date();d.setDate(d.getDate()-n);return d;}
  function range(days){return Array.from({length:days},(_,i)=>fmt(daysAgo(days-1-i)));}

  // ── Steps ────────────────────────────────────────────────────────────────────
  async function getTodaySteps(){await open();const r=await iget(S.STEPS,today());return r?r.count:0;}
  async function saveTodaySteps(count){await open();await iput(S.STEPS,{date:today(),count,ts:Date.now()});}
  async function getStepsHistory(days=7){
    await open();
    const dates=range(days);
    const recs=await Promise.all(dates.map(d=>iget(S.STEPS,d)));
    return dates.map((date,i)=>({date,count:recs[i]?recs[i].count:0}));
  }

  // ── Weight ───────────────────────────────────────────────────────────────────
  async function addWeightEntry(value,unit='kg'){
    await open();
    const all=await iall(S.WEIGHT);
    const ex=all.find(e=>e.date===today());
    if(ex) await idel(S.WEIGHT,ex.id);
    await iput(S.WEIGHT,{date:today(),value,unit,ts:Date.now()});
  }
  async function getWeightHistory(days=30){
    await open();
    const all=await iall(S.WEIGHT);
    const cut=daysAgo(days);
    const map={};
    all.filter(e=>new Date(e.date)>=cut).forEach(e=>map[e.date]=e);
    return Object.values(map).sort((a,b)=>new Date(a.date)-new Date(b.date));
  }
  async function getWeightTrend(){
    const h=await getWeightHistory(14);
    if(h.length<2) return {direction:'stable',delta:0,latest:null};
    const d=+(h[h.length-1].value-h[0].value).toFixed(2);
    return {direction:d>0.2?'gaining':d<-0.2?'losing':'stable',delta:d,latest:h[h.length-1].value};
  }

  // ── Calories ─────────────────────────────────────────────────────────────────
  async function getTodayCalories(){await open();return await iget(S.CALORIES,today())||{date:today(),intake:0,burned:0};}
  async function saveTodayCalories(data){await open();await iput(S.CALORIES,{date:today(),...data,ts:Date.now()});}
  async function getCaloriesHistory(days=7){
    await open();
    const dates=range(days);
    const recs=await Promise.all(dates.map(d=>iget(S.CALORIES,d)));
    return dates.map((date,i)=>({date,intake:recs[i]?recs[i].intake:0,burned:recs[i]?recs[i].burned:0}));
  }

  // ── Meals ────────────────────────────────────────────────────────────────────
  async function getTodayMeals(){
    await open();
    return await iget(S.MEALS,today())||{date:today(),breakfast:0,lunch:0,dinner:0,snacks:0};
  }
  async function saveTodayMeals(data){await open();await iput(S.MEALS,{date:today(),...data,ts:Date.now()});}

  // ── Water ────────────────────────────────────────────────────────────────────
  async function getTodayWater(){await open();const r=await iget(S.WATER,today());return r?r.ml:0;}
  async function saveTodayWater(ml){await open();await iput(S.WATER,{date:today(),ml,ts:Date.now()});}
  async function getWaterHistory(days=7){
    await open();
    const dates=range(days);
    const recs=await Promise.all(dates.map(d=>iget(S.WATER,d)));
    return dates.map((date,i)=>({date,ml:recs[i]?recs[i].ml:0}));
  }

  // ── Sleep ────────────────────────────────────────────────────────────────────
  async function getTodaySleep(){await open();return await iget(S.SLEEP,today())||{date:today(),hours:0,quality:0};}
  async function saveSleep(hours,quality){await open();await iput(S.SLEEP,{date:today(),hours,quality,ts:Date.now()});}
  async function getSleepHistory(days=7){
    await open();
    const dates=range(days);
    const recs=await Promise.all(dates.map(d=>iget(S.SLEEP,d)));
    return dates.map((date,i)=>({date,hours:recs[i]?recs[i].hours:0,quality:recs[i]?recs[i].quality:0}));
  }

  // ── Measurements ──────────────────────────────────────────────────────────────
  async function addMeasurement(data){await open();await iput(S.MEASUREMENTS,{date:today(),...data,ts:Date.now()});}
  async function getMeasurements(days=30){
    await open();
    const all=await iall(S.MEASUREMENTS);
    const cut=daysAgo(days);
    return all.filter(e=>new Date(e.date)>=cut).sort((a,b)=>new Date(a.date)-new Date(b.date));
  }

  // ── Profile ──────────────────────────────────────────────────────────────────
  async function getProfile(){await open();return await iget(S.PROFILE,1);}
  async function saveProfile(p){await open();await iput(S.PROFILE,{id:1,...p});}

  // ── Goals ────────────────────────────────────────────────────────────────────
  async function getGoals(){
    await open();
    return await iget(S.GOALS,1)||{id:1,stepGoal:8000,calorieGoal:2000,waterGoal:2500,sleepGoal:8,weightGoal:null};
  }
  async function saveGoals(g){await open();await iput(S.GOALS,{id:1,...g});}

  // ── Streak ───────────────────────────────────────────────────────────────────
  async function calculateStreak(){
    const goals=await getGoals();
    const sg=goals.stepGoal||8000;
    const hist=await getStepsHistory(30);
    let streak=0;
    for(let i=hist.length-1;i>=0;i--){
      const {count,date}=hist[i];
      if(count>=sg) streak++;
      else if(date===today()&&count===0) continue;
      else break;
    }
    return streak;
  }

  // ── Personal Records ─────────────────────────────────────────────────────────
  async function getPersonalRecords(){
    const stepsHist=await getStepsHistory(90);
    const weightHist=await getWeightHistory(90);
    const allSteps=stepsHist.filter(d=>d.count>0);
    const bestStep=allSteps.length?allSteps.reduce((a,b)=>b.count>a.count?b:a):null;
    const streak=await calculateStreak();

    // longest streak ever
    let maxStreak=0,cur=0;
    const goals=await getGoals();
    const sg=goals.stepGoal||8000;
    for(const d of stepsHist){
      if(d.count>=sg) cur++;
      else cur=0;
      if(cur>maxStreak) maxStreak=cur;
    }

    return {
      bestStepDay: bestStep,
      longestStreak: maxStreak,
      currentStreak: streak,
      minWeight: weightHist.length?weightHist.reduce((a,b)=>b.value<a.value?b:a):null,
      maxWeight: weightHist.length?weightHist.reduce((a,b)=>b.value>a.value?b:a):null,
    };
  }

  // ── Achievements ──────────────────────────────────────────────────────────────
  async function getAchievements(){
    const [streak,records,stepsHist,goals]=await Promise.all([
      calculateStreak(),getPersonalRecords(),getStepsHistory(30),getGoals()
    ]);
    const totalSteps=stepsHist.reduce((a,d)=>a+d.count,0);
    const sg=goals.stepGoal||8000;
    const activeDays=stepsHist.filter(d=>d.count>=sg).length;

    const all=[
      {id:'first_step',  icon:'👟', name:'First Step',       desc:'Log your first step',         unlocked:totalSteps>0},
      {id:'goal_hit',    icon:'🎯', name:'Goal Getter',      desc:'Hit daily step goal',          unlocked:activeDays>=1},
      {id:'week_warrior',icon:'🔥', name:'Week Warrior',     desc:'7-day streak',                 unlocked:records.longestStreak>=7},
      {id:'month_strong',icon:'💪', name:'Month Strong',     desc:'30 days active',               unlocked:activeDays>=30},
      {id:'marathon',    icon:'🏅', name:'Marathon',         desc:'10,000 steps in a day',        unlocked:records.bestStepDay?records.bestStepDay.count>=10000:false},
      {id:'ultra',       icon:'🏆', name:'Ultra Walker',     desc:'20,000 steps in a day',        unlocked:records.bestStepDay?records.bestStepDay.count>=20000:false},
      {id:'hydrated',    icon:'💧', name:'Hydration Hero',   desc:'Hit water goal 3 days',        unlocked:false}, // simplified
      {id:'sleeper',     icon:'😴', name:'Sleep Champion',   desc:'Log 8h sleep 3 days',          unlocked:false},
      {id:'consistent',  icon:'⚡', name:'Consistency King', desc:'Active 5+ days this week',     unlocked:stepsHist.slice(-7).filter(d=>d.count>=sg).length>=5},
      {id:'century',     icon:'💯', name:'Century',          desc:'100,000 total steps',          unlocked:totalSteps>=100000},
    ];
    return all;
  }

  // ── Weekly Insights ───────────────────────────────────────────────────────────
  async function getWeeklyInsights(){
    const [sh,ch,wt]=await Promise.all([getStepsHistory(14),getCaloriesHistory(14),getWeightTrend()]);
    const tw=sh.slice(7),lw=sh.slice(0,7);
    const tt=tw.reduce((s,d)=>s+d.count,0);
    const lt=lw.reduce((s,d)=>s+d.count,0);
    const stepChange=lt>0?+((tt-lt)/lt*100).toFixed(0):0;
    const cAvg=ch.slice(7).reduce((s,d)=>s+(d.intake||0),0)/7;
    return {
      thisWeekSteps:tt,lastWeekSteps:lt,stepChangePercent:stepChange,
      avgCaloriesThisWeek:Math.round(cAvg),
      activeDaysThisWeek:tw.filter(d=>d.count>2000).length,
      weightTrend:wt
    };
  }

  // ── Export / Clear ────────────────────────────────────────────────────────────
  async function exportAllData(){
    await open();
    const [steps,weight,calories,water,sleep,meals,meas,profile,goals]=await Promise.all([
      iall(S.STEPS),iall(S.WEIGHT),iall(S.CALORIES),iall(S.WATER),iall(S.SLEEP),
      iall(S.MEALS),iall(S.MEASUREMENTS),iget(S.PROFILE,1),iget(S.GOALS,1)
    ]);
    return JSON.stringify({exportedAt:new Date().toISOString(),steps,weight,calories,water,sleep,meals,measurements:meas,profile,goals},null,2);
  }
  async function clearAll(){
    await open();
    await Promise.all(Object.values(S).map(s=>iclear(s)));
    localStorage.clear();
  }

  return {
    init:open, today, fmt, daysAgo,
    getTodaySteps,saveTodaySteps,getStepsHistory,
    addWeightEntry,getWeightHistory,getWeightTrend,
    getTodayCalories,saveTodayCalories,getCaloriesHistory,
    getTodayMeals,saveTodayMeals,
    getTodayWater,saveTodayWater,getWaterHistory,
    getTodaySleep,saveSleep,getSleepHistory,
    addMeasurement,getMeasurements,
    getProfile,saveProfile,
    getGoals,saveGoals,
    calculateStreak,getPersonalRecords,getAchievements,getWeeklyInsights,
    exportAllData,clearAll
  };
})();
