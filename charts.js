'use strict';

/**
 * ChartsManager v3 — 7 Chart types, theme-aware, smooth animations
 */
const ChartsManager = (() => {

  const inst={};

  function C(){
    const dark=document.documentElement.dataset.theme!=='light';
    return {
      cyan:'#00D4FF',    cyanA:'rgba(0,212,255,0.18)',
      purple:'#7B61FF',  purpA:'rgba(123,97,255,0.20)',
      orange:'#FF6B35',  oranA:'rgba(255,107,53,0.18)',
      green:'#30D158',   grenA:'rgba(48,209,88,0.18)',
      gold:'#FFD60A',    goldA:'rgba(255,214,10,0.18)',
      text:   dark?'rgba(255,255,255,0.42)':'rgba(0,0,0,0.42)',
      grid:   dark?'rgba(255,255,255,0.055)':'rgba(0,0,0,0.065)',
      ttBg:   dark?'rgba(16,16,24,0.94)':'rgba(255,255,255,0.95)',
      ttTxt:  dark?'#fff':'#111',
      barFade:dark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.07)'
    };
  }

  const font={family:"'DM Sans','SF Pro Display',system-ui,sans-serif",size:11};

  function defaults(){
    if(!window.Chart)return;
    const c=C();
    Chart.defaults.color=c.text; Chart.defaults.font=font;
    Chart.defaults.animation.duration=650; Chart.defaults.animation.easing='easeInOutQuart';
    Chart.defaults.plugins.legend.display=false;
    const tt=Chart.defaults.plugins.tooltip;
    tt.backgroundColor=c.ttBg; tt.titleColor=c.ttTxt; tt.bodyColor=c.ttTxt;
    tt.borderColor='rgba(128,128,128,0.14)'; tt.borderWidth=1;
    tt.padding=10; tt.cornerRadius=10;
  }

  const shortDay=s=>['Su','Mo','Tu','We','Th','Fr','Sa'][new Date(s+'T00:00:00').getDay()];
  const shortDate=s=>{const d=new Date(s+'T00:00:00');return`${d.getDate()}/${d.getMonth()+1}`;};
  const destroy=id=>{if(inst[id]){inst[id].destroy();delete inst[id];}};

  function xAxis(labels){const c=C();return{type:'category',labels,grid:{display:false},ticks:{color:c.text,font,maxRotation:0}};}
  function yAxis(o={}){const c=C();return{grid:{color:c.grid,drawBorder:false},ticks:{color:c.text,font,...(o.ticks||{})},min:o.min,suggestedMin:o.suggestedMin,beginAtZero:o.beginAtZero!==false};}

  // ── 1. Daily Steps Bar ─────────────────────────────────────────────────────────
  async function dailySteps(id){
    const data=await StorageManager.getStepsHistory(7);
    const c=C();
    const labels=data.map(d=>shortDay(d.date));
    const values=data.map(d=>d.count);
    const colors=values.map(v=>v>0?c.cyan:c.barFade);
    destroy(id); const ctx=document.getElementById(id)?.getContext('2d'); if(!ctx)return;
    inst[id]=new Chart(ctx,{type:'bar',data:{labels,datasets:[{data:values,backgroundColor:colors,borderRadius:8,borderSkipped:false,barPercentage:0.6}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{tooltip:{callbacks:{label:c=>` ${c.raw.toLocaleString()} steps`}}},scales:{x:xAxis(labels),y:yAxis({beginAtZero:true})}}});
  }

  // ── 2. Weekly Steps ────────────────────────────────────────────────────────────
  async function weeklySteps(id){
    const data=await StorageManager.getStepsHistory(28);
    const c=C();
    const weeks=[0,0,0,0];
    data.forEach((d,i)=>{weeks[Math.floor(i/7)]+=d.count;});
    const labels=['Wk -3','Wk -2','Last Wk','This Wk'];
    destroy(id); const ctx=document.getElementById(id)?.getContext('2d'); if(!ctx)return;
    inst[id]=new Chart(ctx,{type:'bar',data:{labels,datasets:[{data:weeks,backgroundColor:[`${c.cyan}33`,`${c.cyan}55`,`${c.cyan}88`,c.cyan],borderRadius:12,borderSkipped:false,barPercentage:0.62}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{tooltip:{callbacks:{label:d=>` ${d.raw.toLocaleString()} steps`}}},scales:{x:xAxis(labels),y:yAxis({beginAtZero:true})}}});
  }

  // ── 3. Weight Trend ────────────────────────────────────────────────────────────
  async function weightTrend(id){
    const history=await StorageManager.getWeightHistory(30);
    const map={};history.forEach(e=>{map[e.date]=e.value;});
    const dates=Object.keys(map).sort(), values=dates.map(d=>map[d]);
    const c=C();
    destroy(id); const ctx=document.getElementById(id)?.getContext('2d'); if(!ctx)return;
    const g=ctx.createLinearGradient(0,0,0,200);
    g.addColorStop(0,'rgba(123,97,255,0.32)'); g.addColorStop(1,'rgba(123,97,255,0)');
    const labels=dates.map(shortDate);
    const minV=values.length?Math.min(...values)-2:0;
    inst[id]=new Chart(ctx,{type:'line',data:{labels,datasets:[{data:values,borderColor:c.purple,backgroundColor:g,borderWidth:2.5,pointRadius:dates.length<=7?4:2,pointBackgroundColor:c.purple,tension:0.4,fill:true}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{tooltip:{callbacks:{label:d=>` ${d.raw} kg`}}},scales:{x:xAxis(labels),y:yAxis({min:minV,beginAtZero:false})}}});
  }

  // ── 4. Calorie Grouped Bar ─────────────────────────────────────────────────────
  async function calories(id){
    const data=await StorageManager.getCaloriesHistory(7);
    const c=C();
    const labels=data.map(d=>shortDay(d.date));
    destroy(id); const ctx=document.getElementById(id)?.getContext('2d'); if(!ctx)return;
    inst[id]=new Chart(ctx,{type:'bar',
      data:{labels,datasets:[
        {label:'Intake',data:data.map(d=>d.intake),backgroundColor:c.green,borderRadius:5,borderSkipped:false,barPercentage:0.4,categoryPercentage:0.8},
        {label:'Burned',data:data.map(d=>d.burned),backgroundColor:c.orange,borderRadius:5,borderSkipped:false,barPercentage:0.4,categoryPercentage:0.8}
      ]},
      options:{responsive:true,maintainAspectRatio:false,
        plugins:{legend:{display:true,labels:{color:C().text,font,boxWidth:10,boxHeight:10,padding:12}},tooltip:{callbacks:{label:d=>` ${d.dataset.label}: ${d.raw.toLocaleString()} kcal`}}},
        scales:{x:xAxis(labels),y:yAxis({beginAtZero:true})}}});
  }

  // ── 5. Water History Bar ───────────────────────────────────────────────────────
  async function waterHistory(id){
    const data=await StorageManager.getWaterHistory(7);
    const c=C();
    const labels=data.map(d=>shortDay(d.date));
    const colors=data.map(d=>d.ml>0?c.cyan:c.barFade);
    destroy(id); const ctx=document.getElementById(id)?.getContext('2d'); if(!ctx)return;
    inst[id]=new Chart(ctx,{type:'bar',data:{labels,datasets:[{data:data.map(d=>d.ml),backgroundColor:colors,borderRadius:7,borderSkipped:false,barPercentage:0.6}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{tooltip:{callbacks:{label:d=>` ${d.raw} ml`}}},scales:{x:xAxis(labels),y:yAxis({beginAtZero:true})}}});
  }

  // ── 6. Sleep History ───────────────────────────────────────────────────────────
  async function sleepHistory(id){
    const data=await StorageManager.getSleepHistory(7);
    const c=C();
    const labels=data.map(d=>shortDay(d.date));
    const colors=data.map(d=>d.hours>=7?c.purple:`${c.purple}55`);
    destroy(id); const ctx=document.getElementById(id)?.getContext('2d'); if(!ctx)return;
    inst[id]=new Chart(ctx,{type:'bar',data:{labels,datasets:[{data:data.map(d=>d.hours),backgroundColor:colors,borderRadius:7,borderSkipped:false,barPercentage:0.6}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{tooltip:{callbacks:{label:d=>` ${d.raw}h sleep`}}},scales:{x:xAxis(labels),y:yAxis({beginAtZero:true,ticks:{callback:v=>`${v}h`}})}}});
  }

  // ── 7. Summary area line ───────────────────────────────────────────────────────
  async function summarySteps(id){
    const data=await StorageManager.getStepsHistory(7);
    const c=C();
    const labels=data.map(d=>shortDay(d.date));
    destroy(id); const ctx=document.getElementById(id)?.getContext('2d'); if(!ctx)return;
    const g=ctx.createLinearGradient(0,0,0,140);
    g.addColorStop(0,'rgba(0,212,255,0.45)'); g.addColorStop(1,'rgba(0,212,255,0)');
    inst[id]=new Chart(ctx,{type:'line',data:{labels,datasets:[{data:data.map(d=>d.count),borderColor:c.cyan,backgroundColor:g,borderWidth:2,pointRadius:3,pointBackgroundColor:c.cyan,tension:0.4,fill:true}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{tooltip:{callbacks:{label:d=>` ${d.raw.toLocaleString()} steps`}}},scales:{x:xAxis(labels),y:yAxis({beginAtZero:true})}}});
  }

  async function refreshAll(){
    defaults();
    await Promise.allSettled([
      dailySteps('chart-daily-steps'),weeklySteps('chart-weekly-steps'),
      weightTrend('chart-weight'),calories('chart-calories'),
      waterHistory('chart-water'),sleepHistory('chart-sleep'),
      summarySteps('chart-summary-steps')
    ]);
  }

  return {defaults,dailySteps,weeklySteps,weightTrend,calories,waterHistory,sleepHistory,summarySteps,refreshAll};
})();
