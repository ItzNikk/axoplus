'use strict';

/**
 * Vitalux v3 — Main Controller
 * Tabs: Home · Steps · Nutrition · Health · AI · Summary · Achievements · Settings
 * Features: iOS permission modal, animated counters, water tracker, sleep,
 *           meal breakdown, achievements, personal records, walk/run detection,
 *           smart reminders, light/dark, install prompt, export/reset
 */
const App = (() => {

  // ── State ─────────────────────────────────────────────────────────────────────
  let profile=null, goals=null;
  let calData={intake:0,burned:0}, meals={breakfast:0,lunch:0,dinner:0,snacks:0};
  let waterMl=0, sleepData={hours:0,quality:0};
  let streak=0, tabIdx=0, lastSaved=0;
  let aiSession=null, aiIdx=0, aiTimer=null;
  let deferredInstall=null;
  const TAB_IDS=['home','steps','nutrition','health','ai','summary','achievements','settings'];
  const N_TABS=8;

  // Swipe
  let sw={startX:0,startY:0,dx:0,isH:false,isV:false,vel:0,lastX:0,lastT:0};

  // Animated counter targets
  const counterTargets={};

  // ─────────────────────────────────────────────────────────────────────────────
  // INIT
  // ─────────────────────────────────────────────────────────────────────────────
  async function init(){
    try{await StorageManager.init();}catch(e){console.error(e);}

    if('serviceWorker' in navigator)
      navigator.serviceWorker.register('/service-worker.js').catch(()=>{});

    window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;showInstallBanner();});

    if(window.Chart) ChartsManager.defaults();

    const saved=localStorage.getItem('theme')||
      (window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');
    applyTheme(saved,false);

    setTimeout(boot,2000);
  }

  async function boot(){
    profile=await StorageManager.getProfile();
    goals=await StorageManager.getGoals();
    document.getElementById('splash').classList.add('fade-out');
    setTimeout(()=>document.getElementById('splash').style.display='none',500);

    if(!profile){
      document.getElementById('onboarding').classList.remove('hidden');
      initOB();
    } else {
      document.getElementById('app').classList.remove('hidden');
      await launchApp();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ONBOARDING
  // ─────────────────────────────────────────────────────────────────────────────
  let obStep=0;
  function initOB(){
    showOBStep(0);
    document.getElementById('ob-next').addEventListener('click',obNext);
    document.getElementById('ob-back').addEventListener('click',()=>{if(obStep>0){obStep--;showOBStep(obStep);}});
  }
  function showOBStep(s){
    document.querySelectorAll('.ob-step').forEach((el,i)=>el.classList.toggle('active',i===s));
    document.getElementById('ob-back').style.display=s===0?'none':'flex';
    document.getElementById('ob-next').textContent=s===4?'Start →':'Continue →';
    document.getElementById('ob-prog-fill').style.width=((s+1)/5*100)+'%';
  }
  function obNext(){
    if(!obValidate(obStep)) return;
    if(obStep===4){finishOB();return;}
    obStep++; showOBStep(obStep);
  }
  function obValidate(s){
    let ok=true;
    document.querySelectorAll(`.ob-step.active input,.ob-step.active select`).forEach(el=>{
      if(!el.value){el.classList.add('invalid');setTimeout(()=>el.classList.remove('invalid'),1500);ok=false;}
    });
    return ok;
  }
  async function finishOB(){
    const p={
      name:document.getElementById('ob-name').value.trim(),
      age:+document.getElementById('ob-age').value,
      height:+document.getElementById('ob-height').value,
      weight:+document.getElementById('ob-weight').value,
      gender:document.getElementById('ob-gender').value,
      goal:document.getElementById('ob-goal').value,
      activityLevel:document.getElementById('ob-activity').value,
      createdAt:Date.now()
    };
    const g={
      id:1,
      stepGoal:+(document.getElementById('ob-stepgoal').value)||8000,
      calorieGoal:AICoach.calorieGoal(p),
      waterGoal:AICoach.waterGoalMl(p.weight),
      sleepGoal:8,
      weightGoal:null
    };
    await StorageManager.saveProfile(p);
    await StorageManager.saveGoals(g);
    profile=p; goals=g;
    document.getElementById('onboarding').classList.add('fade-out');
    setTimeout(()=>{
      document.getElementById('onboarding').style.display='none';
      document.getElementById('app').classList.remove('hidden');
      launchApp();
    },400);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // LAUNCH
  // ─────────────────────────────────────────────────────────────────────────────
  async function launchApp(){
    [calData,meals,waterMl,sleepData,streak]=await Promise.all([
      StorageManager.getTodayCalories(),
      StorageManager.getTodayMeals(),
      StorageManager.getTodayWater(),
      StorageManager.getTodaySleep(),
      StorageManager.calculateStreak()
    ]);

    const initSteps=await StorageManager.getTodaySteps();

    // Try start tracking (non-iOS: auto, iOS: needs user gesture)
    const started=await MotionTracker.start({
      initial:initSteps,
      onStep:onStepUpdate,
      onErr:e=>console.warn('[Motion]',e),
      onPerm:granted=>{
        if(granted){document.getElementById('perm-modal')?.classList.add('hidden');toast('Step tracking started! 👟');}
        else toast('Motion denied — enable in iOS Settings');
      }
    });

    // iOS needs explicit permission — show modal
    if(!started && typeof DeviceMotionEvent!=='undefined' && typeof DeviceMotionEvent.requestPermission==='function'){
      showPermModal();
    }

    initNav();
    initSwipe();
    await renderTab(0);
    setGreeting();
    updateAvatar();
    setInterval(autoPersist,15000);
    setInterval(checkMidnightReset,60000);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PERMISSION MODAL (iOS)
  // ─────────────────────────────────────────────────────────────────────────────
  function showPermModal(){
    const modal=document.getElementById('perm-modal');
    if(!modal) return;
    modal.classList.remove('hidden');
    document.getElementById('perm-allow-btn').addEventListener('click',async()=>{
      // MUST be called directly from click handler
      const result=await MotionTracker.requestPermission();
      if(result==='granted'){
        const initSteps=await StorageManager.getTodaySteps();
        MotionTracker.reset(initSteps);
        await MotionTracker.start({initial:initSteps,onStep:onStepUpdate,onErr:e=>console.warn(e)});
        modal.classList.add('hidden');
        toast('Motion tracking active! 🚶');
        await renderTab(tabIdx);
      } else if(result==='denied'){
        modal.classList.add('hidden');
        toast('Permission denied. Enable in Settings → Privacy → Motion.');
      }
    });
    document.getElementById('perm-skip-btn').addEventListener('click',()=>{
      modal.classList.add('hidden');
      toast('Tracking disabled. Tap the badge to re-enable.');
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // NAV + SWIPE
  // ─────────────────────────────────────────────────────────────────────────────
  function initNav(){
    document.querySelectorAll('.nav-item').forEach(item=>{
      item.addEventListener('click',()=>{
        const idx=+item.dataset.idx;
        if(idx!==tabIdx) goTo(idx,true);
      });
    });
  }

  function initSwipe(){
    const vp=document.getElementById('swipe-viewport');
    vp.addEventListener('touchstart',e=>{
      sw.startX=e.touches[0].clientX; sw.startY=e.touches[0].clientY;
      sw.dx=0; sw.isH=false; sw.isV=false; sw.vel=0;
      sw.lastX=sw.startX; sw.lastT=Date.now();
      document.getElementById('swipe-container').style.transition='none';
    },{passive:true});

    vp.addEventListener('touchmove',e=>{
      if(sw.isV) return;
      const dx=e.touches[0].clientX-sw.startX;
      const dy=e.touches[0].clientY-sw.startY;
      if(!sw.isH&&!sw.isV){
        if(Math.abs(dx)>Math.abs(dy)+5&&Math.abs(dx)>8) sw.isH=true;
        else if(Math.abs(dy)>Math.abs(dx)+5){sw.isV=true;return;}
        else return;
      }
      e.preventDefault(); sw.dx=dx;
      let off=dx;
      if((tabIdx===0&&dx>0)||(tabIdx===N_TABS-1&&dx<0)) off=dx*0.1;
      const now=Date.now();
      sw.vel=(e.touches[0].clientX-sw.lastX)/(now-sw.lastT)*1000;
      sw.lastX=e.touches[0].clientX; sw.lastT=now;
      setGlow(dx);
      applyX(off,false);
    },{passive:false});

    vp.addEventListener('touchend',()=>{
      if(!sw.isH){clearGlow();return;}
      clearGlow();
      const w=window.innerWidth;
      let next=tabIdx;
      if(sw.vel<-300||sw.dx<-w*0.25) next=Math.min(tabIdx+1,N_TABS-1);
      else if(sw.vel>300||sw.dx>w*0.25) next=Math.max(tabIdx-1,0);
      goTo(next,true);
    },{passive:true});
  }

  function applyX(extra=0,animated=false){
    const sl=document.getElementById('swipe-container');
    sl.style.transition=animated?'transform 0.36s cubic-bezier(0.4,0,0.2,1)':'none';
    sl.style.transform=`translateX(${-(tabIdx*window.innerWidth)+extra}px)`;
  }

  function setGlow(dx){
    const g=document.getElementById('swipe-glow');
    if(!g) return;
    if(dx<-15){g.setAttribute('data-dir','right');g.style.opacity='1';}
    else if(dx>15){g.setAttribute('data-dir','left');g.style.opacity='1';}
    else g.style.opacity='0';
  }
  function clearGlow(){const g=document.getElementById('swipe-glow');if(g)g.style.opacity='0';}

  async function goTo(idx,animated=false){
    tabIdx=idx;
    applyX(0,animated);
    document.querySelectorAll('.nav-item').forEach((el,i)=>el.classList.toggle('active',i===idx));
    await renderTab(idx);
    const ni=document.querySelector(`.nav-item[data-idx="${idx}"]`);
    if(ni){ni.classList.add('tapped');setTimeout(()=>ni.classList.remove('tapped'),280);}
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // TAB ROUTING
  // ─────────────────────────────────────────────────────────────────────────────
  async function renderTab(idx){
    switch(TAB_IDS[idx]){
      case 'home':         await renderHome();         break;
      case 'steps':        await renderSteps();        break;
      case 'nutrition':    await renderNutrition();    break;
      case 'health':       await renderHealth();       break;
      case 'ai':           await renderAI();           break;
      case 'summary':      await renderSummary();      break;
      case 'achievements': await renderAchievements(); break;
      case 'settings':     renderSettings();           break;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HOME
  // ─────────────────────────────────────────────────────────────────────────────
  async function renderHome(){
    const steps=MotionTracker.count;
    const sg=goals.stepGoal||8000;
    const pct=Math.min(steps/sg,1);
    const burned=AICoach.caloriesBurnedByMode(steps,profile.weight,MotionTracker.mode);
    const cg=goals.calorieGoal||2000;
    const wg=goals.waterGoal||2500;
    const calPct=Math.min((calData.intake||0)/cg,1);
    const watPct=Math.min((waterMl||0)/wg,1);

    setRing('ring-steps',pct);
    setRing('ring-cal',calPct);
    setRing('ring-water',watPct);

    animCounter('home-steps',steps);
    set('home-sg','/ '+sg.toLocaleString()+' steps');
    set('home-pct',Math.round(pct*100)+'%');
    animCounter('home-burned',burned);
    set('home-burned-unit','kcal');
    animCounter('home-intake',calData.intake||0);
    set('home-intake-unit','kcal');
    set('home-streak',streak);
    set('home-motive',motiveTxt(pct,steps));
    setGreeting();
    await renderStreakDots();

    // Workout mode badge
    const mb=document.getElementById('home-mode-badge');
    if(mb){ mb.textContent=MotionTracker.mode==='run'?'🏃 Running':'🚶 Walking'; mb.className='mode-badge '+(MotionTracker.mode==='run'?'mode-run':'mode-walk'); }
  }

  async function renderStreakDots(){
    const el=document.getElementById('streak-dots');
    if(!el) return;
    const sg=goals.stepGoal||8000;
    const hist=await StorageManager.getStepsHistory(7);
    el.innerHTML=hist.map(d=>`<div class="sdot ${d.count>=sg?'hit':d.count>0?'partial':'miss'}"></div>`).join('');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STEPS
  // ─────────────────────────────────────────────────────────────────────────────
  async function renderSteps(){
    const steps=MotionTracker.count;
    const sg=goals.stepGoal||8000;
    const pct=Math.min(steps/sg,1);
    const mode=MotionTracker.mode;
    const burned=AICoach.caloriesBurnedByMode(steps,profile.weight,mode);
    const dist=(steps*0.000762).toFixed(2);
    const mins=Math.round(steps/100);

    setRing('steps-ring-prog',pct);
    animCounter('steps-count',steps);
    set('steps-goal-n',sg.toLocaleString());
    set('steps-pct-val',Math.round(pct*100)+'%');
    animCounter('steps-burned',burned);
    set('steps-burned-u','kcal');
    set('steps-dist',dist+' km');
    set('steps-time',mins+' min');
    set('steps-cadence',MotionTracker.cadence?(MotionTracker.cadence+' steps/min'):'—');
    set('steps-mode-val',mode==='run'?'🏃 Running':'🚶 Walking');
    set('steps-thresh',MotionTracker.threshold+' m/s²');

    // Status
    const badge=document.getElementById('steps-badge');
    if(badge){
      const on=MotionTracker.isRunning, p=MotionTracker.isPaused;
      badge.textContent=on?'● Tracking Active':p?'⏸ Paused':'◉ Stopped';
      badge.className='badge '+(on?'badge-green':p?'badge-orange':'badge-gray');
    }

    // Permission state
    const permBtn=document.getElementById('steps-perm-btn');
    if(permBtn){
      if(!MotionTracker.isPermitted && typeof DeviceMotionEvent!=='undefined' && typeof DeviceMotionEvent.requestPermission==='function'){
        permBtn.style.display='flex';
        if(!permBtn.dataset.bound){
          permBtn.dataset.bound='1';
          permBtn.addEventListener('click',async()=>{
            const r=await MotionTracker.requestPermission();
            if(r==='granted'){
              const init=await StorageManager.getTodaySteps();
              MotionTracker.reset(init);
              await MotionTracker.start({initial:init,onStep:onStepUpdate,onErr:e=>console.warn(e)});
              permBtn.style.display='none';
              await renderSteps();
              toast('Motion sensor active 🎉');
            } else {
              toast('Denied — allow in Settings → Privacy → Motion & Fitness');
            }
          });
        }
      } else {
        permBtn.style.display='none';
      }
    }

    // Toggle btn
    const btn=document.getElementById('steps-toggle');
    if(btn){
      btn.textContent=MotionTracker.isPaused?'▶ Resume':'⏸ Pause';
      if(!btn.dataset.bound){
        btn.dataset.bound='1';
        btn.addEventListener('click',async()=>{
          if(MotionTracker.isPaused) await MotionTracker.resume();
          else MotionTracker.pause();
          await renderSteps();
        });
      }
    }

    if(window.Chart){
      await Promise.allSettled([
        ChartsManager.dailySteps('chart-daily-steps'),
        ChartsManager.weeklySteps('chart-weekly-steps')
      ]);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // NUTRITION
  // ─────────────────────────────────────────────────────────────────────────────
  async function renderNutrition(){
    const steps=MotionTracker.count;
    const burned=AICoach.caloriesBurnedByMode(steps,profile.weight,MotionTracker.mode);
    calData.burned=burned;
    const total=Object.values(meals).reduce((s,v)=>s+(+v||0),0);
    const cg=goals.calorieGoal||2000;
    const balance=total-burned;

    set('nutr-total',total.toLocaleString()+' kcal');
    set('nutr-burned',burned.toLocaleString()+' kcal');
    set('nutr-goal',cg.toLocaleString()+' kcal');
    set('nutr-bmr',AICoach.bmr(profile).toLocaleString()+' kcal/day');
    set('nutr-tdee',AICoach.tdee(AICoach.bmr(profile),profile.activityLevel).toLocaleString()+' kcal/day');

    const balEl=document.getElementById('nutr-balance');
    if(balEl){
      balEl.textContent=(balance>0?'+':'')+Math.round(balance)+' kcal';
      balEl.className='balance-val '+(balance>100?'surplus':balance<-50?'deficit':'balanced');
    }

    // Meal inputs
    ['breakfast','lunch','dinner','snacks'].forEach(m=>{
      const inp=document.getElementById(`meal-${m}`);
      if(inp&&!inp.dataset.bound){
        inp.dataset.bound='1';
        inp.value=meals[m]||'';
        inp.addEventListener('change',async()=>{
          meals[m]=+inp.value||0;
          const total=Object.values(meals).reduce((s,v)=>s+(+v||0),0);
          calData.intake=total;
          await Promise.all([StorageManager.saveTodayMeals({...meals}),StorageManager.saveTodayCalories({...calData})]);
          await renderNutrition();
        });
      }
    });

    // Macro ring (estimated)
    const macro=AICoach.macroSplit(profile.goal||'maintain');
    set('macro-protein',macro.protein+'%');
    set('macro-carbs',macro.carbs+'%');
    set('macro-fat',macro.fat+'%');

    if(window.Chart) await ChartsManager.calories('chart-calories');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HEALTH (Weight + Sleep + Water + Body Measurements)
  // ─────────────────────────────────────────────────────────────────────────────
  async function renderHealth(){
    const [trend,records]=await Promise.all([StorageManager.getWeightTrend(),StorageManager.getPersonalRecords()]);
    const latest=trend.latest||profile.weight;
    const bmiVal=AICoach.bmi(latest,profile.height);

    // Weight
    set('h-wt-current',latest+' kg');
    set('h-wt-change',(trend.delta>0?'+':'')+trend.delta+' kg');
    set('h-bmi',bmiVal.toFixed(1));
    set('h-bmi-label',AICoach.bmiLabel(bmiVal));
    const tb=document.getElementById('h-wt-trend');
    if(tb){tb.textContent=trend.direction==='losing'?'↘ Losing':trend.direction==='gaining'?'↗ Gaining':'→ Stable';tb.className='trend-badge trend-'+trend.direction;}

    // Weight log
    const wi=document.getElementById('h-wt-input');
    const wb=document.getElementById('h-wt-btn');
    if(wb&&!wb.dataset.bound){
      wb.dataset.bound='1';
      wb.addEventListener('click',async()=>{
        const v=parseFloat(wi.value);
        if(!v||v<20||v>300){wi.classList.add('invalid');setTimeout(()=>wi.classList.remove('invalid'),1000);return;}
        await StorageManager.addWeightEntry(v);
        wi.value=''; toast('Weight logged 💪'); await renderHealth();
      });
    }

    // Water
    const wg=goals.waterGoal||2500;
    const watPct=Math.min(waterMl/wg,1);
    setRing('water-ring-prog',watPct);
    set('h-water-ml',waterMl+' ml');
    set('h-water-goal',wg+' ml goal');
    set('h-water-pct',Math.round(watPct*100)+'%');

    // Water buttons (already bound check)
    document.querySelectorAll('.water-add-btn').forEach(btn=>{
      if(!btn.dataset.bound){
        btn.dataset.bound='1';
        btn.addEventListener('click',async()=>{
          waterMl+=+(btn.dataset.ml||250);
          await StorageManager.saveTodayWater(waterMl);
          toast(`+${btn.dataset.ml} ml 💧`);
          await renderHealth();
        });
      }
    });

    // Sleep
    const si=document.getElementById('h-sleep-hours');
    const sq=document.getElementById('h-sleep-quality');
    const sb=document.getElementById('h-sleep-save');
    if(si&&!si.value) si.value=sleepData.hours||'';
    if(sq&&!sq.value) sq.value=sleepData.quality||'';
    if(sb&&!sb.dataset.bound){
      sb.dataset.bound='1';
      sb.addEventListener('click',async()=>{
        const h=parseFloat(si.value)||0, q=+sq.value||0;
        if(h<0||h>24||q<0||q>5){toast('Invalid sleep data');return;}
        await StorageManager.saveSleep(h,q);
        sleepData={hours:h,quality:q};
        toast('Sleep logged 😴'); await renderHealth();
      });
    }

    // Records
    if(records.bestStepDay) set('rec-best-steps',records.bestStepDay.count.toLocaleString()+' steps on '+records.bestStepDay.date);
    if(records.longestStreak) set('rec-streak',records.longestStreak+' days');
    if(records.minWeight&&records.minWeight.value) set('rec-lowest-wt',records.minWeight.value+' kg');
    if(records.maxWeight&&records.maxWeight.value) set('rec-highest-wt',records.maxWeight.value+' kg');

    if(window.Chart){
      await Promise.allSettled([
        ChartsManager.weightTrend('chart-weight'),
        ChartsManager.waterHistory('chart-water'),
        ChartsManager.sleepHistory('chart-sleep')
      ]);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // AI COACH
  // ─────────────────────────────────────────────────────────────────────────────
  async function renderAI(){
    if(aiTimer!==null) return; // session in progress
    const chatEl=document.getElementById('ai-chat');
    if(!chatEl) return;
    chatEl.innerHTML='';

    const [wTrend,weekIns]=await Promise.all([StorageManager.getWeightTrend(),StorageManager.getWeeklyInsights()]);
    const data={
      steps:MotionTracker.count, goals, calories:calData,
      trend:wTrend, streak, profile,
      weeklyInsights:weekIns,
      water:waterMl, sleep:sleepData,
      mode:MotionTracker.mode
    };
    aiSession=AICoach.generateSession(data);
    aiIdx=0;
    nextAIMsg();
  }

  function nextAIMsg(){
    if(aiIdx>=aiSession.length){aiTimer=null;return;}
    const msg=aiSession[aiIdx];
    aiTimer=setTimeout(()=>{
      showTyping();
      aiTimer=setTimeout(()=>{
        hideTyping(); appendMsg(msg.text); aiIdx++;
        aiTimer=null; nextAIMsg();
      },msg.think||1200);
    },aiIdx===0?msg.delay||400:msg.delay||1600);
  }

  function showTyping(){
    const el=document.getElementById('ai-chat');
    if(!el) return;
    const d=document.createElement('div');
    d.className='ai-bubble ai-thinking'; d.id='ai-typing';
    d.innerHTML='<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
    el.appendChild(d); el.scrollTop=el.scrollHeight;
  }
  function hideTyping(){document.getElementById('ai-typing')?.remove();}
  function appendMsg(text){
    const el=document.getElementById('ai-chat');
    if(!el) return;
    const d=document.createElement('div');
    d.className='ai-bubble ai-in';
    d.innerHTML=text.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
    el.appendChild(d); el.scrollTop=el.scrollHeight;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────────────────────────────────────────
  async function renderSummary(){
    const [wTrend,weekIns]=await Promise.all([StorageManager.getWeightTrend(),StorageManager.getWeeklyInsights()]);
    const steps=MotionTracker.count;
    const burned=AICoach.caloriesBurnedByMode(steps,profile.weight,MotionTracker.mode);

    set('sum-steps',steps.toLocaleString()); set('sum-burned',burned.toLocaleString()+' kcal');
    set('sum-intake',(calData.intake||0).toLocaleString()+' kcal'); set('sum-streak',streak+' days');
    set('sum-water',waterMl+' ml'); set('sum-sleep',sleepData.hours?sleepData.hours+'h':'—');

    const txtEl=document.getElementById('sum-text');
    if(txtEl){
      const lines=AICoach.weeklyText(weekIns,profile,streak);
      txtEl.innerHTML=lines.map(l=>`<p>${l.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')}</p>`).join('');
    }

    const insEl=document.getElementById('sum-insights');
    if(insEl){
      const items=AICoach.smartInsights(weekIns,profile,goals);
      insEl.innerHTML=items.map(({icon,text,type})=>`<div class="insight insight-${type}"><span>${icon}</span><span class="insight-txt">${text}</span></div>`).join('');
    }

    if(window.Chart) await ChartsManager.summarySteps('chart-summary-steps');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ACHIEVEMENTS
  // ─────────────────────────────────────────────────────────────────────────────
  async function renderAchievements(){
    const [ach,records]=await Promise.all([StorageManager.getAchievements(),StorageManager.getPersonalRecords()]);
    const el=document.getElementById('ach-grid');
    if(!el) return;

    el.innerHTML=ach.map(a=>`
      <div class="ach-card ${a.unlocked?'unlocked':'locked'}">
        <div class="ach-icon">${a.icon}</div>
        <div class="ach-name">${a.name}</div>
        <div class="ach-desc">${a.desc}</div>
        ${a.unlocked?'<div class="ach-check">✓</div>':''}
      </div>
    `).join('');

    // Records
    if(records.bestStepDay) set('rec-best',records.bestStepDay.count.toLocaleString()+' steps');
    set('rec-streak-all',records.longestStreak+' days');
    set('rec-streak-cur',records.currentStreak+' days');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SETTINGS
  // ─────────────────────────────────────────────────────────────────────────────
  function renderSettings(){
    const f={
      'set-name':profile.name,'set-age':profile.age,'set-height':profile.height,
      'set-weight':profile.weight,'set-gender':profile.gender,'set-activity':profile.activityLevel,
      'set-goal':profile.goal,'set-stepgoal':goals.stepGoal,'set-calgoal':goals.calorieGoal,
      'set-watergoal':goals.waterGoal,'set-sleepgoal':goals.sleepGoal
    };
    Object.entries(f).forEach(([id,v])=>{const el=document.getElementById(id);if(el)el.value=v||'';});

    const th=document.getElementById('toggle-theme');
    const tr=document.getElementById('toggle-tracking');
    if(th) th.classList.toggle('on',document.documentElement.dataset.theme==='light');
    if(tr) tr.classList.toggle('on',MotionTracker.isRunning);

    if(!document.getElementById('set-save').dataset.bound){
      document.getElementById('set-save').dataset.bound='1';
      document.getElementById('set-save').addEventListener('click',saveSettings);
      document.getElementById('btn-export').addEventListener('click',exportData);
      document.getElementById('btn-reset').addEventListener('click',confirmReset);
      if(th) th.addEventListener('click',()=>{
        const n=document.documentElement.dataset.theme==='dark'?'light':'dark';
        applyTheme(n,true); th.classList.toggle('on',n==='light');
      });
      if(tr) tr.addEventListener('click',async()=>{
        if(MotionTracker.isRunning) MotionTracker.pause();
        else await MotionTracker.resume();
        tr.classList.toggle('on',MotionTracker.isRunning);
      });
    }
  }

  async function saveSettings(){
    const up={...profile,
      name:document.getElementById('set-name').value.trim(),
      age:+document.getElementById('set-age').value,
      height:+document.getElementById('set-height').value,
      weight:+document.getElementById('set-weight').value,
      gender:document.getElementById('set-gender').value,
      activityLevel:document.getElementById('set-activity').value,
      goal:document.getElementById('set-goal').value,
    };
    const ug={...goals,
      stepGoal:+(document.getElementById('set-stepgoal').value)||8000,
      calorieGoal:+(document.getElementById('set-calgoal').value)||2000,
      waterGoal:+(document.getElementById('set-watergoal').value)||2500,
      sleepGoal:+(document.getElementById('set-sleepgoal').value)||8,
    };
    await Promise.all([StorageManager.saveProfile(up),StorageManager.saveGoals(ug)]);
    profile=up; goals=ug; updateAvatar();
    toast('Settings saved ✓');
  }

  async function exportData(){
    const json=await StorageManager.exportAllData();
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([json],{type:'application/json'}));
    a.download=`vitalux-${StorageManager.today()}.json`;
    a.click(); toast('Data exported 📦');
  }

  async function confirmReset(){
    if(!confirm('Delete ALL data permanently?')) return;
    await StorageManager.clearAll();
    MotionTracker.stop(); location.reload();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // UTILITIES
  // ─────────────────────────────────────────────────────────────────────────────
  function set(id,text){const el=document.getElementById(id);if(el)el.textContent=text;}

  // Animated number counter
  function animCounter(id,target){
    const el=document.getElementById(id);
    if(!el) return;
    const start=+(el.textContent.replace(/,/g,''))||0;
    if(start===target){el.textContent=target.toLocaleString();return;}
    const dur=600, steps=20, delta=(target-start)/steps, step=dur/steps;
    let cur=start, i=0;
    const interval=setInterval(()=>{
      cur+=delta; i++;
      el.textContent=Math.round(cur).toLocaleString();
      if(i>=steps){el.textContent=target.toLocaleString();clearInterval(interval);}
    },step);
  }

  function setRing(id,pct){
    const el=document.getElementById(id);
    if(!el) return;
    const r=+el.getAttribute('r');
    const c=2*Math.PI*r;
    el.style.strokeDasharray=c;
    el.style.strokeDashoffset=c*(1-Math.min(pct,1));
  }

  function setGreeting(){
    const h=new Date().getHours();
    const t=h<5?'night':h<12?'morning':h<17?'afternoon':'evening';
    const n=profile?.name?`, ${profile.name.split(' ')[0]}`:'';
    set('greeting',`Good ${t}${n}.`);
  }

  function updateAvatar(){
    const av=document.getElementById('header-avatar');
    if(av&&profile?.name) av.textContent=profile.name[0].toUpperCase();
  }

  function motiveTxt(pct,steps){
    if(pct>=1)    return 'Goal crushed! Extraordinary work. 🏆';
    if(pct>=0.75) return 'Almost there — push through!';
    if(pct>=0.5)  return 'Halfway — maintain the pace. 💪';
    if(pct>=0.25) return 'Good start. Keep moving.';
    if(steps>0)   return 'Every step counts. Go!';
    return 'Tap Steps to begin tracking.';
  }

  function applyTheme(t,save=true){
    document.documentElement.dataset.theme=t;
    if(save)localStorage.setItem('theme',t);
    if(window.Chart)ChartsManager.defaults();
  }

  function onStepUpdate(count,meta){
    if(tabIdx===0) requestAnimationFrame(renderHome);
    else if(tabIdx===1) requestAnimationFrame(renderSteps);
  }

  async function autoPersist(){
    const c=MotionTracker.count;
    if(c!==lastSaved){
      const burned=AICoach.caloriesBurnedByMode(c,profile.weight,MotionTracker.mode);
      calData.burned=burned;
      await Promise.all([StorageManager.saveTodaySteps(c),StorageManager.saveTodayCalories({...calData})]);
      lastSaved=c;
      streak=await StorageManager.calculateStreak();
    }
  }

  async function checkMidnightReset(){
    const today=StorageManager.today();
    const saved=localStorage.getItem('lastActiveDay');
    if(saved&&saved!==today){
      waterMl=0; sleepData={hours:0,quality:0};
      meals={breakfast:0,lunch:0,dinner:0,snacks:0};
      localStorage.setItem('lastActiveDay',today);
    } else if(!saved){
      localStorage.setItem('lastActiveDay',today);
    }
  }

  // Install banner
  function showInstallBanner(){
    const b=document.getElementById('install-banner');
    if(!b) return;
    b.classList.add('show');
    document.getElementById('install-btn')?.addEventListener('click',async()=>{
      if(deferredInstall){
        deferredInstall.prompt();
        const{outcome}=await deferredInstall.userChoice;
        if(outcome==='accepted')b.classList.remove('show');
        deferredInstall=null;
      } else {
        toast('In Safari: Share → Add to Home Screen');
      }
    });
    document.getElementById('install-close')?.addEventListener('click',()=>b.classList.remove('show'));
  }

  function toast(msg,dur=2800){
    document.querySelector('.toast-msg')?.remove();
    const el=document.createElement('div');
    el.className='toast-msg'; el.textContent=msg;
    document.body.appendChild(el);
    requestAnimationFrame(()=>{
      el.classList.add('show');
      setTimeout(()=>{el.classList.remove('show');setTimeout(()=>el.remove(),400);},dur);
    });
  }

  return {init};
})();

document.addEventListener('DOMContentLoaded',()=>App.init());
