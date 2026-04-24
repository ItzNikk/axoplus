'use strict';

/**
 * MotionTracker v3 — Production-grade step detection
 *
 * ═══ PERMISSION FIX ═══════════════════════════════════════════════════
 * iOS 13+ requires DeviceMotionEvent.requestPermission() to be called
 * DIRECTLY inside a user-gesture handler (click/touchend).
 * call MotionTracker.requestPermission() from a button click event.
 * ══════════════════════════════════════════════════════════════════════
 *
 * ═══ ALGORITHM ════════════════════════════════════════════════════════
 * Stage 1: Raw → Butterworth-inspired 2nd-order low-pass (fc=5Hz@20Hz)
 *           Equivalent IIR: y[n] = b0*x[n]+b1*x[n-1]+b2*x[n-2]-a1*y[n-1]-a2*y[n-2]
 *           Coefficients tuned for 5Hz cutoff at 20Hz sampling
 * Stage 2: Magnitude = √(x²+y²+z²)  then subtract gravity estimate (DC removal)
 * Stage 3: Vertical-axis emphasis: weight Y-axis 60%, magnitude 40%
 * Stage 4: Peak detection with adaptive threshold (ring buffer of 8 peak amplitudes)
 * Stage 5: Cadence ring buffer — validates step timing, detects walk vs run
 * Stage 6: Shake rejection — 3+ rapid events in 150ms → ignore
 * ══════════════════════════════════════════════════════════════════════
 */
