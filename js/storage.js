// ─── Storage Layer ───────────────────────────────────────────────────────────
// All data lives in localStorage under namespaced keys.

const KEYS = {
  SESSIONS: 'ff_sessions',
  NOTES: 'ff_notes',
  SETTINGS: 'ff_settings',
};

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Generic helpers ──────────────────────────────────────────────────────────
function load(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || [];
  } catch {
    return [];
  }
}

function loadObj(key, fallback = {}) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// ── Sessions ─────────────────────────────────────────────────────────────────
/*
  Session schema:
  {
    id: string,
    date: 'YYYY-MM-DD',
    startTime: timestamp,
    endTime: timestamp | null,
    plannedDuration: minutes,
    actualDuration: minutes | null,
    distractions: [{ id, type, timestamp, note? }],
    focusScore: 0-100 | null,
    completed: bool,
    mood: 'great'|'good'|'meh'|'bad' | null
  }
*/

const Sessions = {
  getAll() {
    return load(KEYS.SESSIONS);
  },

  getById(id) {
    return this.getAll().find(s => s.id === id) || null;
  },

  create(plannedDuration = 25, meta = {}) {
    const session = {
      id: uid(),
      date: todayStr(),
      startTime: Date.now(),
      endTime: null,
      plannedDuration,
      actualDuration: null,
      distractions: [],
      focusScore: null,
      completed: false,
      mood: null,
      stressBefore: null,
      recoveryScore: null,
      loadScore: null,
      ...meta,
    };
    const all = this.getAll();
    all.push(session);
    save(KEYS.SESSIONS, all);
    return session;
  },

  update(id, patch) {
    const all = this.getAll().map(s => s.id === id ? { ...s, ...patch } : s);
    save(KEYS.SESSIONS, all);
    return all.find(s => s.id === id);
  },

  addDistraction(sessionId, type, note = '') {
    const session = this.getById(sessionId);
    if (!session) return;
    const distractions = [
      ...session.distractions,
      { id: uid(), type, timestamp: Date.now(), note },
    ];
    return this.update(sessionId, { distractions });
  },

  complete(sessionId, mood = null) {
    const session = this.getById(sessionId);
    if (!session) return;
    const endTime = Date.now();
    const actualDuration = roundToOne((endTime - session.startTime) / 60000);
    const focusScore = calcFocusScore(session.distractions, actualDuration, session.plannedDuration);
    const loadScore = calcSessionLoadScore(session.distractions, actualDuration, session.plannedDuration);
    const recoveryScore = calcSessionRecoveryScore(session, focusScore);
    return this.update(sessionId, {
      endTime,
      actualDuration,
      focusScore,
      loadScore,
      recoveryScore,
      completed: true,
      mood,
    });
  },

  getForDate(dateStr) {
    return this.getAll().filter(s => s.date === dateStr);
  },

  getLast30Days() {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return this.getAll().filter(s => s.startTime >= cutoff);
  },

  recalculateScores() {
    const all = this.getAll().map(session => {
      if (!session.completed) return session;
      const actualDuration = getSessionMinutes(session);
      const focusScore = calcFocusScore(session.distractions || [], actualDuration, session.plannedDuration);
      return {
        ...session,
        focusScore,
        loadScore: calcSessionLoadScore(session.distractions || [], actualDuration, session.plannedDuration),
        recoveryScore: calcSessionRecoveryScore({ ...session, actualDuration }, focusScore),
      };
    });
    save(KEYS.SESSIONS, all);
  },
};

// ── Notes ────────────────────────────────────────────────────────────────────
/*
  Note schema:
  {
    id: string,
    title: string,
    content: string (HTML),
    tags: string[],
    sessionId: string | null,
    createdAt: timestamp,
    updatedAt: timestamp,
    pinned: bool
  }
*/

const NoteStore = {
  getAll() {
    return load(KEYS.NOTES);
  },

  getById(id) {
    return this.getAll().find(n => n.id === id) || null;
  },

  create(title = 'Untitled Note', content = '', sessionId = null) {
    const note = {
      id: uid(),
      title: title || 'Untitled Note',
      content,
      tags: [],
      sessionId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pinned: false,
    };
    const all = this.getAll();
    all.unshift(note);
    save(KEYS.NOTES, all);
    return note;
  },

  update(id, patch) {
    const all = this.getAll().map(n =>
      n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n
    );
    save(KEYS.NOTES, all);
    return all.find(n => n.id === id);
  },

  delete(id) {
    const all = this.getAll().filter(n => n.id !== id);
    save(KEYS.NOTES, all);
  },

  search(query) {
    const q = query.toLowerCase();
    return this.getAll().filter(n =>
      n.title.toLowerCase().includes(q) ||
      n.content.toLowerCase().includes(q) ||
      n.tags.some(t => t.toLowerCase().includes(q))
    );
  },
};

// ── Settings ──────────────────────────────────────────────────────────────────
const Settings = {
  get() {
    return loadObj(KEYS.SETTINGS, {
      name: '',
      workDuration: 25,
      breakDuration: 5,
      dailyGoal: 4, // sessions per day
    });
  },
  save(patch) {
    const current = this.get();
    save(KEYS.SETTINGS, { ...current, ...patch });
  },
};

