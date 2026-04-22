'use strict';

/**
 * AICoach — Generates personalized fitness coaching sessions
 *
 * Architecture:
 *   Primary:  Sophisticated rule-based engine (always works, no key)
 *   Optional: HuggingFace serverless inference (zero-config fallback)
 *
 * Chat session: 6 progressive messages with realistic delays
 */
const AICoach = (() => {

  // ── Fitness Calculations ──────────────────────────────────────────────────────
  function bmr({ weight, height, age, gender }) {
    const base = 10*weight + 6.25*height - 5*age;
    return Math.round(gender==='male' ? base+5 : base-161);
  }

  function tdee(bmrVal, activityLevel='moderate') {
    const m = { sedentary:1.2, light:1.375, moderate:1.55, active:1.725, veryActive:1.9 };
    return Math.round(bmrVal * (m[activityLevel]||1.55));
  }

  function caloriesBurned(steps, weightKg, activityLevel='moderate') {
    const MET=3.5, min=steps/100;
    const base = min*(MET*3.5/200)*weightKg;
    const m = { sedentary:0.82, light:0.91, moderate:1.0, active:1.1, veryActive:1.2 };
    return Math.round(base*(m[activityLevel]||1.0));
  }

  function calorieGoal(profile) {
    const b=bmr(profile), t=tdee(b,profile.activityLevel||'moderate');
    switch(profile.goal) {
      case 'lose':   return Math.max(t-500, 1200);
      case 'gain':   return t+300;
      default:       return t;
    }
  }

  // ── Greeting ──────────────────────────────────────────────────────────────────
  function greeting(name) {
    const h = new Date().getHours();
    const time = h<5?'night':h<12?'morning':h<17?'afternoon':'evening';
    const adj  = h<5?'burning the midnight oil?':h<12?'ready to crush it today?':h<17?'keeping the momentum?':'time to wind down right.';
    return `Good ${time}${name?`, ${name.split(' ')[0]}`:''}! ${adj} Let me pull up your data 📊`;
  }

  // ── Steps message ─────────────────────────────────────────────────────────────
  function stepsMessage(steps, goal, profile) {
    const pct = Math.round((steps/goal)*100);
    const burnt = caloriesBurned(steps, profile.weight, profile.activityLevel);
    const dist  = (steps*0.000762).toFixed(1);

    if (pct >= 110) return `🏆 Outstanding! You've hit **${steps.toLocaleString()} steps** — ${pct-100}% above your ${goal.toLocaleString()} goal. You've walked ~${dist} km and torched ~${burnt} kcal. That's elite consistency.`;
    if (pct >= 100) return `✅ Goal crushed! **${steps.toLocaleString()} steps** done — ${dist} km, ~${burnt} kcal burned. You're exactly where you need to be today.`;
    if (pct >= 75)  return `💪 Almost there! **${steps.toLocaleString()} steps** (${pct}% of goal). Just ${(goal-steps).toLocaleString()} more steps — a 10-minute walk will close the gap. ~${burnt} kcal burned so far.`;
    if (pct >= 50)  return `🟡 Halfway! **${steps.toLocaleString()} steps** so far (${pct}%). You need ${(goal-steps).toLocaleString()} more. Try adding a short walk after your next meal — you've burned ~${burnt} kcal.`;
    if (pct >= 25)  return `🔵 Early going — **${steps.toLocaleString()} steps** (${pct}%). You have ${(goal-steps).toLocaleString()} left to hit your goal. The day is young, keep moving!`;
    if (steps > 0)  return `⚡ Just getting started — **${steps.toLocaleString()} steps** today. Your ${goal.toLocaleString()}-step goal needs ${(goal-steps).toLocaleString()} more. Every step counts!`;
    return `📍 No steps logged yet. Your goal is **${goal.toLocaleString()} steps**. Start moving to kick off your tracking!`;
  }

  // ── Calorie message ───────────────────────────────────────────────────────────
  function calorieMessage(intake, burned, profile) {
    const goal   = calorieGoal(profile);
    const balance = intake - burned;
    const goalBMR = bmr(profile);

    if (intake === 0) return `🍽️ You haven't logged any calories today. Log your meals to get an accurate nutrition picture — your estimated burn so far is **${burned} kcal**.`;

    const balStr = balance>0 ? `+${Math.round(balance)} kcal surplus` : `${Math.round(balance)} kcal deficit`;
    const proStr = `${Math.round(profile.weight*1.6)}g protein target`;

    if (profile.goal==='lose') {
      if (balance>500)  return `⚠️ Calorie check: you're at a **${balStr}** today. That's working against your weight loss goal. Consider a lighter dinner or an evening walk. Aim for ~${proStr} to protect muscle.`;
      if (balance>0)    return `🟡 Slight surplus (**${balStr}**). You can offset this with 20 mins of brisk walking (~150 kcal). Target deficit: 300–500 kcal/day.`;
      if (balance>-600) return `✅ Solid deficit (**${balStr}**) — right in the sweet spot for fat loss. Make sure to hit your ${proStr} to protect lean mass.`;
      return `⚡ Large deficit (**${balStr}**). Ensure adequate nutrition — hitting ${proStr} is critical to avoid muscle loss at this level.`;
    }
    if (profile.goal==='gain') {
      if (balance<-200) return `🍗 You're at a **${balStr}** — too low for muscle gain. Add a protein shake or extra meal (~400 kcal) to stay on track. Target: 250–350 kcal surplus.`;
      if (balance<350)  return `✅ Good calorie balance (**${balStr}**) for lean muscle growth. Stay consistent and hit your ${proStr}.`;
      return `📈 Nice surplus (**${balStr}**). Ensure you're training hard enough to use these calories for muscle synthesis.`;
    }
    // maintain
    if (Math.abs(balance)<150) return `⚖️ Perfectly balanced today (**${balStr}**) — exactly what maintenance looks like. Impressive discipline.`;
    if (balance>150) return `🟡 Slight surplus today (**${balStr}**). That's fine occasionally — consistency over weeks is what matters for maintenance.`;
    return `✅ Slight deficit (**${balStr}**) — no problem for maintenance. Your body will compensate over the week.`;
  }

  // ── Weight message ────────────────────────────────────────────────────────────
  function weightMessage(trend, profile) {
    const { direction, delta, latest } = trend;
    if (!latest) return `⚖️ No weight logged yet. Add an entry in the Weight tab to start tracking your trend. Even one reading per week makes a big difference.`;

    const bmi     = latest/Math.pow(profile.height/100,2);
    const bmiStr  = bmi.toFixed(1);
    const bmiLabel = bmi<18.5?'underweight':bmi<25?'healthy':bmi<30?'overweight':'obese';

    const changeStr = delta>0?`+${delta}`:String(delta);

    if (profile.goal==='lose') {
      if (direction==='losing') return `📉 Great progress! Weight is down **${Math.abs(delta)} kg** over the last two weeks. You're trending in the right direction (BMI: ${bmiStr}, ${bmiLabel}). Keep the deficit consistent.`;
      if (direction==='gaining') return `📈 Weight is up **${Math.abs(delta)} kg** recently — that's fighting your goal. Check portion sizes, sodium intake (water retention), and sleep quality. BMI: ${bmiStr}.`;
      return `➡️ Weight holding steady (${changeStr} kg over 2 weeks, BMI: ${bmiStr}). Stable is fine — look for a slow downward trend, not rapid drops.`;
    }
    if (profile.goal==='gain') {
      if (direction==='gaining') return `📈 Building nicely! Weight is up **${delta} kg** — a healthy rate for muscle gain. BMI: ${bmiStr}. Ensure the surplus is driving muscle, not fat.`;
      if (direction==='losing') return `⚠️ Weight is down **${Math.abs(delta)} kg** — you need more calories to support muscle gain. Increase daily intake by 200–300 kcal.`;
      return `➡️ Weight stable (${changeStr} kg over 2 weeks). If muscle gain is the goal, aim for a modest 0.25–0.5 kg/week gain.`;
    }
    return `⚖️ Weight trend: **${changeStr} kg** over 2 weeks (BMI: ${bmiStr}, ${bmiLabel}). Small fluctuations of ±1 kg are completely normal.`;
  }

  // ── Streak message ────────────────────────────────────────────────────────────
  function streakMessage(streak, steps, goal) {
    if (streak >= 30)  return `🌟 Phenomenal — **${streak}-day streak**! A full month of consistency. You've built a genuine habit. The discipline you're showing is life-changing.`;
    if (streak >= 14)  return `🔥 Two-week streak — **${streak} days**! You're in the top 5% of people who actually follow through. Don't break the chain!`;
    if (streak >= 7)   return `🔥 One week strong — **${streak}-day streak**! Research shows 14 days is where habits solidify. You're halfway there. Keep going!`;
    if (streak >= 3)   return `💥 **${streak}-day streak** building! Hit your goal ${streak} days in a row. String 7 together and you'll have a genuine routine.`;
    if (streak === 2)  return `⚡ 2-day streak! Small but real. Get through today and tomorrow without breaking it — 3 days is the magic number to start a habit.`;
    if (streak === 1)  return `🌱 Day 1 of your streak! Today counts. Come back tomorrow and you've got a streak forming. Small steps, big changes.`;
    if (steps >= goal) return `✨ You hit your goal today — day 1 of a new streak begins now! The comeback is the best part of the story.`;
    return `🎯 Streak at 0 — but today isn't over. Hit your ${goal.toLocaleString()}-step goal and start fresh. One good day changes momentum.`;
  }

  // ── Tomorrow recommendation ───────────────────────────────────────────────────
  function recommendationMessage(steps, intake, trend, streak, goals, profile) {
    const stepGoal = goals.stepGoal || 8000;
    const calGoal  = calorieGoal(profile);
    const hydration = Math.round(profile.weight * 35);
    const protein   = Math.round(profile.weight * 1.6);

    const stepRec = steps >= stepGoal
      ? `Maintain **${stepGoal.toLocaleString()} steps**`
      : `Push for **${stepGoal.toLocaleString()} steps** (start earlier in the day)`;

    const calRec = profile.goal==='lose'
      ? `Keep calories at **${calGoal.toLocaleString()}–${(calGoal+100).toLocaleString()} kcal**`
      : profile.goal==='gain'
      ? `Fuel up to **${calGoal.toLocaleString()}–${(calGoal+200).toLocaleString()} kcal**`
      : `Stay near **${calGoal.toLocaleString()} kcal**`;

    const streakRec = streak >= 3
      ? `Protect your ${streak}-day streak — make tomorrow non-negotiable.`
      : `This is your chance to build a streak — don't skip tomorrow.`;

    return `🎯 **Tomorrow's plan:** ${stepRec}. ${calRec}, ${protein}g protein, ~${hydration}ml water. ${streakRec}`;
  }

  // ── Full session generator ────────────────────────────────────────────────────
  function generateSession(data) {
    const { steps, goals, calories, trend, streak, profile, weeklyInsights } = data;
    const stepGoal = goals.stepGoal || 8000;

    const messages = [
      { text: greeting(profile.name),                                                  delay: 300,  think: 800  },
      { text: stepsMessage(steps, stepGoal, profile),                                  delay: 2200, think: 1400 },
      { text: calorieMessage(calories.intake||0, calories.burned||0, profile),         delay: 2000, think: 1600 },
      { text: weightMessage(trend, profile),                                            delay: 2000, think: 1200 },
      { text: streakMessage(streak, steps, stepGoal),                                   delay: 1800, think: 1000 },
      { text: recommendationMessage(steps, calories.intake, trend, streak, goals, profile), delay: 2000, think: 1800 }
    ];

    // Optional weekly insight
    if (weeklyInsights && weeklyInsights.stepChangePercent !== 0) {
      const pct  = weeklyInsights.stepChangePercent;
      const sign = pct > 0 ? '+' : '';
      const icon = pct > 0 ? '📈' : '📉';
      const txt  = pct > 0
        ? `${icon} Weekly steps are up **${sign}${pct}%** vs last week (${weeklyInsights.thisWeekSteps.toLocaleString()} vs ${weeklyInsights.lastWeekSteps.toLocaleString()}). You're improving!`
        : `${icon} Weekly steps are down **${pct}%** vs last week. Life happens — get back on track this week. You've been active **${weeklyInsights.activeDaysThisWeek}/7 days**.`;
      messages.splice(5, 0, { text: txt, delay: 1800, think: 1100 });
    }

    return messages;
  }

  // ── Weekly summary (for Summary tab) ─────────────────────────────────────────
  function weeklyText(weeklyInsights, profile, streak) {
    const { thisWeekSteps, stepChangePercent, avgCaloriesThisWeek, weightTrend, activeDaysThisWeek } = weeklyInsights;
    const lines = [];

    lines.push(`This week: **${thisWeekSteps.toLocaleString()} total steps** across ${activeDaysThisWeek} active days.`);

    if (stepChangePercent > 10) lines.push(`Step count is up ${stepChangePercent}% vs last week — great momentum.`);
    else if (stepChangePercent < -10) lines.push(`Steps dropped ${Math.abs(stepChangePercent)}% — aim for more consistency next week.`);
    else lines.push('Step count is holding steady week-over-week.');

    if (avgCaloriesThisWeek > 0) {
      const calGoal = calorieGoal(profile);
      const diff = avgCaloriesThisWeek - calGoal;
      if (Math.abs(diff) < 100) lines.push(`Average calories (${avgCaloriesThisWeek} kcal/day) are right on target.`);
      else if (diff > 0) lines.push(`Average intake (${avgCaloriesThisWeek} kcal/day) is ${diff} kcal above your target.`);
      else lines.push(`Average intake (${avgCaloriesThisWeek} kcal/day) is ${Math.abs(diff)} kcal below your target.`);
    }

    const wt = weightTrend;
    if (wt.latest) lines.push(`Weight trend: ${wt.direction === 'stable' ? 'stable' : `${wt.delta > 0 ? 'up' : 'down'} ${Math.abs(wt.delta)} kg`} over 2 weeks.`);

    if (streak >= 7) lines.push(`🔥 ${streak}-day streak! Keep the chain alive.`);

    return lines;
  }

  // ── Smart insights (bullet list for Summary tab) ──────────────────────────────
  function smartInsights(weeklyInsights, profile, goals) {
    const insights = [];
    const { stepChangePercent, activeDaysThisWeek, thisWeekSteps } = weeklyInsights;
    const stepGoal = goals.stepGoal || 8000;

    if (activeDaysThisWeek < 4) {
      insights.push({ icon:'⚠️', text:`Only ${activeDaysThisWeek} active days this week. Target 5+ for meaningful fitness progress.`, type:'warn' });
    }
    if (stepChangePercent > 20) {
      insights.push({ icon:'🚀', text:`${stepChangePercent}% more steps than last week — massive improvement in activity.`, type:'good' });
    }
    if (thisWeekSteps > stepGoal * 7) {
      insights.push({ icon:'🏆', text:'You exceeded your weekly step target — well done!', type:'good' });
    }
    if (weeklyInsights.avgCaloriesThisWeek > 0) {
      const calGoal = calorieGoal(profile);
      if (weeklyInsights.avgCaloriesThisWeek > calGoal + 300 && profile.goal === 'lose') {
        insights.push({ icon:'🍽️', text:`Average calorie intake is consistently above target. Focus on portion control.`, type:'warn' });
      }
    }
    const wt = weeklyInsights.weightTrend;
    if (wt.direction === 'losing' && profile.goal === 'lose') {
      insights.push({ icon:'✅', text:`Weight trending down — you're on the right track for your goal.`, type:'good' });
    }
    if (wt.direction === 'gaining' && profile.goal === 'lose') {
      insights.push({ icon:'⚠️', text:'Weight trending up while your goal is to lose. Review calorie balance.', type:'warn' });
    }
    if (insights.length === 0) {
      insights.push({ icon:'✨', text:'Keep logging consistently to unlock personalised smart insights.', type:'info' });
    }
    return insights;
  }

  return {
    bmr, tdee, caloriesBurned, calorieGoal,
    generateSession, weeklyText, smartInsights
  };
})();
