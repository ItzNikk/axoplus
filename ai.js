'use strict';

/**
 * AICoach v3 — Comprehensive fitness intelligence
 * All calculations, coaching, insights, and smart suggestions
 */
const AICoach = (() => {

  // ── Fitness Calculations ──────────────────────────────────────────────────────
  function bmr({weight,height,age,gender}){
    const b=10*weight+6.25*height-5*age;
    return Math.round(gender==='male'?b+5:b-161);
  }
  function tdee(bmrVal,activityLevel='moderate'){
    const m={sedentary:1.2,light:1.375,moderate:1.55,active:1.725,veryActive:1.9};
    return Math.round(bmrVal*(m[activityLevel]||1.55));
  }
  function caloriesBurned(steps,weight,activityLevel='moderate'){
    // MET-based: walking MET≈3.5, running MET≈7
    const MET=3.5, stepsPerMin=steps>0?100:0;
    const min=steps/100;
    const base=min*(MET*3.5/200)*weight;
    const m={sedentary:0.82,light:0.91,moderate:1.0,active:1.1,veryActive:1.2};
    return Math.round(base*(m[activityLevel]||1.0));
  }
  function calorieGoal(profile){
    const b=bmr(profile),t=tdee(b,profile.activityLevel||'moderate');
    return profile.goal==='lose'?Math.max(t-500,1200):profile.goal==='gain'?t+300:t;
  }
  function bmi(weight,height){ return weight/Math.pow(height/100,2); }
  function bmiLabel(b){ return b<18.5?'Underweight':b<25?'Healthy':b<30?'Overweight':'Obese'; }
  function waterGoalMl(weight){ return Math.round(weight*35); } // 35ml/kg
  function idealSleep(){ return 8; }
  function macroSplit(goal){
    if(goal==='gain')   return {protein:30,carbs:50,fat:20};
    if(goal==='lose')   return {protein:35,carbs:40,fat:25};
    return                     {protein:25,carbs:50,fat:25};
  }

  // ── Step calorie burn by mode ─────────────────────────────────────────────────
  function caloriesBurnedByMode(steps,weight,mode='walk'){
    const MET=mode==='run'?7.0:3.5;
    const min=steps/100;
    return Math.round(min*(MET*3.5/200)*weight);
  }

  // ── AI Session (chat messages) ────────────────────────────────────────────────
  function generateSession(data){
    const {steps,goals,calories,trend,streak,profile,weeklyInsights,water,sleep,mode} = data;
    const sg=goals.stepGoal||8000;
    const pct=Math.round((steps/sg)*100);
    const burned=caloriesBurnedByMode(steps,profile.weight,mode);
    const balance=(calories.intake||0)-burned;
    const wGoal=goals.waterGoal||waterGoalMl(profile.weight);
    const waterPct=Math.round((water||0)/wGoal*100);

    const msgs=[];

    // Greeting
    const h=new Date().getHours();
    const t=h<5?'night':h<12?'morning':h<17?'afternoon':'evening';
    const n=profile.name?`, ${profile.name.split(' ')[0]}`:'';
    msgs.push({
      text:`Good ${t}${n}! ${h<12?'Fresh start — let\'s review your data.':h<17?'Mid-day check-in.':'Here\'s your evening breakdown.'} 📊`,
      delay:400, think:700
    });

    // Steps
    const modeIcon=mode==='run'?'🏃':'🚶';
    if(pct>=100) msgs.push({text:`${modeIcon} **${steps.toLocaleString()} steps** — goal crushed at ${pct}%! You've burned ~**${burned} kcal** ${mode==='run'?'running':'walking'} and covered ~${(steps*0.000762).toFixed(1)} km.`,delay:1800,think:1200});
    else if(pct>=60) msgs.push({text:`${modeIcon} **${steps.toLocaleString()} steps** (${pct}% of ${sg.toLocaleString()}). ${(sg-steps).toLocaleString()} more to go — a ${Math.round((sg-steps)/100)}-min walk will do it.`,delay:1800,think:1200});
    else msgs.push({text:`${modeIcon} **${steps.toLocaleString()} steps** today (${pct}%). Your ${sg.toLocaleString()}-step goal needs ${(sg-steps).toLocaleString()} more steps. Let's move!`,delay:1800,think:1200});

    // Calories
    if(calories.intake===0){
      msgs.push({text:`🍽️ No calories logged yet. Log your meals to get nutrition insights. Estimated burn so far: **${burned} kcal**.`,delay:1700,think:1100});
    } else {
      const balStr=(balance>0?'+':'')+Math.round(balance)+' kcal';
      const intent=profile.goal==='lose'&&balance>300?'⚠️ Surplus working against goal':
                   profile.goal==='gain'&&balance<0?'⚠️ Deficit limiting muscle gain':
                   profile.goal==='lose'&&balance<-100?'✅ Good deficit for fat loss':'⚖️ Balanced intake';
      msgs.push({text:`${intent}: **${balStr}** today. Intake: ${(calories.intake).toLocaleString()} kcal | Burn: ${burned.toLocaleString()} kcal.`,delay:1700,think:1100});
    }

    // Water
    if(water===0) msgs.push({text:`💧 No water logged today. Your target is **${wGoal} ml** (${Math.round(wGoal/250)} glasses). Hydration improves performance by up to 20%.`,delay:1600,think:1000});
    else if(waterPct<60) msgs.push({text:`💧 **${water} ml** water today (${waterPct}% of goal). You need ${wGoal-water} ml more. Drink a glass now!`,delay:1600,think:1000});
    else msgs.push({text:`💧 Hydrated! **${water} ml** (${waterPct}% of ${wGoal} ml goal). Great consistency — hydration accelerates recovery.`,delay:1600,think:1000});

    // Sleep
    if(sleep.hours>0){
      const sleepQuality=sleep.hours>=7&&sleep.quality>=4?'excellent':sleep.hours>=6?'adequate':'insufficient';
      msgs.push({text:`😴 **${sleep.hours}h sleep** last night (quality: ${sleep.quality}/5 — ${sleepQuality}). ${sleep.hours<7?'Aim for 7-9h — sleep is when your body recovers and muscles grow.':'Solid recovery. Keep the routine.'}`,delay:1600,think:1000});
    }

    // Streak
    if(streak>=7) msgs.push({text:`🔥 **${streak}-day streak!** That's genuine consistency. Research shows habits form at ~21 days — you're ${streak>=14?'past':'building toward'} that threshold.`,delay:1600,think:900});
    else if(streak>0) msgs.push({text:`🔥 **${streak}-day streak** building. ${streak<3?'Reach 3 days to start a real habit.':streak<7?'One more week and it becomes automatic.':'Keep the chain alive!'}`,delay:1600,think:900});

    // Weekly delta
    if(weeklyInsights&&Math.abs(weeklyInsights.stepChangePercent)>10){
      const p=weeklyInsights.stepChangePercent;
      msgs.push({text:`📈 Weekly steps ${p>0?'up **+'+p+'%**':'down **'+p+'%**'} vs last week (${weeklyInsights.thisWeekSteps.toLocaleString()} vs ${weeklyInsights.lastWeekSteps.toLocaleString()}). ${p>0?'Improving trajectory!':'Aim to recover this week.'}`,delay:1600,think:1000});
    }

    // Weight trend + recommendation
    const {direction,delta}=trend;
    const proteinG=Math.round(profile.weight*1.6);
    const hydML=waterGoalMl(profile.weight);
    const calG=calorieGoal(profile);
    if(direction==='losing'&&profile.goal==='lose') msgs.push({text:`✅ Weight trending **down ${Math.abs(delta)} kg**. You're on track! Maintain ${proteinG}g protein to preserve muscle while losing fat.`,delay:1700,think:1100});
    else if(direction==='gaining'&&profile.goal==='gain') msgs.push({text:`📈 Weight up **+${delta} kg** — muscle building phase working. Ensure you're training hard to direct those calories to muscle.`,delay:1700,think:1100});

    // Tomorrow plan (always last)
    msgs.push({
      text:`🎯 **Tomorrow:** ${sg.toLocaleString()} steps · ${calG.toLocaleString()} kcal · ${proteinG}g protein · ${hydML}ml water · ${idealSleep()}h sleep. ${streak>0?`Day ${streak+1} of your streak — don't break it.`:'Start a new streak tomorrow.'}`,
      delay:1800,think:1400
    });

    return msgs;
  }

  // ── Weekly text for Summary ───────────────────────────────────────────────────
  function weeklyText(ins,profile,streak){
    const lines=[];
    lines.push(`This week: **${ins.thisWeekSteps.toLocaleString()} total steps** across ${ins.activeDaysThisWeek} active days.`);
    if(ins.stepChangePercent>10) lines.push(`Steps up ${ins.stepChangePercent}% vs last week — great improvement.`);
    else if(ins.stepChangePercent<-10) lines.push(`Steps down ${Math.abs(ins.stepChangePercent)}% — let's recover this week.`);
    else lines.push('Step count is holding steady week over week.');
    if(ins.avgCaloriesThisWeek>0){
      const cg=calorieGoal(profile);
      const diff=ins.avgCaloriesThisWeek-cg;
      if(Math.abs(diff)<100) lines.push(`Average intake (${ins.avgCaloriesThisWeek} kcal/day) right on target.`);
      else lines.push(`Average intake ${ins.avgCaloriesThisWeek} kcal/day — ${Math.abs(diff)} kcal ${diff>0?'above':'below'} target.`);
    }
    const wt=ins.weightTrend;
    if(wt.latest) lines.push(`Weight: ${wt.direction==='stable'?'stable':wt.delta>0?`up ${wt.delta} kg`:` down ${Math.abs(wt.delta)} kg`} over 2 weeks.`);
    if(streak>=7) lines.push(`🔥 ${streak}-day streak — elite consistency.`);
    return lines;
  }

  // ── Smart Insights ────────────────────────────────────────────────────────────
  function smartInsights(ins,profile,goals){
    const items=[];
    const sg=goals.stepGoal||8000;
    if(ins.activeDaysThisWeek<4) items.push({icon:'⚠️',text:`Only ${ins.activeDaysThisWeek} active days. Target 5+ for meaningful fitness progress.`,type:'warn'});
    if(ins.stepChangePercent>20) items.push({icon:'🚀',text:`${ins.stepChangePercent}% more steps than last week — strong progress!`,type:'good'});
    if(ins.thisWeekSteps>sg*7) items.push({icon:'🏆',text:'Weekly step target exceeded. Exceptional week!',type:'good'});
    if(ins.avgCaloriesThisWeek>0){
      const cg=calorieGoal(profile);
      if(ins.avgCaloriesThisWeek>cg+300&&profile.goal==='lose') items.push({icon:'🍽️',text:'Average intake consistently above target. Review portions.',type:'warn'});
    }
    const wt=ins.weightTrend;
    if(wt.direction==='losing'&&profile.goal==='lose') items.push({icon:'✅',text:'Weight trending down — right direction for your goal.',type:'good'});
    if(wt.direction==='gaining'&&profile.goal==='lose') items.push({icon:'⚠️',text:'Weight trending up against goal. Review calorie balance.',type:'warn'});
    if(items.length===0) items.push({icon:'✨',text:'Keep logging consistently to unlock personalised insights.',type:'info'});
    return items;
  }

  return {
    bmr,tdee,caloriesBurned,caloriesBurnedByMode,calorieGoal,
    bmi,bmiLabel,waterGoalMl,macroSplit,
    generateSession,weeklyText,smartInsights
  };
})();
