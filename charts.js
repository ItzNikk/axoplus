'use strict';

/**
 * ChartsManager — Chart.js data visualizations
 * Renders: daily steps, weekly steps, weight trend, calorie balance, summary
 */
const ChartsManager = (() => {

  const instances = {};

  // ── Tokens ────────────────────────────────────────────────────────────────────
  const getColors = () => {
    const dark = document.documentElement.dataset.theme !== 'light';
    return {
      cyan:    '#00D4FF',
      cyanFill: 'rgba(0,212,255,0.15)',
      orange:  '#FF6B35',
      orangeFill: 'rgba(255,107,53,0.15)',
      purple:  '#7B61FF',
      purpleFill: 'rgba(123,97,255,0.18)',
      green:   '#30D158',
      text:    dark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)',
      grid:    dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)',
      tooltip: dark ? 'rgba(20,20,30,0.92)' : 'rgba(255,255,255,0.92)',
      tooltipText: dark ? '#fff' : '#111',
    };
  };

  const font = { family:"'Space Grotesk','SF Pro Display',system-ui,sans-serif", size:11 };

  function setupDefaults() {
    if (!window.Chart) return;
    const C = getColors();
    Chart.defaults.color = C.text;
    Chart.defaults.font  = font;
    Chart.defaults.animation.duration = 700;
    Chart.defaults.animation.easing   = 'easeInOutQuart';
    Chart.defaults.plugins.legend.display = false;
    const tt = Chart.defaults.plugins.tooltip;
    tt.backgroundColor = C.tooltip;
    tt.titleColor = C.tooltipText;
    tt.bodyColor  = C.tooltipText;
    tt.borderColor = 'rgba(128,128,128,0.15)';
    tt.borderWidth = 1;
    tt.padding     = 10;
    tt.cornerRadius = 10;
  }

  // ── Shared scale builders ─────────────────────────────────────────────────────
  function xAxis(labels) {
    return { type:'category', labels, grid:{display:false}, ticks:{color:getColors().text, font, maxRotation:0} };
  }
  function yAxis(opts={}) {
    const C=getColors();
    return {
      grid: { color:C.grid, drawBorder:false },
      ticks: { color:C.text, font, ...opts.ticks },
      min:  opts.min,
      suggestedMin: opts.suggestedMin,
      beginAtZero: opts.beginAtZero !== false
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────
  const shortDay  = s => ['Su','Mo','Tu','We','Th','Fr','Sa'][new Date(s+'T00:00:00').getDay()];
  const shortDate = s => { const d=new Date(s+'T00:00:00'); return `${d.getDate()}/${d.getMonth()+1}`; };

  function destroy(id) {
    if (instances[id]) { instances[id].destroy(); delete instances[id]; }
  }

  // ── 1. Daily Steps Bar ─────────────────────────────────────────────────────────
  async function dailySteps(id) {
    const data   = await StorageManager.getStepsHistory(7);
    const labels = data.map(d=>shortDay(d.date));
    const values = data.map(d=>d.count);
    const C      = getColors();
    const colors = values.map(v=>v>0?C.cyan:'rgba(128,128,128,0.15)');

    destroy(id);
    const ctx = document.getElementById(id)?.getContext('2d');
    if (!ctx) return;

    instances[id] = new Chart(ctx, {
      type:'bar',
      data:{ labels, datasets:[{ data:values, backgroundColor:colors, borderRadius:8, borderSkipped:false, barPercentage:0.6 }] },
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{ tooltip:{ callbacks:{ label:c=>` ${c.raw.toLocaleString()} steps` }}},
        scales:{ x:xAxis(labels), y:yAxis({ beginAtZero:true }) }
      }
    });
  }

  // ── 2. Weekly Steps Bar ────────────────────────────────────────────────────────
  async function weeklySteps(id) {
    const data  = await StorageManager.getStepsHistory(28);
    const weeks = [0,0,0,0];
    data.forEach((d,i)=>{ weeks[Math.floor(i/7)] += d.count; });
    const C      = getColors();
    const labels = ['Wk-3','Wk-2','Last Week','This Week'];

    destroy(id);
    const ctx = document.getElementById(id)?.getContext('2d');
    if (!ctx) return;

    instances[id] = new Chart(ctx, {
      type:'bar',
      data:{ labels, datasets:[{ data:weeks, backgroundColor:[`${C.cyan}44`,`${C.cyan}66`,`${C.cyan}88`,C.cyan], borderRadius:10, borderSkipped:false, barPercentage:0.65 }] },
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{ tooltip:{ callbacks:{ label:c=>` ${c.raw.toLocaleString()} steps` }}},
        scales:{ x:xAxis(labels), y:yAxis({ beginAtZero:true }) }
      }
    });
  }

  // ── 3. Weight Trend Line ───────────────────────────────────────────────────────
  async function weightTrend(id) {
    const history = await StorageManager.getWeightHistory(30);
    const map = {}; history.forEach(e=>{ map[e.date]=e.value; });
    const dates  = Object.keys(map).sort();
    const values = dates.map(d=>map[d]);
    const C      = getColors();

    destroy(id);
    const ctx = document.getElementById(id)?.getContext('2d');
    if (!ctx) return;

    const grad = ctx.createLinearGradient(0,0,0,200);
    grad.addColorStop(0,  'rgba(123,97,255,0.3)');
    grad.addColorStop(1,  'rgba(123,97,255,0)');

    const labels = dates.map(shortDate);
    const minVal = values.length ? Math.min(...values)-2 : 0;

    instances[id] = new Chart(ctx, {
      type:'line',
      data:{ labels, datasets:[{
        data:values, borderColor:C.purple, backgroundColor:grad,
        borderWidth:2.5, pointRadius:dates.length<=7?4:2,
        pointBackgroundColor:C.purple, tension:0.4, fill:true
      }]},
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{ tooltip:{ callbacks:{ label:c=>` ${c.raw} kg` }}},
        scales:{ x:xAxis(labels), y:yAxis({ min:minVal, beginAtZero:false }) }
      }
    });
  }

  // ── 4. Calorie Grouped Bar ─────────────────────────────────────────────────────
  async function calories(id) {
    const data   = await StorageManager.getCaloriesHistory(7);
    const labels = data.map(d=>shortDay(d.date));
    const intake = data.map(d=>d.intake);
    const burned = data.map(d=>d.burned);
    const C      = getColors();

    destroy(id);
    const ctx = document.getElementById(id)?.getContext('2d');
    if (!ctx) return;

    instances[id] = new Chart(ctx, {
      type:'bar',
      data:{ labels, datasets:[
        { label:'Intake', data:intake, backgroundColor:C.green, borderRadius:5, borderSkipped:false, barPercentage:0.4, categoryPercentage:0.8 },
        { label:'Burned', data:burned, backgroundColor:C.orange, borderRadius:5, borderSkipped:false, barPercentage:0.4, categoryPercentage:0.8 }
      ]},
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{
          legend:{ display:true, labels:{ color:C.text, font, boxWidth:10, boxHeight:10, padding:12 }},
          tooltip:{ callbacks:{ label:c=>` ${c.dataset.label}: ${c.raw.toLocaleString()} kcal` }}
        },
        scales:{ x:xAxis(labels), y:yAxis({ beginAtZero:true }) }
      }
    });
  }

  // ── 5. Summary Radar / Bar ─────────────────────────────────────────────────────
  async function summarySteps(id) {
    const data   = await StorageManager.getStepsHistory(7);
    const labels = data.map(d=>shortDay(d.date));
    const values = data.map(d=>d.count);
    const C      = getColors();

    destroy(id);
    const ctx = document.getElementById(id)?.getContext('2d');
    if (!ctx) return;

    const grad = ctx.createLinearGradient(0,0,0,150);
    grad.addColorStop(0,  'rgba(0,212,255,0.5)');
    grad.addColorStop(1,  'rgba(0,212,255,0)');

    instances[id] = new Chart(ctx, {
      type:'line',
      data:{ labels, datasets:[{
        data:values, borderColor:C.cyan, backgroundColor:grad,
        borderWidth:2, pointRadius:3, pointBackgroundColor:C.cyan, tension:0.4, fill:true
      }]},
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{ tooltip:{ callbacks:{ label:c=>` ${c.raw.toLocaleString()} steps` }}},
        scales:{ x:xAxis(labels), y:yAxis({ beginAtZero:true }) }
      }
    });
  }

  async function refreshAll() {
    setupDefaults();
    await Promise.allSettled([
      dailySteps('chart-daily-steps'),
      weeklySteps('chart-weekly-steps'),
      weightTrend('chart-weight'),
      calories('chart-calories'),
      summarySteps('chart-summary-steps')
    ]);
  }

  return { setupDefaults, dailySteps, weeklySteps, weightTrend, calories, summarySteps, refreshAll };
})();