// ── Utility ──────────────────────────────────────────────────────────────────
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function dateStr(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function calcFocusScore(distractions, actualDuration, plannedDuration) {
  const duration = Math.max(Number(actualDuration) || 0, 0);
  const planned = Math.max(Number(plannedDuration) || 25, 1);
  const completionRatio = clamp(duration / planned, 0, 1);
  const distractionsPerMinute = distractions.length / Math.max(duration, 1);

  const completionPoints = completionRatio * 46;
  const durationPoints = duration >= 15
    ? 24
    : duration >= 10
      ? 17
      : duration >= 5
        ? 9
        : duration >= 2
          ? 4
          : 0;
  const cleanWorkPoints = Math.max(0, 24 - distractionsPerMinute * 36);
  const finishBonus = completionRatio >= 0.98 ? 6 : 0;
  const shortSessionPenalty = duration < 2 ? 28 : duration < 5 ? 18 : duration < 10 ? 8 : 0;

  const score = completionPoints + durationPoints + cleanWorkPoints + finishBonus - shortSessionPenalty;
  return clamp(Math.round(score), 0, 100);
}

function calcSessionLoadScore(distractions, actualDuration, plannedDuration) {
  const duration = Math.max(Number(actualDuration) || 0, 0);
  const durationLoad = Math.min(65, (duration / Math.max(plannedDuration, 1)) * 50);
  const distractionLoad = Math.min(25, distractions.length * 5);
  const lengthBonus = duration >= 45 ? 10 : duration >= 25 ? 6 : 0;
  return clamp(Math.round(durationLoad + distractionLoad + lengthBonus), 0, 100);
}

function calcSessionRecoveryScore(session, focusScore) {
  const stress = Number(session.stressBefore || 3);
  const stressPenalty = (stress - 3) * 8;
  const focusAdjustment = (focusScore - 70) * 0.25;
  const duration = Number(session.actualDuration || 0);
  const shortSessionPenalty = duration < 2 ? 20 : duration < 5 ? 12 : 0;
  return clamp(Math.round(72 + focusAdjustment - stressPenalty - shortSessionPenalty), 0, 100);
}

function getStreakData() {
  const sessions = Sessions.getAll().filter(s => s.completed);
  const byDate = {};
  sessions.forEach(s => {
    if (!byDate[s.date]) byDate[s.date] = [];
    byDate[s.date].push(s);
  });

  // Calculate daily scores
  const dailyScores = {};
  Object.entries(byDate).forEach(([date, daySessions]) => {
    const avgScore = daySessions.reduce((a, s) => a + (s.focusScore || 0), 0) / daySessions.length;
    dailyScores[date] = Math.round(avgScore);
  });

  // Calculate current streak (consecutive days with avgScore > 50)
  let currentStreak = 0;
  let bestStreak = 0;
  let tempStreak = 0;
  const today = todayStr();

  // Go backwards from today
  const allDates = Object.keys(dailyScores).sort();
  // Forward pass for best streak
  allDates.forEach(d => {
    if (dailyScores[d] > 50) {
      tempStreak++;
      bestStreak = Math.max(bestStreak, tempStreak);
    } else {
      tempStreak = 0;
    }
  });

  // Current streak from today backwards
  let checkDate = new Date();
  while (true) {
    const ds = checkDate.toISOString().slice(0, 10);
    if (dailyScores[ds] > 50) {
      currentStreak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
    if (currentStreak > 365) break;
  }

  return { dailyScores, currentStreak, bestStreak, totalSessions: sessions.length };
}

function getDailyState(date = todayStr()) {
  const settings = Settings.get();
  const sessions = Sessions.getAll().filter(s => s.completed);
  const todaySessions = sessions.filter(s => s.date === date);
  const previousSessions = sessions
    .filter(s => s.date <= date)
    .sort((a, b) => b.startTime - a.startTime);
  const lastSession = previousSessions[0] || null;
  const todayMinutes = todaySessions.reduce((sum, s) => sum + getSessionMinutes(s), 0);
  const targetMinutes = Math.max(1, settings.workDuration * settings.dailyGoal);
  const focus = todaySessions.length
    ? Math.round(avg(todaySessions.map(s => s.focusScore || 0)))
    : lastSession ? lastSession.focusScore || 0 : null;
  const load = calcDailyLoad(todaySessions, todayMinutes, targetMinutes, settings.dailyGoal);
  const consistency = calcConsistencyScore(sessions, settings.dailyGoal);
  const recovery = calcRecoveryScore(lastSession, todaySessions, todayMinutes, targetMinutes);

  return {
    focus,
    recovery,
    load,
    consistency,
    recommendation: getDailyRecommendation({ focus, recovery, load, consistency, todaySessions, settings }),
    labels: {
      focus: getFocusBand(focus),
      recovery: getRecoveryBand(recovery),
      load: getLoadBand(load),
      consistency: getConsistencyBand(consistency),
    },
  };
}

function calcDailyLoad(todaySessions, todayMinutes, targetMinutes, dailyGoal) {
  if (todaySessions.length === 0) return 12;
  const volume = Math.min(72, (todayMinutes / targetMinutes) * 72);
  const sessionPressure = Math.min(18, (todaySessions.length / Math.max(dailyGoal, 1)) * 18);
  const distractionPressure = Math.min(10, todaySessions.reduce((sum, s) => sum + s.distractions.length, 0) * 2);
  return clamp(Math.round(volume + sessionPressure + distractionPressure), 0, 100);
}

function calcConsistencyScore(sessions, dailyGoal) {
  const { currentStreak } = getStreakData();
  const todayCompleted = Sessions.getForDate(todayStr()).filter(s => s.completed && isMeaningfulSession(s)).length;
  const goalProgress = Math.min(40, (todayCompleted / Math.max(dailyGoal, 1)) * 40);
  const activeDays = new Set();
  const cutoff = Date.now() - 6 * 86400000;
  sessions.forEach(s => {
    if (s.startTime >= cutoff && isMeaningfulSession(s)) activeDays.add(s.date);
  });
  const weeklyPresence = Math.min(35, activeDays.size * 5);
  const streakPoints = Math.min(25, currentStreak * 5);
  return clamp(Math.round(goalProgress + weeklyPresence + streakPoints), 0, 100);
}

function calcRecoveryScore(lastSession, todaySessions, todayMinutes, targetMinutes) {
  let score = 74;
  if (!lastSession) return score;

  const hoursSince = (Date.now() - lastSession.endTime) / 3600000;
  if (hoursSince >= 4) score += 16;
  else if (hoursSince >= 2) score += 10;
  else if (hoursSince >= 1) score += 2;
  else score -= 14;

  score += ((lastSession.focusScore || 70) - 70) * 0.22;
  score -= (Number(lastSession.stressBefore || 3) - 3) * 7;
  score += moodRecoveryModifier(lastSession.mood);

  const loadRatio = todayMinutes / targetMinutes;
  if (todaySessions.length >= 3) score -= 8;
  if (loadRatio > 1.1) score -= 12;
  if (loadRatio > 1.5) score -= 10;

  return clamp(Math.round(score), 0, 100);
}

function moodRecoveryModifier(mood) {
  return ({ great: 10, good: 5, meh: -3, bad: -10 })[mood] || 0;
}

function isMeaningfulSession(session) {
  return getSessionMinutes(session) >= Math.min(10, Math.max(5, (session.plannedDuration || 25) * 0.4));
}

function getSessionMinutes(session) {
  return Number(session.actualDuration ?? session.plannedDuration ?? 0);
}

function roundToOne(value) {
  return Math.round(value * 10) / 10;
}

function getDailyRecommendation({ focus, recovery, load, todaySessions, settings }) {
  if (recovery < 45) return 'Recovery is low. Take a real break before the next session.';
  if (load > 82) return 'High load today. Keep the next session short or switch to lighter work.';
  if (focus !== null && focus < 55) return 'Try one clean 15-minute reset session with distractions muted.';
  if (todaySessions.length < settings.dailyGoal && recovery >= 65) return 'You are clear for another focused block.';
  if (todaySessions.length >= settings.dailyGoal) return 'Daily goal hit. Protect recovery and close the loop.';
  return 'Steady state. A normal 25-minute session should fit well.';
}

function getFocusBand(score) {
  if (score === null) return { label: 'No Signal', tone: 'neutral' };
  if (score >= 85) return { label: 'Flow State', tone: 'good' };
  if (score >= 70) return { label: 'Strong', tone: 'good' };
  if (score >= 55) return { label: 'Steady', tone: 'warn' };
  if (score >= 40) return { label: 'Drained', tone: 'warn' };
  return { label: 'Reset Needed', tone: 'bad' };
}

function getRecoveryBand(score) {
  if (score >= 85) return { label: 'Ready', tone: 'good' };
  if (score >= 70) return { label: 'Good to Go', tone: 'good' };
  if (score >= 55) return { label: 'Take It Light', tone: 'warn' };
  if (score >= 40) return { label: 'Recover First', tone: 'warn' };
  return { label: 'Rest Mode', tone: 'bad' };
}

function getLoadBand(score) {
  if (score >= 85) return { label: 'Heavy Strain', tone: 'bad' };
  if (score >= 65) return { label: 'Productive Strain', tone: 'good' };
  if (score >= 35) return { label: 'Balanced Load', tone: 'good' };
  return { label: 'Light Day', tone: 'neutral' };
}

function getConsistencyBand(score) {
  if (score >= 85) return { label: 'Locked In', tone: 'good' };
  if (score >= 65) return { label: 'Building', tone: 'good' };
  if (score >= 40) return { label: 'Warming Up', tone: 'warn' };
  return { label: 'Start Small', tone: 'neutral' };
}

function avg(numbers) {
  return numbers.length ? numbers.reduce((sum, n) => sum + n, 0) / numbers.length : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// Export to global scope for module-free use
window.Storage = {
  Sessions, Notes: NoteStore, Settings, uid, todayStr, dateStr,
  getStreakData, getDailyState, calcFocusScore, calcSessionLoadScore, calcSessionRecoveryScore,
};
