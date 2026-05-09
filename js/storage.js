// ─── Storage Layer ───────────────────────────────────────────────────────────
// All data lives in localStorage under namespaced keys.
// Multi-user: each user's data is namespaced by user ID.

const KEYS = {
  // Legacy / single-user (kept for backwards compat)
  SESSIONS: 'ff_sessions',
  NOTES: 'ff_notes',
  SETTINGS: 'ff_settings',
  // Multi-user
  USERS: 'ff_users',
  ACTIVE_USER: 'ff_active_user',
  DAY_MARKER: 'ff_day_marker',
};

// ── Active User helpers ───────────────────────────────────────────────────────
function _getActiveUserId() {
  return localStorage.getItem(KEYS.ACTIVE_USER) || null;
}

function _nsKey(base) {
  const uid = _getActiveUserId();
  return uid ? `${base}__u_${uid}` : base; // fallback to legacy key
}

// Wrap the KEYS accessors to be user-namespaced
function _dataKeys() {
  return {
    SESSIONS: _nsKey(KEYS.SESSIONS),
    NOTES:    _nsKey(KEYS.NOTES),
    SETTINGS: _nsKey(KEYS.SETTINGS),
    DAY_MARKER: _nsKey(KEYS.DAY_MARKER),
  };
}

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

function _userDataKeys(userId) {
  return {
    sessions: `ff_sessions__u_${userId}`,
    notes: `ff_notes__u_${userId}`,
    settings: `ff_settings__u_${userId}`,
    dayMarker: `ff_day_marker__u_${userId}`,
  };
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
    return load(_dataKeys().SESSIONS);
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
    save(_dataKeys().SESSIONS, all);
    return session;
  },

  update(id, patch) {
    const all = this.getAll().map(s => s.id === id ? { ...s, ...patch } : s);
    save(_dataKeys().SESSIONS, all);
    return all.find(s => s.id === id);
  },

  delete(id) {
    const all = this.getAll().filter(s => s.id !== id);
    save(_dataKeys().SESSIONS, all);
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

  deleteBefore(dateStr) {
    const kept = this.getAll().filter(s => s.date >= dateStr);
    save(_dataKeys().SESSIONS, kept);
    return kept;
  },

  clearAll() {
    save(_dataKeys().SESSIONS, []);
  },

  getLast30Days() {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return this.getAll().filter(s => s.startTime >= cutoff);
  },

  recalculateScores() {
    const all = this.getAll().map(session => {
      const normalized = { ...session, date: dateStr(session.startTime) };
      if (!session.completed) return normalized;
      const actualDuration = getSessionMinutes(session);
      const focusScore = calcFocusScore(session.distractions || [], actualDuration, session.plannedDuration);
      return {
        ...normalized,
        focusScore,
        loadScore: calcSessionLoadScore(session.distractions || [], actualDuration, session.plannedDuration),
        recoveryScore: calcSessionRecoveryScore({ ...session, actualDuration }, focusScore),
      };
    });
    save(_dataKeys().SESSIONS, all);
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
    return load(_dataKeys().NOTES);
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
    save(_dataKeys().NOTES, all);
    return note;
  },

  update(id, patch) {
    const all = this.getAll().map(n =>
      n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n
    );
    save(_dataKeys().NOTES, all);
    return all.find(n => n.id === id);
  },

  delete(id) {
    const all = this.getAll().filter(n => n.id !== id);
    save(_dataKeys().NOTES, all);
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
    return loadObj(_dataKeys().SETTINGS, {
      name: '',
      workDuration: 25,
      breakDuration: 5,
      dailyGoal: 4, // sessions per day
    });
  },
  save(patch) {
    const current = this.get();
    save(_dataKeys().SETTINGS, { ...current, ...patch });
  },
};

// ── Utility ──────────────────────────────────────────────────────────────────
function todayStr() {
  return dateStr(Date.now());
}

