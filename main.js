'use strict';

/**
 * Vitalux v3 — Main Application Controller
 *
 * Tabs: Home · Steps · Nutrition · Weight · AI Coach · Summary · Settings
 * Navigation: Physics-based swipe + tap bottom nav
 * Features: Streaks, Goals, Light/Dark mode, Install prompt, Export, Reset
 * NEW: Fixed resume/pause, motion permission on first start, refined step logic
 */
const App = (() => {

  // ── App state ──────────────────────────────────────────────────────────
  let profile   = null;
  let goals     = null;
  let calData   = { intake:0, burned:0 };
  let streak    = 0;
  let tabIndex  = 0;
  let aiSession = null;
  let aiMsgIdx  = 0;
  let aiTimer   = null;
  let saveTimer = null;
  let lastSaved = 0;
  let deferredInstall = null;

  const TAB_COUNT = 7;
  const TAB_IDS   = ['home','steps','nutrition','weight','ai','summary','settings'];

  // ── Swipe state ─────────────────────────────────────────────────────────
  let swipeStartX=0, swipeStartY=0, swipeDeltaX=0;
  let isHSwipe=false, isVScroll=false;
  let swipeVel=0, lastTouchX=0, lastTouchTime=0;

  // ── DOM refs (cached after DOMContentLoaded) ──────────────────────────────────
  let slider, viewport;

  // ═══════════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════════
  async function init() {
    slider   = document.getElementById('swipe-container');
    viewport = document.getElementById('swipe-viewport');

    try { await StorageManager.init(); } catch(e) { console.error('DB:', e); }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js').catch(()=>{});
    }

    // PWA install prompt
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault(); deferredInstall = e;
      showInstallBanner();
    });

    // Chart defaults
    if (window.Chart) ChartsManager.setupDefaults();

    // Detect theme preference
    const savedTheme = localStorage.getItem('theme') ||
      (window.matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light');
    setTheme(savedTheme, false);

    // Splash → boot
    setTimeout(boot, 1900);
  }

  async function boot() {
    profile = await StorageManager.getProfile();
    goals   = await StorageManager.getGoals();

    const splash = document.getElementById('splash');
    splash.classList.add('fade-out');
    setTimeout(() => splash.style.display='none', 500);

    if (!profile) {
      document.getElementById('onboarding').classList.remove('hidden');
      initOnboarding();
    } else {
      document.getElementById('app').classList.remove('hidden');
      await launchApp();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // ONBOARDING
  // ═══════════════════════════════════════════════════════════════
  let obStep = 0;

  function initOnboarding() {
    showOBStep(0);
    document.getElementById('ob-next').addEventListener('click', obNext);
    document.getElementById('ob-back').addEventListener('click', obBack);
  }

  function showOBStep(s) {
    document.querySelectorAll('.ob-step').forEach((el,i) => el.classList.toggle('active', i===s));
    document.getElementById('ob-back').style.display = s===0?'none':'flex';
    document.getElementById('ob-next').textContent   = s===4?'Get Started →':'Continue →';
    document.getElementById('ob-progress-fill').style.width = ((s+1)/5*100)+'%';
  }

  function obNext() {
    if (!obValidate(obStep)) return;
    if (obStep===4) { finishOB(); return; }
    obStep++; showOBStep(obStep);
  }
  function obBack() { if(obStep>0){obStep--;showOBStep(obStep);} }

  function obValidate(s) {
    let ok=true;
    document.querySelectorAll(`.ob-step:nth-child(${s+1}) input,.ob-step:nth-child(${s+1}) select`).forEach(el=>{
      if (!el.value||el.value.trim()==='') { el.classList.add('invalid'); setTimeout(()=>el.classList.remove('invalid'),1500); ok=false; }
    });
    return ok;
  }

  async function finishOB() {
    const p = {
      name:          document.getElementById('ob-name').value.trim(),
      age:           +document.getElementById('ob-age').value,
      height:        +document.getElementById('ob-height').value,
      weight:        +document.getElementById('ob-weight').value,
      gender:        document.getElementById('ob-gender').value,
      goal:          document.getElementById('ob-goal').value,
      activityLevel: document.getElementById('ob-activity').value,
      createdAt:     Date.now()
    };
    const g = {
      stepGoal:    +(document.getElementById('ob-stepgoal').value)||8000,
      calorieGoal: AICoach.calorieGoal(p),
      weightGoal:  null
    };
    await StorageManager.saveProfile(p);
    await StorageManager.saveGoals(g);
    profile = p; goals = g;

    const ob  = document.getElementById('onboarding');
    const app = document.getElementById('app');
    ob.classList.add('fade-out');
    setTimeout(()=>{ ob.style.display='none'; app.classList.remove('hidden'); launchApp(); }, 400);
  }

  // ═══════════════════════════════════════════════════════════════
  // LAUNCH
  // ═══════════════════════════════════════════════════════════════
  async function launchApp() {
    calData = await StorageManager.getTodayCalories();
    streak  = await StorageManager.calculateStreak();

    // Start motion tracking (permission asked on first call)
    const initSteps = await StorageManager.getTodaySteps();
    await MotionTracker.start({
      initial: initSteps,
      onStep: onStepUpdate,
      onErr:  e => console.warn('[Motion]', e)
    });

    // Build nav + swipe
    initNav();
    initSwipe();

    // Initial renders
    await renderTab(0);
    setGreeting();

    // Avatar initial
    const av = document.getElementById('header-avatar');
    if (av && profile.name) av.textContent = profile.name[0].toUpperCase();

    // Auto-save steps every 15s
    saveTimer = setInterval(autoPersist, 15000);
  }

  // ═══════════════════════════════════════════════════════════════
  // SWIPE NAVIGATION (Physics-based)
  // ═══════════════════════════════════════════════════════════════
  function initSwipe() {
    viewport.addEventListener('touchstart', onTouchStart, { passive:true });
    viewport.addEventListener('touchmove',  onTouchMove,  { passive:false });
    viewport.addEventListener('touchend',   onTouchEnd,   { passive:true });
    viewport.addEventListener('touchcancel',onTouchEnd,   { passive:true });
  }

  function onTouchStart(e) {
    swipeStartX = e.touches[0].clientX;
    swipeStartY = e.touches[0].clientY;
    swipeDeltaX = 0; isHSwipe = false; isVScroll = false;
    swipeVel = 0; lastTouchX = swipeStartX; lastTouchTime = Date.now();
    slider.style.transition = 'none';
  }

  function onTouchMove(e) {
    if (isVScroll) return;
    const dx = e.touches[0].clientX - swipeStartX;
    const dy = e.touches[0].clientY - swipeStartY;

    if (!isHSwipe && !isVScroll) {
      if (Math.abs(dx) > Math.abs(dy)+6 && Math.abs(dx)>10) isHSwipe = true;
      else if (Math.abs(dy) > Math.abs(dx)+6) { isVScroll = true; return; }
      else return;
    }

    e.preventDefault();
    swipeDeltaX = dx;

    // Rubber-band at edges
    let offset = dx;
    if ((tabIndex===0 && dx>0) || (tabIndex===TAB_COUNT-1 && dx<0)) {
      offset = dx * 0.12;
    }

    // Velocity tracking
    const now = Date.now(); const dt = now - lastTouchTime;
    if (dt>0) swipeVel = (e.touches[0].clientX - lastTouchX) / dt * 1000;
    lastTouchX = e.touches[0].clientX; lastTouchTime = now;

    // Glow
    setSwipeGlow(dx);
    applyTransform(offset, false);
  }

  function onTouchEnd() {
    if (!isHSwipe) return;
    clearSwipeGlow();

    const w = window.innerWidth;
    let next = tabIndex;

    if      (swipeVel < -350 || swipeDeltaX < -w*0.28) next = Math.min(tabIndex+1, TAB_COUNT-1);
    else if (swipeVel >  350 || swipeDeltaX >  w*0.28) next = Math.max(tabIndex-1, 0);

    goToTab(next, true);
  }

  function applyTransform(extra=0, animated=false) {
    const x = -(tabIndex * window.innerWidth) + extra;
    slider.style.transition = animated ? 'transform 0.38s cubic-bezier(0.4,0,0.2,1)' : 'none';
    slider.style.transform  = `translateX(${x}px)`;
  }

  function setSwipeGlow(dx) {
    const glow = document.getElementById('swipe-glow');
    if (!glow) return;
    if (dx < -20) {
      glow.style.right='0'; glow.style.left='auto'; glow.style.opacity='1';
    } else if (dx > 20) {
      glow.style.left='0'; glow.style.right='auto'; glow.style.opacity='1';
    } else {
      glow.style.opacity='0';
    }
  }
  function clearSwipeGlow() {
    const g = document.getElementById('swipe-glow');
    if (g) g.style.opacity='0';
  }

  // ═══════════════════════════════════════════════════════════════
  // NAVIGATION
  // ═══════════════════════════════════════════════════════════════
  function initNav() {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        const idx = parseInt(item.dataset.idx);
        if (idx !== tabIndex) goToTab(idx, true);
      });
    });
  }

  async function goToTab(idx, animated=false) {
    const prev = tabIndex;
    tabIndex = idx;
    applyTransform(0, animated);
    updateNavActive();
    await renderTab(idx);

    // Haptic-like flash
    const navItem = document.querySelector(`.nav-item[data-idx="${idx}"]`);
    if (navItem) { navItem.classList.add('tapped'); setTimeout(()=>navItem.classList.remove('tapped'),300); }
  }

  function updateNavActive() {
    document.querySelectorAll('.nav-item').forEach((item,i) => {
      item.classList.toggle('active', i===tabIndex);
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // TAB RENDERS
  // ═══════════════════════════════════════════════════════════════
  async function renderTab(idx) {
    switch(TAB_IDS[idx]) {
      case 'home':       await renderHome();       break;
      case 'steps':      await renderSteps();      break;
      case 'nutrition':  await renderNutrition();  break;
      case 'weight':     await renderWeight();     break;
      case 'ai':         await renderAICoach();    break;
      case 'summary':    await renderSummary();    break;
      case 'settings':   renderSettings();         break;
    }
  }

  // ── HOME ───────────────────────────────────────────────────────────
  async function renderHome() {
    const steps  = MotionTracker.count;
    const sg     = goals.stepGoal || 8000;
    const pct    = Math.min(steps/sg, 1);
    const burned = AICoach.caloriesBurned(steps, profile.weight, profile.activityLevel);
    const calPct = calorieData().intake > 0 ? Math.min(calorieData().intake/goals.calorieGoal, 1) : 0;
    const [wTrend, streak2] = await Promise.all([StorageManager.getWeightTrend(), StorageManager.calculateStreak()]);
    streak = streak2;

    // Triple rings
    setRing('ring-steps',    pct);
    setRing('ring-calories', calPct);
    const wPct = wTrend.latest && profile.weight ? Math.min(Math.abs(profile.weight - wTrend.latest)/5, 1) : 0;
    setRing('ring-active', 1 - wPct);

    set('home-steps',   steps.toLocaleString());
    set('home-sg',      `/ ${sg.toLocaleString()}`);
    set('home-pct',     Math.round(pct*100)+'%');
    set('home-burned',  burned.toLocaleString()+' kcal');
    set('home-intake',  (calorieData().intake||0).toLocaleString()+' kcal');
    set('home-streak',  streak);
    set('home-motive',  motivation(pct, steps));
    setGreeting();

    // Streak dots (last 7 days)
    await renderStreakDots();
  }

  async function renderStreakDots() {
    const container = document.getElementById('streak-dots');
    if (!container) return;
    const sg   = goals.stepGoal || 8000;
    const hist = await StorageManager.getStepsHistory(7);
    container.innerHTML = hist.map(d => {
      const hit = d.count >= sg;
      return `<div class="streak-dot ${hit?'hit':d.count>0?'partial':'miss'}" title="${d.date}: ${d.count} steps"></div>`;
    }).join('');
  }

  function setRing(id, pct) {
    const el = document.getElementById(id);
    if (!el) return;
    const r = parseFloat(el.getAttribute('r'));
    const c = 2*Math.PI*r;
    el.style.strokeDasharray  = c;
    el.style.strokeDashoffset = c*(1-Math.min(pct,1));
  }

  // ── STEPS ───────────────────────────────────────────────────────────
  async function renderSteps() {
    const steps  = MotionTracker.count;
    const sg     = goals.stepGoal || 8000;
    const pct    = Math.min(steps/sg, 1);
    const burned = AICoach.caloriesBurned(steps, profile.weight, profile.activityLevel);
    const dist   = (steps*0.000762).toFixed(2);
    const mins   = Math.round(steps/100);

    setRing('steps-ring-prog', pct);
    set('steps-count',  steps.toLocaleString());
    set('steps-goal-n', sg.toLocaleString());
    set('steps-pct',    Math.round(pct*100)+'%');
    set('steps-burned', burned.toLocaleString()+' kcal');
    set('steps-dist',   dist+' km');
    set('steps-time',   mins+' min');
    set('steps-thresh', MotionTracker.threshold+' m/s²');

    // Status badge
    const badge = document.getElementById('steps-badge');
    if (badge) {
      const on=MotionTracker.isRunning, pause=MotionTracker.isPaused;
      badge.textContent  = on?'● Tracking':pause?'⏸ Paused':'◉ Inactive';
      badge.className    = 'badge '+( on?'badge-green':pause?'badge-orange':'badge-gray');
    }

    const btn = document.getElementById('steps-toggle');
    if (btn) btn.textContent = MotionTracker.isPaused ? '▶ Resume' : '⏸ Pause';

    if (!document.getElementById('steps-toggle').dataset.bound) {
      document.getElementById('steps-toggle').dataset.bound='1';
      document.getElementById('steps-toggle').addEventListener('click', toggleTracking);
    }

    if (window.Chart) {
      await Promise.allSettled([
        ChartsManager.dailySteps('chart-daily-steps'),
        ChartsManager.weeklySteps('chart-weekly-steps')
      ]);
    }
  }

  async function toggleTracking() {
    if (MotionTracker.isPaused) await MotionTracker.resume();
    else MotionTracker.pause();
    await renderSteps();
  }

  // ── NUTRITION ─────────────────────────────────────────────────────────
  async function renderNutrition() {
    const steps  = MotionTracker.count;
    const burned = AICoach.caloriesBurned(steps, profile.weight, profile.activityLevel);
    calData.burned = burned;
    const intake  = calData.intake||0;
    const balance = intake - burned;
    const cg      = goals.calorieGoal || 2000;
    const bmrVal  = AICoach.bmr(profile);
    const tdeeVal = AICoach.tdee(bmrVal, profile.activityLevel||'moderate');

    set('nutr-intake',  intake.toLocaleString()+' kcal');
    set('nutr-burned',  burned.toLocaleString()+' kcal');
    set('nutr-goal',    cg.toLocaleString()+' kcal');
    set('nutr-bmr',     bmrVal.toLocaleString()+' kcal/day');
    set('nutr-tdee',    tdeeVal.toLocaleString()+' kcal/day');

    const balEl = document.getElementById('nutr-balance');
    if (balEl) {
      balEl.textContent = (balance>0?'+':'')+Math.round(balance)+' kcal';
      balEl.className   = balance>100?'balance-val surplus':balance<-50?'balance-val deficit':'balance-val balanced';
    }

    // Input binding
    const inp = document.getElementById('nutr-input');
    if (inp && !inp.dataset.bound) {
      inp.dataset.bound='1';
      inp.value = calData.intake||'';
      const save = async () => {
        const v=parseInt(inp.value)||0;
        calData.intake=v;
        await StorageManager.saveTodayCalories({...calData});
        await renderNutrition();
      };
      document.getElementById('nutr-save').addEventListener('click',save);
      inp.addEventListener('keydown', e=>{ if(e.key==='Enter'){inp.blur();save();} });
    }

    if (window.Chart) await ChartsManager.calories('chart-calories');
  }

  // ── WEIGHT ──────────────────────────────────────────────────────────
  async function renderWeight() {
    const history = await StorageManager.getWeightHistory(30);
    const trend   = await StorageManager.getWeightTrend();
    const latest  = trend.latest || profile.weight;
    const bmi     = (latest / Math.pow(profile.height/100, 2)).toFixed(1);

    set('wt-current',  latest+' kg');
    set('wt-start',    profile.weight+' kg');
    set('wt-change',   (trend.delta>0?'+':'')+trend.delta+' kg');
    set('wt-bmi',      bmi);
    set('wt-bmi-label', bmiLabel(+bmi));

    const trendBadge = document.getElementById('wt-trend');
    if (trendBadge) {
      const lbl = trend.direction==='losing'?'↘ Losing':trend.direction==='gaining'?'↗ Gaining':'→ Stable';
      trendBadge.textContent = lbl;
      trendBadge.className   = 'trend-badge trend-'+trend.direction;
    }

    // Log form
    const wtIn  = document.getElementById('wt-input');
    const wtBtn = document.getElementById('wt-log-btn');
    if (wtBtn && !wtBtn.dataset.bound) {
      wtBtn.dataset.bound='1';
      wtBtn.addEventListener('click', async () => {
        const v=parseFloat(wtIn.value);
        if (!v||v<20||v>300) { wtIn.classList.add('invalid'); setTimeout(()=>wtIn.classList.remove('invalid'),1000); return; }
        await StorageManager.addWeightEntry(v);
        wtIn.value='';
        toast('Weight logged 💪');
        await renderWeight();
      });
    }

    if (window.Chart) await ChartsManager.weightTrend('chart-weight');
  }

  // ── AI COACH ──────────────────────────────────────────────────────────
  async function renderAICoach() {
    // Only start a new session if not already running
    if (aiTimer !== null) return;

    const chatEl = document.getElementById('ai-chat');
    if (!chatEl) return;
    chatEl.innerHTML = '';

    // Gather data
    const [wTrend, weekInsights] = await Promise.all([
      StorageManager.getWeightTrend(), StorageManager.getWeeklyInsights()
    ]);

    const data = {
      steps:          MotionTracker.count,
      goals,
      calories:       calData,
      trend:          wTrend,
      streak,
      profile,
      weeklyInsights: weekInsights
    };

    aiSession = AICoach.generateSession(data);
    aiMsgIdx  = 0;
    scheduleNextAIMessage();
  }

  function scheduleNextAIMessage() {
    if (aiMsgIdx >= aiSession.length) { aiTimer=null; return; }
    const msg = aiSession[aiMsgIdx];

    aiTimer = setTimeout(() => {
      showTyping();
      aiTimer = setTimeout(() => {
        hideTyping();
        appendAIMessage(msg.text);
        aiMsgIdx++;
        aiTimer = null;
        scheduleNextAIMessage();
      }, msg.think || 1400);
    }, aiMsgIdx===0 ? msg.delay : msg.delay);
  }

  function showTyping() {
    const chatEl = document.getElementById('ai-chat');
    if (!chatEl) return;
    const div = document.createElement('div');
    div.className = 'ai-msg ai-msg-thinking'; div.id='ai-typing';
    div.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
    chatEl.appendChild(div);
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  function hideTyping() {
    document.getElementById('ai-typing')?.remove();
  }

  function appendAIMessage(text) {
    const chatEl = document.getElementById('ai-chat');
    if (!chatEl) return;
    const div = document.createElement('div');
    div.className = 'ai-msg ai-msg-in';
    // Convert **bold** to <strong>
    div.innerHTML = text.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
    chatEl.appendChild(div);
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  // ── SUMMARY ──────────────────────────────────────────────────────────
  async function renderSummary() {
    const [wTrend, weekInsights] = await Promise.all([
      StorageManager.getWeightTrend(), StorageManager.getWeeklyInsights()
    ]);

    const steps   = MotionTracker.count;
    const sg      = goals.stepGoal || 8000;
    const burned  = AICoach.caloriesBurned(steps, profile.weight, profile.activityLevel);

    // Today tiles
    set('sum-steps',   steps.toLocaleString());
    set('sum-burned',  burned.toLocaleString()+' kcal');
    set('sum-intake',  (calData.intake||0).toLocaleString()+' kcal');
    set('sum-streak',  streak+' days');

    // Weekly summary bullets
    const summaryLines  = AICoach.weeklyText(weekInsights, profile, streak);
    const summaryEl = document.getElementById('sum-text');
    if (summaryEl) {
      summaryEl.innerHTML = summaryLines.map(l=>
        `<p>${l.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')}</p>`
      ).join('');
    }

    // Smart insights
    const insights = AICoach.smartInsights(weekInsights, profile, goals);
    const insEl    = document.getElementById('sum-insights');
    if (insEl) {
      insEl.innerHTML = insights.map(({icon,text,type})=>
        `<div class="insight-item insight-${type}"><span class="insight-icon">${icon}</span><span class="insight-text">${text}</span></div>`
      ).join('');
    }

    if (window.Chart) await ChartsManager.summarySteps('chart-summary-steps');
  }

  // ── SETTINGS ──────────────────────────────────────────────────────────
  function renderSettings() {
    // Pre-fill profile fields
    const fields = { 'set-name':profile.name, 'set-age':profile.age,
      'set-height':profile.height, 'set-weight':profile.weight,
      'set-gender':profile.gender, 'set-activity':profile.activityLevel,
      'set-goal':profile.goal, 'set-stepgoal':goals.stepGoal,
      'set-calgoal':goals.calorieGoal };

    Object.entries(fields).forEach(([id,val])=>{
      const el=document.getElementById(id); if(el) el.value=val||'';
    });

    // Theme toggle
    const themeToggle = document.getElementById('toggle-theme');
    const currentTheme = document.documentElement.dataset.theme;
    if (themeToggle) themeToggle.classList.toggle('on', currentTheme==='light');

    // Tracking toggle
    const trackToggle = document.getElementById('toggle-tracking');
    if (trackToggle) trackToggle.classList.toggle('on', MotionTracker.isRunning);

    // Bind once
    if (!document.getElementById('set-save').dataset.bound) {
      document.getElementById('set-save').dataset.bound='1';
      document.getElementById('set-save').addEventListener('click', saveSettings);
      document.getElementById('btn-export').addEventListener('click', exportData);
      document.getElementById('btn-reset').addEventListener('click', confirmReset);

      if (themeToggle) themeToggle.addEventListener('click', ()=>{
        const next = document.documentElement.dataset.theme==='dark'?'light':'dark';
        setTheme(next,true); themeToggle.classList.toggle('on', next==='light');
      });

      if (trackToggle) trackToggle.addEventListener('click', async ()=>{
        if (MotionTracker.isRunning) MotionTracker.pause();
        else await MotionTracker.resume();
        trackToggle.classList.toggle('on', MotionTracker.isRunning);
      });
    }
  }

  async function saveSettings() {
    const updated = {
      ...profile,
      name:          document.getElementById('set-name').value.trim(),
      age:           +document.getElementById('set-age').value,
      height:        +document.getElementById('set-height').value,
      weight:        +document.getElementById('set-weight').value,
      gender:        document.getElementById('set-gender').value,
      activityLevel: document.getElementById('set-activity').value,
      goal:          document.getElementById('set-goal').value,
    };
    const updatedGoals = {
      ...goals,
      stepGoal:    +(document.getElementById('set-stepgoal').value)||8000,
      calorieGoal: +(document.getElementById('set-calgoal').value)||2000,
    };
    await StorageManager.saveProfile(updated);
    await StorageManager.saveGoals(updatedGoals);
    profile = updated; goals = updatedGoals;
    toast('Settings saved ✓');
    const av=document.getElementById('header-avatar');
    if(av&&profile.name) av.textContent=profile.name[0].toUpperCase();
  }

  async function exportData() {
    const json = await StorageManager.exportAllData();
    const blob = new Blob([json],{type:'application/json'});
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `vitalux-export-${StorageManager.today()}.json`;
    a.click();
    toast('Data exported 📦');
  }

  async function confirmReset() {
    const confirmed = confirm('This will delete ALL your data permanently. Are you sure?');
    if (!confirmed) return;
    await StorageManager.clearAll();
    MotionTracker.reset(0);
    profile = null; goals = null;
    location.reload();
  }

  // ═══════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════
  function set(id, text) { const el=document.getElementById(id); if(el) el.textContent=text; }

  function calorieData() { return calData; }

  function setGreeting() {
    const h=new Date().getHours();
    const t=h<5?'night':h<12?'morning':h<17?'afternoon':'evening';
    const name=profile?.name?`, ${profile.name.split(' ')[0]}`:\';
    set('greeting', `Good ${t}${name}.`);
  }

  function motivation(pct, steps) {
    if (pct>=1)    return 'You hit your goal! Extraordinary. 🏆';
    if (pct>=0.75) return 'Almost there — one last push!';
    if (pct>=0.5)  return 'Halfway done. Keep the pace! 💪';
    if (pct>=0.25) return 'Good start. Lots of day left.';
    if (steps>0)   return 'Every step counts. Keep moving.';
    return 'Tap Start to begin tracking.';
  }

  function bmiLabel(b) {
    return b<18.5?'Underweight':b<25?'Healthy Weight':b<30?'Overweight':'Obese';
  }

  function setTheme(t, save=true) {
    document.documentElement.dataset.theme = t;
    if(save) localStorage.setItem('theme',t);
    if(window.Chart) ChartsManager.setupDefaults();
  }

  // ── Step callback ────────────────────────────────────────────────────────
  function onStepUpdate(count) {
    if (tabIndex===0) requestAnimationFrame(renderHome);
    else if (tabIndex===1) requestAnimationFrame(renderSteps);
  }

  // ── Auto-persist steps ──────────────────────────────────────────────────────
  async function autoPersist() {
    const count = MotionTracker.count;
    if (count !== lastSaved) {
      await StorageManager.saveTodaySteps(count);
      const burned = AICoach.caloriesBurned(count, profile.weight, profile.activityLevel);
      calData.burned = burned;
      await StorageManager.saveTodayCalories({...calData});
      lastSaved = count;
    }
  }

  // ── Install banner ────────────────────────────────────────────────────────
  function showInstallBanner() {
    const banner = document.getElementById('install-banner');
    if (!banner) return;
    banner.classList.add('show');
    document.getElementById('install-btn')?.addEventListener('click', async () => {
      if (deferredInstall) {
        deferredInstall.prompt();
        const { outcome } = await deferredInstall.userChoice;
        if (outcome==='accepted') banner.classList.remove('show');
        deferredInstall = null;
      } else {
        // iOS: show instructions
        alert('To install: tap the Share button → "Add to Home Screen"');
      }
    });
    document.getElementById('install-close')?.addEventListener('click', () => {
      banner.classList.remove('show');
    });
  }

  // ── Toast ───────────────────────────────────────────────────────────
  function toast(msg, dur=2800) {
    document.querySelector('.toast')?.remove();
    const el = document.createElement('div');
    el.className='toast'; el.textContent=msg;
    document.body.appendChild(el);
    requestAnimationFrame(()=>{
      el.classList.add('show');
      setTimeout(()=>{ el.classList.remove('show'); setTimeout(()=>el.remove(),400); }, dur);
    });
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => App.init());