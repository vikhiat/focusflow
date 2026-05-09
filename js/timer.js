// ─── Timer Module ─────────────────────────────────────────────────────────────
// Uses wall-clock anchoring (Date.now) instead of pure setInterval counting
// to avoid drift caused by browser throttling or heavy CPU.

const Timer = (() => {
  const STATES = { IDLE: 'idle', RUNNING: 'running', PAUSED: 'paused', BREAK: 'break', DONE: 'done' };

  let state = STATES.IDLE;
  let activeSessionId = null;
  let rafId = null;          // requestAnimationFrame handle for smooth ticks
  let intervalId = null;     // fallback setInterval (used only for break)

  // Wall-clock anchors
  let _startEpoch = 0;       // Date.now() when the current run began
  let _elapsed = 0;          // seconds already elapsed before the current run (pausing)
  let _totalSeconds = 0;     // total seconds for the current phase
  let _secondsLeft = 0;      // cached value for display
  let _breakStartEpoch = 0;
  let _breakTotal = 0;
  let _breakLeft = 0;

  let onTickCb = null;
  let onCompleteCb = null;
  let onBreakEndCb = null;

  let _lastDisplaySecond = -1; // avoid redundant renders

  function getState() { return state; }
  function getActiveSessionId() { return activeSessionId; }
  function isActive() { return state === STATES.RUNNING || state === STATES.PAUSED || state === STATES.BREAK; }

  // ── Start ─────────────────────────────────────────────────────────────────
  function start(plannedDuration, meta = {}) {
    if (state !== STATES.IDLE && state !== STATES.DONE) return;
    const settings = Storage.Settings.get();
    const duration = plannedDuration || settings.workDuration;
    const session = Storage.Sessions.create(duration, meta);
    activeSessionId = session.id;

    _totalSeconds = duration * 60;
    _elapsed = 0;
    _startEpoch = Date.now();
    _secondsLeft = _totalSeconds;
    _lastDisplaySecond = -1;
    state = STATES.RUNNING;

    _emitTick();
    _scheduleRaf();
    return session;
  }

  // ── Pause / Resume ────────────────────────────────────────────────────────
  function pause() {
    if (state !== STATES.RUNNING) return;
    _cancelRaf();
    // Snapshot elapsed so we can resume correctly
    _elapsed = Math.min(_totalSeconds, _elapsed + _secondsElapsed());
    state = STATES.PAUSED;
    _secondsLeft = Math.max(0, _totalSeconds - _elapsed);
    _emitTick();
  }

  function resume() {
    if (state !== STATES.PAUSED) return;
    _startEpoch = Date.now(); // reset anchor; _elapsed already has the prior elapsed
    state = STATES.RUNNING;
    _lastDisplaySecond = -1;
    _emitTick();
    _scheduleRaf();
  }

  // ── Distraction logging ───────────────────────────────────────────────────
  function logDistraction(type, note = '') {
    if (!activeSessionId) return;
    Storage.Sessions.addDistraction(activeSessionId, type, note);
  }

  // ── Complete (natural or forced) ──────────────────────────────────────────
  function complete(mood = null) {
    _cancelRaf();
    clearInterval(intervalId);
    intervalId = null;

    if (activeSessionId) {
      const completed = Storage.Sessions.complete(activeSessionId, mood);
      activeSessionId = null;

      const settings = Storage.Settings.get();
      _breakTotal = settings.breakDuration * 60;
      _breakLeft = _breakTotal;
      _breakStartEpoch = Date.now();
      state = STATES.BREAK;
      _emitTick();

      // Break uses a simple setInterval (no need for frame-perfect accuracy here)
      intervalId = setInterval(() => {
        const elapsed = Math.floor((Date.now() - _breakStartEpoch) / 1000);
        _breakLeft = Math.max(0, _breakTotal - elapsed);
        _emitTick();
        if (_breakLeft <= 0) {
          clearInterval(intervalId);
          intervalId = null;
          state = STATES.DONE;
          if (onBreakEndCb) onBreakEndCb();
        }
      }, 500); // poll at 500 ms for precision

      if (onCompleteCb) onCompleteCb(completed);
      return completed;
    }
  }

  // ── Abandon ───────────────────────────────────────────────────────────────
  function abandon() {
    _cancelRaf();
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
    _secondsLeft = 0;
    _elapsed = 0;
    _emitTick();
  }

  // ── Skip Break ────────────────────────────────────────────────────────────
  function skipBreak() {
    if (state !== STATES.BREAK) return;
    clearInterval(intervalId);
    intervalId = null;
    state = STATES.DONE;
    _emitTick();
    if (onBreakEndCb) onBreakEndCb();
  }

  // ── Reset ─────────────────────────────────────────────────────────────────
  function reset() {
    _cancelRaf();
    clearInterval(intervalId);
    intervalId = null;
    state = STATES.IDLE;
    activeSessionId = null;
    _secondsLeft = 0;
    _totalSeconds = 0;
    _elapsed = 0;
    _emitTick();
  }

  // ── Callbacks ─────────────────────────────────────────────────────────────
  function onTick(cb) { onTickCb = cb; }
  function onComplete(cb) { onCompleteCb = cb; }
  function onBreakEnd(cb) { onBreakEndCb = cb; }

  // ── Display ───────────────────────────────────────────────────────────────
  function getDisplay() {
    if (state === STATES.BREAK) {
      return {
        state,
        timeStr: formatSeconds(_breakLeft),
        seconds: _breakLeft,
        totalSeconds: _breakTotal,
        progress: _breakTotal > 0 ? 1 - _breakLeft / _breakTotal : 1,
      };
    }
    return {
      state,
      timeStr: formatSeconds(_secondsLeft),
      seconds: _secondsLeft,
      totalSeconds: _totalSeconds,
      progress: _totalSeconds > 0 ? 1 - _secondsLeft / _totalSeconds : 0,
      sessionId: activeSessionId,
    };
  }

  // ── Internal ──────────────────────────────────────────────────────────────
  function _secondsElapsed() {
    return Math.floor((Date.now() - _startEpoch) / 1000);
  }

  function _tick() {
    if (state !== STATES.RUNNING) return;

    const totalElapsed = _elapsed + _secondsElapsed();
    _secondsLeft = Math.max(0, _totalSeconds - totalElapsed);

    // Only emit when the displayed second changes (avoids unnecessary renders)
    if (_secondsLeft !== _lastDisplaySecond) {
      _lastDisplaySecond = _secondsLeft;
      _emitTick();
    }

    if (_secondsLeft <= 0) {
      complete();
      return;
    }

    _scheduleRaf();
  }

  function _scheduleRaf() {
    rafId = requestAnimationFrame(_tick);
  }

  function _cancelRaf() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function _emitTick() {
    if (onTickCb) onTickCb(getDisplay());
  }

  function formatSeconds(s) {
    const total = Math.max(0, Math.round(s));
    const m = Math.floor(total / 60);
    const sec = total % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  return {
    STATES, getState, getActiveSessionId, isActive,
    start, pause, resume, logDistraction, complete, abandon, skipBreak, reset,
    onTick, onComplete, onBreakEnd, getDisplay, formatSeconds,
  };
})();

window.Timer = Timer;
