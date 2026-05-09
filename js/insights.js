// ─── Insights Engine ─────────────────────────────────────────────────────────
// Pure rule-based insights derived from localStorage data.

const Insights = (() => {

  const DISTRACTION_LABELS = {
    social: 'Social Media',
    phone: 'Phone',
    noise: 'Noise/Environment',
    thoughts: 'Wandering Thoughts',
    hunger: 'Hunger/Thirst',
    fatigue: 'Fatigue',
    other: 'Other',
  };

  function generate() {
    const sessions = Storage.Sessions.getAll().filter(s => s.completed && s.focusScore !== null);
    if (sessions.length === 0) return _noDataInsights();

    const insights = [];

    // 1. Top distraction type
    const distrTypes = _distractionTypeBreakdown(sessions);
    if (distrTypes.length > 0) {
      const top = distrTypes[0];
      const pct = Math.round((top.count / distrTypes.reduce((a, d) => a + d.count, 0)) * 100);
      insights.push({
        icon: '🎯',
        type: 'warning',
        title: 'Top Distraction',
        body: `<strong>${DISTRACTION_LABELS[top.type] || top.type}</strong> accounts for ${pct}% of your distractions. Try addressing this directly — even small environmental changes can help.`,
        metric: `${top.count} logs`,
      });
    }

    // 2. Best time of day
    const timeInsight = _bestTimeOfDay(sessions);
    if (timeInsight) {
      insights.push({
        icon: '⏰',
        type: 'success',
        title: 'Your Peak Focus Window',
        body: `You perform best in the <strong>${timeInsight.best}</strong> with an average score of <strong>${timeInsight.bestScore}</strong>. Schedule your hardest tasks then.`,
        metric: `vs ${timeInsight.worst} avg ${timeInsight.worstScore}`,
      });
    }

    // 3. Week over week improvement
    const { improvement, thisWeek, lastWeek } = Streaks.getWeeklyStats();
    if (lastWeek.count > 0) {
      const isUp = improvement >= 0;
      insights.push({
        icon: isUp ? '📈' : '📉',
        type: isUp ? 'success' : 'warning',
        title: isUp ? 'Focus Improving!' : 'Focus Dipped This Week',
        body: isUp
          ? `Your average focus score is up <strong>${improvement} pts</strong> compared to last week. Keep the momentum going!`
          : `Your average focus score dropped <strong>${Math.abs(improvement)} pts</strong> from last week. Try shorter sessions to rebuild consistency.`,
        metric: `${thisWeek.avgScore} vs ${lastWeek.avgScore} last wk`,
      });
    }

    // 4. Best day of week
    const dayInsight = _bestDayOfWeek(sessions);
    if (dayInsight) {
      insights.push({
        icon: '📅',
        type: 'info',
        title: 'Best Day of the Week',
        body: `<strong>${dayInsight.best}</strong> is your most focused day (avg score ${dayInsight.bestScore}). Your worst is <strong>${dayInsight.worst}</strong> — consider lighter tasks then.`,
        metric: `${dayInsight.best}: ${dayInsight.bestScore}`,
      });
    }

    // 5. Distraction frequency trend
    const freqInsight = _distractionFrequencyTrend(sessions);
    if (freqInsight) {
      insights.push({
        icon: freqInsight.improving ? '✨' : '⚠️',
        type: freqInsight.improving ? 'success' : 'info',
        title: freqInsight.improving ? 'Fewer Distractions!' : 'Distraction Frequency',
        body: freqInsight.improving
          ? `You're logging fewer distractions per session this week (<strong>${freqInsight.current}/session</strong> vs ${freqInsight.previous}/session last week). Great progress!`
          : `You're averaging <strong>${freqInsight.current} distractions per session</strong>. Try the 2-minute rule: when distracted, note it and return immediately.`,
        metric: `${freqInsight.current} avg/session`,
      });
    }

    // 6. Streak motivation
    const { currentStreak, bestStreak } = Storage.getStreakData();
    if (currentStreak >= 3) {
      insights.push({
        icon: '🔥',
        type: 'success',
        title: `${currentStreak}-Day Streak!`,
        body: `You're on fire! ${currentStreak} consecutive focused days. Your best ever is ${bestStreak} days — ${currentStreak >= bestStreak ? "you're at your record!" : `only ${bestStreak - currentStreak} more to beat it!`}`,
        metric: `Best: ${bestStreak} days`,
      });
    } else if (currentStreak === 0 && sessions.length > 5) {
      insights.push({
        icon: '🌱',
        type: 'info',
        title: 'Restart Your Streak',
        body: `Complete one focus session today to start a new streak. Even a single 10-minute session counts — consistency beats perfection.`,
        metric: `Best was ${bestStreak} days`,
      });
    }

    // 7. Session duration insight
    const durationInsight = _durationInsight(sessions);
    if (durationInsight) {
      insights.push({
        icon: '⚡',
        type: 'info',
        title: 'Optimal Session Length',
        body: durationInsight.body,
        metric: durationInsight.metric,
      });
    }

    return insights.slice(0, 6);
  }

  function _noDataInsights() {
    return [
      {
        icon: '🚀',
        type: 'info',
        title: 'Start Your First Session',
        body: 'Complete your first focus session to unlock personalized insights. The app will analyze your patterns and give you tailored tips.',
        metric: '0 sessions',
      },
      {
        icon: '💡',
        type: 'info',
        title: 'Pro Tip: The Pomodoro Method',
        body: 'Work in focused 25-minute sprints, then take a 5-minute break. Research shows this rhythm optimizes deep focus and prevents burnout.',
        metric: '25/5 rhythm',
      },
      {
        icon: '🎯',
        type: 'info',
        title: 'Track Distractions, Not Just Time',
        body: 'When you feel pulled away, tap the distraction button instead of giving in. Awareness is the first step to eliminating interruptions.',
        metric: 'Stay aware',
      },
    ];
  }

  function _distractionTypeBreakdown(sessions) {
    const counts = {};
    sessions.forEach(s => {
      s.distractions.forEach(d => {
        counts[d.type] = (counts[d.type] || 0) + 1;
      });
    });
    return Object.entries(counts)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
  }

  function _bestTimeOfDay(sessions) {
    const slots = { morning: [], afternoon: [], evening: [], night: [] };
    sessions.forEach(s => {
      const h = new Date(s.startTime).getHours();
      const slot = h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night';
      slots[slot].push(s.focusScore);
    });
    const avgs = Object.entries(slots)
      .filter(([, scores]) => scores.length > 0)
      .map(([slot, scores]) => ({ slot, avg: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) }))
      .sort((a, b) => b.avg - a.avg);
    if (avgs.length < 2) return null;
    const labels = { morning: 'Morning (6–12)', afternoon: 'Afternoon (12–5)', evening: 'Evening (5–9)', night: 'Night (9+)' };
    return {
      best: labels[avgs[0].slot],
      bestScore: avgs[0].avg,
      worst: labels[avgs[avgs.length - 1].slot],
      worstScore: avgs[avgs.length - 1].avg,
    };
  }

  function _bestDayOfWeek(sessions) {
    const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const byDay = Array.from({ length: 7 }, () => []);
    sessions.forEach(s => {
      const d = new Date(s.startTime).getDay();
      byDay[d].push(s.focusScore);
    });
    const avgs = byDay
      .map((scores, di) => ({ day: DAYS[di], avg: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null }))
      .filter(d => d.avg !== null)
      .sort((a, b) => b.avg - a.avg);
    if (avgs.length < 2) return null;
    return { best: avgs[0].day, bestScore: avgs[0].avg, worst: avgs[avgs.length - 1].day, worstScore: avgs[avgs.length - 1].avg };
  }

  function _distractionFrequencyTrend(sessions) {
    const now = Date.now();
    const thisWeek = sessions.filter(s => s.startTime >= now - 7 * 86400000);
    const lastWeek = sessions.filter(s => s.startTime >= now - 14 * 86400000 && s.startTime < now - 7 * 86400000);
    if (thisWeek.length === 0) return null;
    const avg = arr => arr.length ? (arr.reduce((a, s) => a + s.distractions.length, 0) / arr.length).toFixed(1) : null;
    const current = avg(thisWeek);
    const previous = avg(lastWeek);
    if (!current) return null;
    return {
      current,
      previous: previous || '—',
      improving: previous !== null && parseFloat(current) < parseFloat(previous),
    };
  }

  function _durationInsight(sessions) {
    if (sessions.length < 5) return null;
    const byDuration = { short: [], medium: [], long: [] };
    sessions.forEach(s => {
      const d = s.actualDuration ?? s.plannedDuration;
      if (d <= 15) byDuration.short.push(s.focusScore);
      else if (d <= 30) byDuration.medium.push(s.focusScore);
      else byDuration.long.push(s.focusScore);
    });
    const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
    const results = [
      { label: '≤15 min', avg: avg(byDuration.short) },
      { label: '16–30 min', avg: avg(byDuration.medium) },
      { label: '30+ min', avg: avg(byDuration.long) },
    ].filter(r => r.avg !== null).sort((a, b) => b.avg - a.avg);
    if (results.length === 0) return null;
    const best = results[0];
    return {
      body: `Your highest focus scores come from <strong>${best.label}</strong> sessions (avg ${best.avg}). Experiment with session lengths to find your sweet spot.`,
      metric: `Best: ${best.label}`,
    };
  }

  function getDistractionBreakdown() {
    const sessions = Storage.Sessions.getAll().filter(s => s.completed);
    return _distractionTypeBreakdown(sessions);
  }

  function getWeeklyReport() {
    const sessions = Storage.Sessions.getAll()
      .filter(s => s.completed && s.focusScore !== null)
      .sort((a, b) => a.startTime - b.startTime);
    const since = Date.now() - 7 * 86400000;
    const weekSessions = sessions.filter(s => s.startTime >= since);
    const previousWeekSessions = sessions.filter(s => s.startTime >= since - 7 * 86400000 && s.startTime < since);

    if (weekSessions.length === 0) {
      return {
        hasData: false,
        title: 'Weekly Report Card',
        summary: 'Complete a session this week to generate a report card.',
        stats: {
          sessions: 0,
          minutes: 0,
          avgScore: null,
          avgRecovery: null,
          scoreShift: null,
        },
        bestSession: null,
        topDistraction: null,
        recommendation: 'Start with one honest 15-25 minute session and log distractions as they happen.',
      };
    }

    const avgScore = Math.round(_avg(weekSessions.map(s => s.focusScore || 0)));
    const avgRecovery = Math.round(_avg(weekSessions.map(s => s.recoveryScore ?? Storage.calcSessionRecoveryScore(s, s.focusScore || 0))));
    const minutes = Math.round(weekSessions.reduce((sum, s) => sum + Number(s.actualDuration || 0), 0));
    const previousAvg = previousWeekSessions.length
      ? Math.round(_avg(previousWeekSessions.map(s => s.focusScore || 0)))
      : null;
    const bestSession = weekSessions.slice().sort((a, b) => (b.focusScore || 0) - (a.focusScore || 0))[0];
    const topDistraction = _distractionTypeBreakdown(weekSessions)[0] || null;

    return {
      hasData: true,
      title: 'Weekly Report Card',
      summary: _weeklySummary(avgScore, avgRecovery, weekSessions.length),
      stats: {
        sessions: weekSessions.length,
        minutes,
        avgScore,
        avgRecovery,
        scoreShift: previousAvg === null ? null : avgScore - previousAvg,
      },
      bestSession: bestSession ? {
        score: bestSession.focusScore || 0,
        duration: Number(bestSession.actualDuration || bestSession.plannedDuration || 0),
        date: Storage.dateStr(bestSession.startTime),
      } : null,
      topDistraction: topDistraction ? {
        label: DISTRACTION_LABELS[topDistraction.type] || topDistraction.type,
        count: topDistraction.count,
      } : null,
      recommendation: _weeklyRecommendation({ avgScore, avgRecovery, weekSessions, topDistraction }),
    };
  }

  function _avg(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  }

  function _weeklySummary(avgScore, avgRecovery, count) {
    if (avgScore >= 80 && avgRecovery >= 70) return `Strong week: ${count} session${count !== 1 ? 's' : ''} with healthy recovery.`;
    if (avgScore >= 65) return `Solid week: focus is building, with ${count} completed session${count !== 1 ? 's' : ''}.`;
    if (avgRecovery < 50) return 'Recovery was the limiting factor this week.';
    return 'This week has signal, but the next goal is cleaner and longer sessions.';
  }

  function _weeklyRecommendation({ avgScore, avgRecovery, weekSessions, topDistraction }) {
    const totalDistractions = weekSessions.reduce((sum, s) => sum + s.distractions.length, 0);
    if (weekSessions.length < 3) return 'Aim for 3 meaningful sessions next week before chasing a higher score.';
    if (avgRecovery < 50) return 'Keep one lighter day between heavy focus days so recovery can rebound.';
    if (topDistraction && topDistraction.count >= 3) {
      return `Main experiment: reduce ${DISTRACTION_LABELS[topDistraction.type] || topDistraction.type.toLowerCase()} before starting each session.`;
    }
    if (totalDistractions === 0 && avgScore >= 75) return 'You are getting clean sessions. Try raising the weekly minutes goal slightly.';
    if (avgScore < 55) return 'Use shorter 15-minute blocks and focus on finishing cleanly before increasing duration.';
    return 'Repeat your best session setup next week and keep logging distractions honestly.';
  }

  return { generate, getDistractionBreakdown, getWeeklyReport, DISTRACTION_LABELS };
})();

window.Insights = Insights;