const MotionTracker = (() => {

  // ── Butterworth 2nd-order LP coefficients (5Hz cutoff, 20Hz sample) ──────────
  // Pre-warped: fc=5, fs=20 → wc=2*tan(π*fc/fs)=2*tan(π/4)=2
  // Bilinear transform coefficients:
  const B0=0.0640, B1=0.1279, B2=0.0640;
  const A1=-1.1683, A2=0.4124;

  // ── Config ────────────────────────────────────────────────────────────────────
  const CFG={
    EVENT_HZ:        20,    // 20Hz sample rate
    THROTTLE_MS:     50,    // 1000/20
    INIT_THRESH:     1.2,   // Initial threshold for de-trended signal (m/s²)
    THRESH_LOW_MUL:  0.72,  // Hysteresis low = thresh * mul
    MIN_STEP_MS:     230,   // 4.3 steps/sec max
    MAX_STEP_MS:     2400,  // 0.42 steps/sec min (very slow walk)
    PEAK_BUF:        10,    // Adaptive threshold ring buffer size
    MIN_AMPLITUDE:   0.55,  // Min peak-to-valley (de-trended)
    ADAPT_SPEED:     0.10,  // Threshold adaptation rate
    SHAKE_WINDOW_MS: 180,   // Shake detection window
    SHAKE_COUNT:     4,     // Events in window = shake
    CADENCE_BUF:     6,     // Steps for cadence calculation
    WALK_MAX_STP_S:  2.2,   // Walk ≤ 2.2 steps/sec
    GRAVITY_ALPHA:   0.998  // DC removal for gravity
  };

  // ── State ─────────────────────────────────────────────────────────────────────
  let permitted=false, running=false, paused=false;
  let count=0, lastStepTs=0, lastEvtTs=0;

  // IIR filter state (x=input history, y=output history)
  let xH=[0,0,0], yH=[0,0,0];   // magnitude filter
  let gravY=0;                   // gravity DC for Y axis

  // Peak/valley
  let aboveThresh=false, peakVal=0, valleyVal=Infinity;
  let adaptThresh=CFG.INIT_THRESH;
  let peakBuf=[], valleyBuf=[];

  // Shake rejection
  let shakeTs=[];

  // Cadence
  let stepIntervals=[];
  let cadenceStepsPerMin=0;
  let workoutMode='walk'; // 'walk' | 'run'

  let onStepCb=null, onErrCb=null, onPermCb=null;
  let midnightTimer=null;
  let visHidden=false;

  // ── 2nd-order Butterworth IIR ─────────────────────────────────────────────────
  function iirFilter(x) {
    xH[2]=xH[1]; xH[1]=xH[0]; xH[0]=x;
    const y = B0*xH[0] + B1*xH[1] + B2*xH[2] - A1*yH[0] - A2*yH[1];
    yH[1]=yH[0]; yH[0]=y;
    return y;
  }

  // ── DC removal (gravity estimation via very slow LP) ──────────────────────────
  function dcRemove(sample, dcRef) {
    return sample - dcRef;
  }

  // ── Adaptive threshold update ─────────────────────────────────────────────────
  function updateThreshold(peak, valley) {
    peakBuf.push(peak);   if(peakBuf.length>CFG.PEAK_BUF)   peakBuf.shift();
    valleyBuf.push(valley);if(valleyBuf.length>CFG.PEAK_BUF) valleyBuf.shift();
    if(peakBuf.length>=3){
      const avgP=peakBuf.reduce((a,b)=>a+b,0)/peakBuf.length;
      const avgV=valleyBuf.reduce((a,b)=>a+b,0)/valleyBuf.length;
      const mid=(avgP+avgV)/2;
      adaptThresh=adaptThresh*(1-CFG.ADAPT_SPEED)+mid*CFG.ADAPT_SPEED;
      adaptThresh=Math.max(0.45, Math.min(3.5, adaptThresh));
    }
  }

  // ── Cadence & mode detection ──────────────────────────────────────────────────
  function updateCadence(interval_ms) {
    stepIntervals.push(interval_ms);
    if(stepIntervals.length>CFG.CADENCE_BUF) stepIntervals.shift();
    if(stepIntervals.length>=2){
      const avg=stepIntervals.reduce((a,b)=>a+b,0)/stepIntervals.length;
      cadenceStepsPerMin=Math.round(60000/avg);
      workoutMode=cadenceStepsPerMin>120?'run':'walk';
    }
  }

  // ── Shake detection ───────────────────────────────────────────────────────────
  function isShake(now) {
    shakeTs.push(now);
    shakeTs=shakeTs.filter(t=>now-t<CFG.SHAKE_WINDOW_MS);
    return shakeTs.length>=CFG.SHAKE_COUNT;
  }

  // ── Core processing ───────────────────────────────────────────────────────────
  function process(ax, ay, az) {
    // 1. Update gravity DC estimate (very slow LP)
    gravY=CFG.GRAVITY_ALPHA*gravY+(1-CFG.GRAVITY_ALPHA)*ay;

    // 2. De-trended Y (vertical axis - most step energy)
    const detrendY=dcRemove(ay, gravY);

    // 3. Raw magnitude
    const rawMag=Math.sqrt(ax*ax+ay*ay+az*az);

    // 4. IIR filter on blended signal (60% Y, 40% magnitude deviation from 9.81)
    const magDev=rawMag-9.81;
    const blended=0.60*detrendY+0.40*magDev;
    const filtered=iirFilter(blended);

    const now=Date.now();
    const lo=adaptThresh*CFG.THRESH_LOW_MUL;

    // 5. Track peak/valley
    if(filtered>peakVal) peakVal=filtered;
    if(filtered<valleyVal) valleyVal=filtered;

    // 6. Hysteresis peak detection (descending edge)
    if(!aboveThresh && filtered>adaptThresh){
      aboveThresh=true;
      peakVal=filtered;
    } else if(aboveThresh && filtered<lo){
      aboveThresh=false;

      // Amplitude check
      const amplitude=peakVal-valleyVal;
      if(amplitude<CFG.MIN_AMPLITUDE){ valleyVal=filtered; peakVal=0; return; }

      // Shake rejection
      if(isShake(now)){ valleyVal=filtered; peakVal=0; return; }

      // Cadence validation
      const elapsed=now-lastStepTs;
      const valid=lastStepTs===0||(elapsed>=CFG.MIN_STEP_MS&&elapsed<=CFG.MAX_STEP_MS+800);

      if(valid){
        if(lastStepTs>0){
          updateThreshold(peakVal,valleyVal);
          updateCadence(elapsed);
        }
        count++;
        lastStepTs=now;
        if(onStepCb) onStepCb(count, {cadence:cadenceStepsPerMin, mode:workoutMode});
      }

      valleyVal=filtered; peakVal=0;
    }
  }

  // ── Event handler ─────────────────────────────────────────────────────────────
  function onMotion(e){
    const now=Date.now();
    if(now-lastEvtTs<CFG.THROTTLE_MS) return;
    lastEvtTs=now;

    const g=e.accelerationIncludingGravity;
    if(g&&g.x!==null&&g.x!==undefined){ process(g.x,g.y,g.z); return; }
    const a=e.acceleration;
    if(a&&a.x!==null&&a.x!==undefined){ process(a.x,a.y,a.z+9.81); }
  }

  // ── Permission ────────────────────────────────────────────────────────────────
  /**
   * MUST be called directly from a user gesture (button click) on iOS.
   * Returns: 'granted' | 'denied' | 'unavailable' | 'not_required'
   */
  async function requestPermission(){
    if(typeof DeviceMotionEvent==='undefined'){
      if(onErrCb) onErrCb('DeviceMotion not supported on this device.');
      return 'unavailable';
    }
    if(typeof DeviceMotionEvent.requestPermission!=='function'){
      // Android / desktop — no permission needed
      permitted=true;
      return 'not_required';
    }
    try{
      const result=await DeviceMotionEvent.requestPermission();
      permitted=(result==='granted');
      if(!permitted && onErrCb) onErrCb('Motion permission denied by user.');
      if(onPermCb) onPermCb(permitted);
      return result; // 'granted' | 'denied'
    }catch(err){
      permitted=false;
      if(onErrCb) onErrCb('Permission request failed: '+err.message);
      return 'denied';
    }
  }

  // ── Start / Stop / Pause / Resume ─────────────────────────────────────────────
  function attachListener(){
    window.addEventListener('devicemotion',onMotion,{passive:true});
  }
  function detachListener(){
    window.removeEventListener('devicemotion',onMotion);
  }

  async function start({initial=0,onStep=null,onErr=null,onPerm=null}={}){
    onStepCb=onStep; onErrCb=onErr; onPermCb=onPerm;
    count=initial;
    running=true; paused=false;

    if(!permitted){
      // On Android/desktop this returns immediately
      // On iOS this should already have been called via requestPermission()
      if(typeof DeviceMotionEvent!=='undefined'&&typeof DeviceMotionEvent.requestPermission!=='function'){
        permitted=true;
      } else {
        // Permission not yet granted — don't attach listener
        return false;
      }
    }

    attachListener();
    scheduleMidnight();
    return true;
  }

  function stop(){ detachListener(); running=false; paused=false; clearTimeout(midnightTimer); }
  function pause(){ if(!running||paused)return; detachListener(); paused=true; }
  async function resume(){
    if(!running||!paused)return;
    if(!permitted){ if(onErrCb)onErrCb('Permission needed'); return; }
    attachListener(); paused=false;
  }
  function reset(initial=0){
    count=initial; lastStepTs=0; lastEvtTs=0;
    xH=[0,0,0]; yH=[0,0,0]; gravY=0;
    aboveThresh=false; peakVal=0; valleyVal=Infinity;
    adaptThresh=CFG.INIT_THRESH;
    peakBuf=[]; valleyBuf=[]; shakeTs=[]; stepIntervals=[];
    cadenceStepsPerMin=0; workoutMode='walk';
  }

  function scheduleMidnight(){
    const now=new Date(), m=new Date(now);
    m.setHours(24,0,4,0);
    midnightTimer=setTimeout(()=>{ reset(); if(onStepCb)onStepCb(0,{cadence:0,mode:'walk'}); scheduleMidnight(); },m-now);
  }

  // ── Visibility ────────────────────────────────────────────────────────────────
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden&&running&&!paused){ pause(); visHidden=true; }
    else if(!document.hidden&&visHidden){ resume(); visHidden=false; }
  });

  // ── Public API ────────────────────────────────────────────────────────────────
  return {
    requestPermission, start, stop, pause, resume, reset,
    get count()      { return count; },
    get isRunning()  { return running&&!paused; },
    get isPaused()   { return paused; },
    get isPermitted(){ return permitted; },
    get cadence()    { return cadenceStepsPerMin; },
    get mode()       { return workoutMode; },
    get threshold()  { return adaptThresh.toFixed(2); }
  };
})();