function dateStr(ts) {
  const date = new Date(ts);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalDate(dateText) {
  const [year, month, day] = String(dateText).split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function calcFocusScore(distractions, actualDuration, plannedDuration) {
  const breakdown = calcFocusScoreBreakdown(distractions, actualDuration, plannedDuration);
  return breakdown.score;
}

function calcFocusScoreBreakdown(distractions = [], actualDuration, plannedDuration) {
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
  return {
    score: clamp(Math.round(score), 0, 100),
    parts: [
      {
        label: 'Completion',
        value: Math.round(completionPoints),
        max: 46,
        note: `${Math.round(completionRatio * 100)}% of planned time`,
      },
      {
        label: 'Duration',
        value: Math.round(durationPoints),
        max: 24,
        note: `${roundToOne(duration)} minutes`,
      },
      {
        label: 'Clean work',
        value: Math.round(cleanWorkPoints),
        max: 24,
        note: `${distractions.length} distraction${distractions.length !== 1 ? 's' : ''}`,
      },
      {
        label: 'Finish bonus',
        value: Math.round(finishBonus),
        max: 6,
        note: completionRatio >= 0.98 ? 'Completed the planned block' : 'Finish full block to unlock',
      },
      {
        label: 'Short penalty',
        value: -Math.round(shortSessionPenalty),
        max: 0,
        note: shortSessionPenalty ? 'Very short sessions score lower' : 'No short-session penalty',
      },
    ],
  };
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
    const ds = dateStr(checkDate.getTime());
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

function getJourneySummary() {
  const sessions = Sessions.getAll().filter(s => s.completed);
  const notes = NoteStore.getAll();
  const today = todayStr();
  const todaySessions = sessions.filter(s => s.date === today);
  const previousSessions = sessions.filter(s => s.date < today);
  const totalMinutes = sessions.reduce((sum, s) => sum + getSessionMinutes(s), 0);
  const avgScore = sessions.length
    ? Math.round(avg(sessions.map(s => s.focusScore || 0)))
    : null;
  const firstSession = sessions.slice().sort((a, b) => a.startTime - b.startTime)[0] || null;

  return {
    today,
    totalSessions: sessions.length,
    todaySessions: todaySessions.length,
    previousSessions: previousSessions.length,
    totalMinutes: roundToOne(totalMinutes),
    avgScore,
    notes: notes.length,
    startedOn: firstSession ? firstSession.date : null,
    lastRollover: localStorage.getItem(_dataKeys().DAY_MARKER) || today,
  };
}

function checkDailyRollover() {
  const key = _dataKeys().DAY_MARKER;
  const today = todayStr();
  const previous = localStorage.getItem(key);
  if (!previous) {
    localStorage.setItem(key, today);
    return { changed: false, previous: today, today };
  }
  if (previous !== today) {
    localStorage.setItem(key, today);
    return { changed: true, previous, today };
  }
  return { changed: false, previous, today };
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

// ── Users ─────────────────────────────────────────────────────────────────────
/*
  User schema: { id, name, createdAt, avatar? }
*/
const Users = {
  getAll() {
    try {
      return JSON.parse(localStorage.getItem(KEYS.USERS)) || [];
    } catch { return []; }
  },

  getActive() {
    const id = _getActiveUserId();
    return id ? (this.getAll().find(u => u.id === id) || null) : null;
  },

  setActive(id) {
    localStorage.setItem(KEYS.ACTIVE_USER, id);
  },

  create(name) {
    const id = uid();
    const user = { id, name: name.trim() || 'New User', createdAt: Date.now() };
    const all = this.getAll();
    all.push(user);
    localStorage.setItem(KEYS.USERS, JSON.stringify(all));
    return user;
  },

  rename(id, name) {
    const all = this.getAll().map(u => u.id === id ? { ...u, name: name.trim() || u.name } : u);
    localStorage.setItem(KEYS.USERS, JSON.stringify(all));
    return all.find(u => u.id === id);
  },

  delete(id) {
    // Remove all user data
    const base = [`ff_sessions__u_${id}`, `ff_notes__u_${id}`, `ff_settings__u_${id}`, `ff_day_marker__u_${id}`];
    base.forEach(k => localStorage.removeItem(k));
    const all = this.getAll().filter(u => u.id !== id);
    localStorage.setItem(KEYS.USERS, JSON.stringify(all));
    // If the deleted user was active, clear active
    if (_getActiveUserId() === id) {
      const next = all[0];
      if (next) localStorage.setItem(KEYS.ACTIVE_USER, next.id);
      else localStorage.removeItem(KEYS.ACTIVE_USER);
    }
    return all;
  },

  deletePreviousRecords() {
    return Sessions.deleteBefore(todayStr());
  },

  resetActiveJourney({ clearNotes = false } = {}) {
    Sessions.clearAll();
    if (clearNotes) save(_dataKeys().NOTES, []);
    const settings = Settings.get();
    Settings.save({ ...settings });
    localStorage.setItem(_dataKeys().DAY_MARKER, todayStr());
  },

  exportJson() {
    const users = this.getAll();
    const activeUserId = _getActiveUserId();
    const data = {
      app: 'FocusFlow',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      activeUserId,
      users: users.map(user => {
        const keys = _userDataKeys(user.id);
        return {
          ...user,
          sessions: load(keys.sessions),
          notes: load(keys.notes),
          settings: loadObj(keys.settings, {}),
          dayMarker: localStorage.getItem(keys.dayMarker) || todayStr(),
        };
      }),
    };
    return JSON.stringify(data, null, 2);
  },

  importJson(jsonText) {
    let data;
    try {
      data = JSON.parse(jsonText);
    } catch {
      throw new Error('This file is not valid JSON.');
    }

    if (data.app !== 'FocusFlow' || !Array.isArray(data.users)) {
      throw new Error('This does not look like a FocusFlow backup file.');
    }

    const currentUsers = this.getAll();
    currentUsers.forEach(user => this.delete(user.id));

    const cleanedUsers = data.users.map(user => ({
      id: String(user.id || uid()),
      name: String(user.name || 'Imported User'),
      createdAt: Number(user.createdAt || Date.now()),
    }));

    localStorage.setItem(KEYS.USERS, JSON.stringify(cleanedUsers));

    data.users.forEach((user, index) => {
      const id = cleanedUsers[index].id;
      const keys = _userDataKeys(id);
      save(keys.sessions, Array.isArray(user.sessions) ? user.sessions : []);
      save(keys.notes, Array.isArray(user.notes) ? user.notes : []);
      save(keys.settings, user.settings && typeof user.settings === 'object' ? user.settings : {});
      localStorage.setItem(keys.dayMarker, user.dayMarker || todayStr());
    });

    const activeExists = cleanedUsers.some(user => user.id === data.activeUserId);
    if (activeExists) localStorage.setItem(KEYS.ACTIVE_USER, data.activeUserId);
    else if (cleanedUsers[0]) localStorage.setItem(KEYS.ACTIVE_USER, cleanedUsers[0].id);
    else localStorage.removeItem(KEYS.ACTIVE_USER);

    Sessions.recalculateScores();
    return { users: cleanedUsers.length };
  },

  // Migrate legacy (non-namespaced) data into user slot
  migrateToUser(userId) {
    const targets = [
      [KEYS.SESSIONS, `ff_sessions__u_${userId}`],
      [KEYS.NOTES,    `ff_notes__u_${userId}`],
      [KEYS.SETTINGS, `ff_settings__u_${userId}`],
    ];
    targets.forEach(([from, to]) => {
      if (!localStorage.getItem(to)) {
        const val = localStorage.getItem(from);
        if (val) localStorage.setItem(to, val);
      }
    });
  },
};

// Export to global scope for module-free use
window.Storage = {
  Sessions, Notes: NoteStore, Settings, Users,
  uid, todayStr, dateStr, parseLocalDate,
  getStreakData, getDailyState, getJourneySummary, checkDailyRollover,
  calcFocusScore, calcFocusScoreBreakdown, calcSessionLoadScore, calcSessionRecoveryScore,
};
