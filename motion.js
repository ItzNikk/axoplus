'use strict';

/**
 * MotionTracker v2 — Advanced accelerometer step detection
 *
 * Algorithm: Peak/Valley detection with adaptive thresholds
 *
 * Stage 1: Low-pass filter (α=0.12) — removes high-frequency vibration
 * Stage 2: Compute magnitude √(x²+y²+z²)
 * Stage 3: Track peaks AND valleys for robust stride detection
 * Stage 4: Adaptive threshold — updates based on recent peak/valley amplitudes
 * Stage 5: Cadence validator — rejects impossible step timings
 * Stage 6: Noise rejection — requires minimum amplitude excursion
 *
 * Battery: 20Hz sampling (50ms throttle), pauses on page hide
 */
const MotionTracker = (() => {

  // ── Algorithm config ─────────────────────────────────────────────────────────
  const CFG = {
    LP_ALPHA:          0.12,   // Low-pass coefficient
    INIT_THRESHOLD:    11.5,   // Initial step magnitude threshold (m/s²)
    THRESHOLD_LOW_MUL: 0.88,   // Low threshold = threshold * this
    MIN_STEP_MS:       230,    // Min inter-step time (~4.3 steps/sec)
    MAX_STEP_MS:       2200,   // Max inter-step time (≈slow walk, 0.45 steps/sec)
    EVENT_THROTTLE_MS: 50,     // 20 Hz
    PEAK_HISTORY:      8,      // Peak amplitudes to keep for adaptive threshold
    MIN_AMPLITUDE:     1.8,    // Min peak-to-valley amplitude to count as step
    ADAPTIVE_SPEED:    0.08,   // How fast threshold adapts
    GRAVITY:           9.81
  };

  // ── State ─────────────────────────────────────────────────────────────────────
  let running = false, paused = false, permitted = false;
  let count = 0, lastStepTs = 0, lastEventTs = 0;
  let fX=0, fY=0, fZ=0;                      // filtered components
  let prevMag = 0;                             // for slope detection
  let aboveThresh = false;                     // hysteresis state
  let peakMag = 0, valleyMag = Infinity;       // current peak/valley tracking
  let adaptiveThreshold = CFG.INIT_THRESHOLD; // evolves with user's gait
  let peakHistory = [];                        // recent peak magnitudes
  let valleyHistory = [];                      // recent valley magnitudes
  let onStepCb = null, onErrCb = null;
  let hiddenResume = false;

  // ── Low-pass filter ───────────────────────────────────────────────────────────
  const lpf = (prev, raw) => CFG.LP_ALPHA * raw + (1 - CFG.LP_ALPHA) * prev;

  // ── Adaptive threshold update ─────────────────────────────────────────────────
  function updateAdaptiveThreshold(peakVal, valleyVal) {
    peakHistory.push(peakVal);
    if (peakHistory.length > CFG.PEAK_HISTORY) peakHistory.shift();
    valleyHistory.push(valleyVal);
    if (valleyHistory.length > CFG.PEAK_HISTORY) valleyHistory.shift();

    if (peakHistory.length >= 3) {
      const avgPeak   = peakHistory.reduce((a,b)=>a+b,0) / peakHistory.length;
      const avgValley = valleyHistory.reduce((a,b)=>a+b,0) / valleyHistory.length;
      const midpoint  = (avgPeak + avgValley) / 2;
      // Smooth the threshold update
      adaptiveThreshold = adaptiveThreshold * (1 - CFG.ADAPTIVE_SPEED) + midpoint * CFG.ADAPTIVE_SPEED;
      // Clamp to reasonable range
      adaptiveThreshold = Math.max(9.2, Math.min(14.5, adaptiveThreshold));
    }
  }

  // ── Core step detection ───────────────────────────────────────────────────────
  function processSample(ax, ay, az) {
    // 1. Low-pass filter
    fX = lpf(fX, ax);
    fY = lpf(fY, ay);
    fZ = lpf(fZ, az);

    // 2. Magnitude
    const mag = Math.sqrt(fX*fX + fY*fY + fZ*fZ);
    const threshLow = adaptiveThreshold * CFG.THRESHOLD_LOW_MUL;

    // 3. Track peak/valley during current swing
    if (mag > peakMag) peakMag = mag;
    if (mag < valleyMag) valleyMag = mag;

    // 4. Hysteresis step detection (descending edge)
    const now = Date.now();

    if (!aboveThresh && mag > adaptiveThreshold) {
      aboveThresh = true;
      peakMag = mag;
    } else if (aboveThresh && mag < threshLow) {
      aboveThresh = false;

      // 5. Amplitude check — must be real stride, not vibration
      const amplitude = peakMag - valleyMag;
      if (amplitude < CFG.MIN_AMPLITUDE) {
        valleyMag = mag;
        prevMag = mag;
        return;
      }

      // 6. Cadence validation
      const elapsed = now - lastStepTs;
      const isValidCadence = lastStepTs === 0 ||
        (elapsed >= CFG.MIN_STEP_MS && elapsed <= CFG.MAX_STEP_MS + 1000);

      if (isValidCadence) {
        // Update adaptive threshold
        if (lastStepTs > 0) updateAdaptiveThreshold(peakMag, valleyMag);

        count++;
        lastStepTs = now;
        if (onStepCb) onStepCb(count);
      }

      // Reset peak/valley for next stride
      valleyMag = mag;
      peakMag = 0;
    }

    prevMag = mag;
  }

  // ── Event handler ─────────────────────────────────────────────────────────────
  function onMotion(e) {
    const now = Date.now();
    if (now - lastEventTs < CFG.EVENT_THROTTLE_MS) return;
    lastEventTs = now;

    const acc = e.accelerationIncludingGravity;
    if (acc && acc.x !== null && acc.x !== undefined) {
      processSample(acc.x, acc.y, acc.z);
      return;
    }
    const a = e.acceleration;
    if (a && a.x !== null) {
      processSample(a.x, a.y, a.z + CFG.GRAVITY);
    }
  }

  // ── Permission ────────────────────────────────────────────────────────────────
  async function requestPermission() {
    if (typeof DeviceMotionEvent === 'undefined') {
      if (onErrCb) onErrCb('DeviceMotion not supported');
      return false;
    }
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      try {
        const r = await DeviceMotionEvent.requestPermission();
        permitted = r === 'granted';
        if (!permitted && onErrCb) onErrCb('Motion permission denied');
      } catch(err) {
        permitted = false;
        if (onErrCb) onErrCb(err.message);
      }
    } else {
      permitted = true;
    }
    return permitted;
  }

  // ── Public control ────────────────────────────────────────────────────────────
  async function start({ initial=0, onStep=null, onErr=null }={}) {
    onStepCb = onStep; onErrCb = onErr;
    count = initial;
    if (!permitted) {
      const ok = await requestPermission();
      if (!ok) return false;
    }
    window.addEventListener('devicemotion', onMotion, { passive:true });
    running = true; paused = false;
    scheduleMidnight();
    return true;
  }

  function stop()  {
    window.removeEventListener('devicemotion', onMotion);
    running = false; paused = false;
  }

  function pause() {
    if (!running || paused) return;
    window.removeEventListener('devicemotion', onMotion);
    paused = true;
  }

  async function resume() {
    if (!running || !paused) return;
    if (!permitted) { const ok=await requestPermission(); if(!ok)return; }
    window.addEventListener('devicemotion', onMotion, { passive:true });
    paused = false;
  }

  function reset(initial=0) {
    count=initial; lastStepTs=0; fX=0; fY=0; fZ=0;
    aboveThresh=false; peakMag=0; valleyMag=Infinity;
    peakHistory=[]; valleyHistory=[];
    adaptiveThreshold=CFG.INIT_THRESHOLD;
  }

  function scheduleMidnight() {
    const now=new Date(), midnight=new Date(now);
    midnight.setHours(24,0,3,0);
    setTimeout(()=>{ reset(); if(onStepCb)onStepCb(0); scheduleMidnight(); }, midnight-now);
  }

  // ── Visibility ────────────────────────────────────────────────────────────────
  document.addEventListener('visibilitychange',()=>{
    if (document.hidden && running && !paused) { pause(); hiddenResume=true; }
    else if (!document.hidden && hiddenResume) { resume(); hiddenResume=false; }
  });

  return {
    start, stop, pause, resume, reset, requestPermission,
    get count()     { return count; },
    get isRunning() { return running && !paused; },
    get isPaused()  { return paused; },
    get threshold() { return adaptiveThreshold.toFixed(2); }
  };
})();
