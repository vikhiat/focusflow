// ─── Timer Module ─────────────────────────────────────────────────────────────

const Timer = (() => {
  const STATES = { IDLE: 'idle', RUNNING: 'running', PAUSED: 'paused', BREAK: 'break', DONE: 'done' };

  let state = STATES.IDLE;
  let activeSessionId = null;
  let intervalId = null;
  let secondsLeft = 0;
  let totalSeconds = 0;
  let breakSecondsLeft = 0;
  let onTickCb = null;
  let onCompleteCb = null;
  let onBreakEndCb = null;

  function getState() { return state; }
  function getActiveSessionId() { return activeSessionId; }
  function isActive() { return state === STATES.RUNNING || state === STATES.PAUSED || state === STATES.BREAK; }

  function start(plannedDuration, meta = {}) {
    if (state !== STATES.IDLE && state !== STATES.DONE) return;
    const settings = Storage.Settings.get();
    const duration = plannedDuration || settings.workDuration;
    const session = Storage.Sessions.create(duration, meta);
    activeSessionId = session.id;

    secondsLeft = duration * 60;
    totalSeconds = secondsLeft;
    state = STATES.RUNNING;

    _emitTick();
    intervalId = setInterval(_tick, 1000);
    return session;
  }

  function pause() {
    if (state !== STATES.RUNNING) return;
    state = STATES.PAUSED;
    clearInterval(intervalId);
    intervalId = null;
    _emitTick();
  }

  function resume() {
    if (state !== STATES.PAUSED) return;
    state = STATES.RUNNING;
    intervalId = setInterval(_tick, 1000);
  }

  function logDistraction(type, note = '') {
    if (!activeSessionId) return;
    Storage.Sessions.addDistraction(activeSessionId, type, note);
    // Flash visual feedback handled in app.js
  }

  function complete(mood = null) {
    clearInterval(intervalId);
    intervalId = null;

    if (activeSessionId) {
      const completed = Storage.Sessions.complete(activeSessionId, mood);
      activeSessionId = null;

      const settings = Storage.Settings.get();
      // Start break
      breakSecondsLeft = settings.breakDuration * 60;
      state = STATES.BREAK;
      _emitTick();

      intervalId = setInterval(() => {
        breakSecondsLeft--;
        if (breakSecondsLeft <= 0) {
          clearInterval(intervalId);
          intervalId = null;
          state = STATES.DONE;
          if (onBreakEndCb) onBreakEndCb();
        }
        _emitTick();
      }, 1000);

      if (onCompleteCb) onCompleteCb(completed);
      return completed;
    }
  }

  function abandon() {
    clearInterval(intervalId);
    intervalId = null;
    if (activeSessionId) {
      Storage.Sessions.update(activeSessionId, {
        endTime: Date.now(),
        completed: false,
      });
      activeSessionId = null;
    }
    state = STATES.IDLE;
    secondsLeft = 0;
    _emitTick();
  }

  function skipBreak() {
    if (state !== STATES.BREAK) return;
    clearInterval(intervalId);
    intervalId = null;
    state = STATES.DONE;
    _emitTick();
    if (onBreakEndCb) onBreakEndCb();
  }

  function reset() {
    clearInterval(intervalId);
    intervalId = null;
    state = STATES.IDLE;
    activeSessionId = null;
    secondsLeft = 0;
    totalSeconds = 0;
    _emitTick();
  }

  function onTick(cb) { onTickCb = cb; }
  function onComplete(cb) { onCompleteCb = cb; }
  function onBreakEnd(cb) { onBreakEndCb = cb; }

  function getDisplay() {
    if (state === STATES.BREAK) {
      return {
        state,
        timeStr: formatSeconds(breakSecondsLeft),
        seconds: breakSecondsLeft,
        totalSeconds: Storage.Settings.get().breakDuration * 60,
        progress: 1 - breakSecondsLeft / (Storage.Settings.get().breakDuration * 60),
      };
    }
    return {
      state,
      timeStr: formatSeconds(secondsLeft),
      seconds: secondsLeft,
      totalSeconds,
      progress: totalSeconds > 0 ? 1 - secondsLeft / totalSeconds : 0,
      sessionId: activeSessionId,
    };
  }

  function _tick() {
    if (state === STATES.RUNNING) {
      secondsLeft--;
      if (secondsLeft <= 0) {
        secondsLeft = 0;
        _emitTick();
        complete();
        return;
      }
    }
    _emitTick();
  }

  function _emitTick() {
    if (onTickCb) onTickCb(getDisplay());
  }

  function formatSeconds(s) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  return {
    STATES, getState, getActiveSessionId, isActive,
    start, pause, resume, logDistraction, complete, abandon, skipBreak, reset,
    onTick, onComplete, onBreakEnd, getDisplay, formatSeconds,
  };
})();

window.Timer = Timer;
