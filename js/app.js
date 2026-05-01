// ─── App Controller ───────────────────────────────────────────────────────────
// SPA router + view rendering + event wiring

const App = (() => {
  const VIEWS = ['dashboard', 'sessions', 'notes', 'insights'];
  let currentView = 'dashboard';
  let moodPending = false;
  let startPending = false;

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    _initTheme();
    _resetTransientUi();
    Storage.Sessions.recalculateScores();
    _bindNav();
    _bindTimer();
    _bindNotes();
    _bindSettings();
    _bindTheme();
    _bindSearch();
    navigateTo('dashboard');
    _checkOnboarding();
  }

  // ── Navigation ────────────────────────────────────────────────────────────
  function navigateTo(view) {
    if (!VIEWS.includes(view)) return;
    currentView = view;

    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.view === view);
    });

    document.querySelectorAll('.view').forEach(el => {
      const isActive = el.id === `view-${view}`;
      el.classList.toggle('view-active', isActive);
      el.classList.toggle('hidden', !isActive);
    });

    // Render view-specific content
    if (view === 'dashboard') _renderDashboard();
    if (view === 'sessions') _renderSessions();
    if (view === 'notes') _renderNotes();
    if (view === 'insights') _renderInsights();
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────
  function _renderDashboard() {
    const { currentStreak, bestStreak, totalSessions } = Storage.getStreakData();
    const settings = Storage.Settings.get();
    const dailyState = Storage.getDailyState();
    const todaySessions = Storage.Sessions.getForDate(Storage.todayStr()).filter(s => s.completed);
    const todayAvg = todaySessions.length
      ? Math.round(todaySessions.reduce((a, s) => a + (s.focusScore || 0), 0) / todaySessions.length)
      : null;

    _setText('dash-streak', currentStreak);
    _setText('dash-best-streak', `Best: ${bestStreak}`);
    _setText('dash-total-sessions', totalSessions);
    _setText('dash-today-sessions', `${todaySessions.length} / ${settings.dailyGoal} today`);
    _setText('dash-focus-score', todayAvg !== null ? todayAvg : '—');
    _setText('dash-focus-label', todayAvg !== null ? _scoreLabel(todayAvg) : 'No sessions yet');
    _renderDailyState(dailyState);

    // Streak fire
    const fireEl = document.getElementById('dash-streak-fire');
    if (fireEl) fireEl.classList.toggle('hidden', currentStreak < 3);

    // Daily goal progress bar
    const goalPct = Math.min(100, (todaySessions.length / settings.dailyGoal) * 100);
    const goalBar = document.getElementById('dash-goal-bar');
    if (goalBar) goalBar.style.width = goalPct + '%';

    // Recent sessions
    _renderRecentSessions();

    // Mini bar chart
    Streaks.renderMiniBar('dash-mini-bar');

    // Quick note
    NotesModule.renderList('', 3);

    // Timer display update
    _updateTimerDisplay(Timer.getDisplay());
  }

  function _renderDailyState(state) {
    _setText('daily-recommendation', state.recommendation);
    _setText('dash-recovery-score', state.recovery);
    _setText('dash-recovery-label', state.labels.recovery.label);
    _setText('dash-state-focus', state.focus !== null ? state.focus : '—');
    _setText('dash-state-recovery', state.recovery);
    _setText('dash-state-load', state.load);
    _setText('dash-state-consistency', state.consistency);
    _setText('dash-state-focus-label', state.labels.focus.label);
    _setText('dash-state-recovery-label', state.labels.recovery.label);
    _setText('dash-state-load-label', state.labels.load.label);
    _setText('dash-state-consistency-label', state.labels.consistency.label);
  }

  function _renderRecentSessions() {
    const container = document.getElementById('recent-sessions');
    if (!container) return;
    const sessions = Storage.Sessions.getAll().filter(s => s.completed).slice(-5).reverse();
    if (sessions.length === 0) {
      container.innerHTML = `<p class="empty-hint">Your completed sessions will appear here.</p>`;
      return;
    }
    container.innerHTML = sessions.map(s => {
      const time = new Date(s.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const score = s.focusScore || 0;
      const scoreColor = score >= 70 ? '#119b72' : score >= 45 ? '#c47f15' : '#df3f3a';
      return `
        <div class="session-row">
          <div class="session-row-info">
            <span class="session-row-time">${time}</span>
            <span class="session-row-dur">${_formatDuration(s.actualDuration ?? s.plannedDuration)} min</span>
            <span class="session-row-distr">${s.distractions.length} distractions</span>
          </div>
          <div class="session-score-badge" style="color:${scoreColor};border-color:${scoreColor}20;background:${scoreColor}15">
            ${score}
          </div>
        </div>
      `;
    }).join('');
  }

  // ── Sessions View ─────────────────────────────────────────────────────────
  function _renderSessions() {
    const container = document.getElementById('sessions-list');
    if (!container) return;

    const sessions = Storage.Sessions.getAll().filter(s => s.completed).reverse();
    if (sessions.length === 0) {
      container.innerHTML = `<div class="empty-state">
        <div class="empty-icon">🏁</div>
        <h3>No sessions yet</h3>
        <p>Start your first focus session from the Dashboard.</p>
      </div>`;
      return;
    }

    // Group by date
    const byDate = {};
    sessions.forEach(s => {
      if (!byDate[s.date]) byDate[s.date] = [];
      byDate[s.date].push(s);
    });

    container.innerHTML = Object.entries(byDate).map(([date, daySessions]) => {
      const dateLabel = _formatDateLabel(date);
      const dayAvg = Math.round(daySessions.reduce((a, s) => a + (s.focusScore || 0), 0) / daySessions.length);

      const sessionCards = daySessions.map(s => {
        const startT = new Date(s.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const endT = s.endTime ? new Date(s.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        const score = s.focusScore || 0;
        const scoreColor = score >= 70 ? '#119b72' : score >= 45 ? '#c47f15' : '#df3f3a';
        const distrCount = s.distractions.length;
        const recovery = s.recoveryScore ?? Storage.calcSessionRecoveryScore(s, score);
        const actualDuration = s.actualDuration ?? s.plannedDuration;
        const load = s.loadScore ?? Storage.calcSessionLoadScore(s.distractions, actualDuration, s.plannedDuration);

        // Distraction breakdown
        const distrTypes = {};
        s.distractions.forEach(d => { distrTypes[d.type] = (distrTypes[d.type] || 0) + 1; });
        const distrHTML = Object.entries(distrTypes).map(([type, count]) =>
          `<span class="distraction-chip">${Insights.DISTRACTION_LABELS[type] || type} ×${count}</span>`
        ).join('');

        return `
          <div class="session-card">
            <div class="session-card-header">
              <div class="session-card-time">
                <span class="session-time-range">${startT} ${endT ? '→ ' + endT : ''}</span>
                <span class="session-duration">${_formatDuration(actualDuration)} min</span>
              </div>
              <div class="session-score-circle" style="--score-color:${scoreColor}">
                <span class="score-num">${score}</span>
                <span class="score-lbl">score</span>
              </div>
            </div>
            <div class="session-card-body">
              <div class="session-stat"><span class="stat-icon">⚡</span> ${distrCount} distraction${distrCount !== 1 ? 's' : ''}</div>
              <div class="session-stat"><span class="stat-icon">🧘</span> Recovery ${recovery}</div>
              <div class="session-stat"><span class="stat-icon">📈</span> Load ${load}</div>
              ${s.stressBefore ? `<div class="session-stat"><span class="stat-icon">🌡️</span> Stress ${s.stressBefore}/5</div>` : ''}
              ${s.mood ? `<div class="session-stat"><span class="stat-icon">😊</span> Felt ${s.mood}</div>` : ''}
            </div>
            ${distrHTML ? `<div class="distraction-chips">${distrHTML}</div>` : ''}
          </div>
        `;
      }).join('');

      return `
        <div class="date-group">
          <div class="date-group-header">
            <span class="date-label">${dateLabel}</span>
            <span class="date-avg">Avg score: <strong>${dayAvg}</strong></span>
          </div>
          ${sessionCards}
        </div>
      `;
    }).join('');
  }

  // ── Notes View ────────────────────────────────────────────────────────────
  function _renderNotes() {
    NotesModule.renderList();
    if (!NotesModule.getActiveId()) {
      const editorPanel = document.getElementById('note-editor-panel');
      if (editorPanel) editorPanel.classList.add('hidden');
      const emptyState = document.getElementById('note-empty-state');
      if (emptyState) emptyState.classList.remove('hidden');
    }
  }

  // ── Insights View ─────────────────────────────────────────────────────────
  function _renderInsights() {
    const container = document.getElementById('insights-cards');
    if (!container) return;

    const insightsList = Insights.generate();
    container.innerHTML = insightsList.map(ins => `
      <div class="insight-card insight-${ins.type}">
        <div class="insight-icon">${ins.icon}</div>
        <div class="insight-content">
          <h4 class="insight-title">${ins.title}</h4>
          <p class="insight-body">${ins.body}</p>
        </div>
        <div class="insight-metric">${ins.metric}</div>
      </div>
    `).join('');

    // Render heatmap
    Streaks.renderHeatmap('insights-heatmap');

    // Render distraction donut
    _renderDistractionChart();

    // Weekly stats
    const { thisWeek, lastWeek, improvement } = Streaks.getWeeklyStats();
    _setText('ins-this-week-sessions', thisWeek.count);
    _setText('ins-this-week-score', thisWeek.avgScore || '—');
    _setText('ins-last-week-sessions', lastWeek.count);
    _setText('ins-last-week-score', lastWeek.avgScore || '—');
    const impEl = document.getElementById('ins-improvement');
    if (impEl) {
      impEl.textContent = (improvement >= 0 ? '+' : '') + improvement + ' pts';
      impEl.className = 'ins-improvement ' + (improvement >= 0 ? 'positive' : 'negative');
    }
  }

  function _renderDistractionChart() {
    const container = document.getElementById('distraction-chart');
    if (!container) return;
    const data = Insights.getDistractionBreakdown();
    if (data.length === 0) {
      container.innerHTML = `<p class="empty-hint">No distraction data yet.</p>`;
      return;
    }

    const total = data.reduce((a, d) => a + d.count, 0);
    const COLORS = ['#ff5f57', '#00a68f', '#f2b84b', '#6f5cff', '#df3f3a', '#119b72', '#c47f15'];

    const bars = data.map((d, i) => {
      const pct = Math.round((d.count / total) * 100);
      return `
        <div class="distraction-bar-row">
          <span class="distraction-bar-label">${Insights.DISTRACTION_LABELS[d.type] || d.type}</span>
          <div class="distraction-bar-track">
            <div class="distraction-bar-fill" style="width:${pct}%;background:${COLORS[i % COLORS.length]}"></div>
          </div>
          <span class="distraction-bar-pct">${pct}%</span>
        </div>
      `;
    }).join('');

    container.innerHTML = `<div class="distraction-bars">${bars}</div>`;
  }

  // ── Timer Binding ─────────────────────────────────────────────────────────
  function _bindTimer() {
    Timer.onTick(display => {
      _updateTimerDisplay(display);
    });

    Timer.onComplete(session => {
      _showMoodModal(session);
      _renderDashboard();
      _showToast('✅ Session complete! Great work!', 'success');
    });

    Timer.onBreakEnd(() => {
      _showToast('☕ Break over! Ready for another round?', 'info');
      _updateTimerDisplay(Timer.getDisplay());
    });

    // Start button
    document.getElementById('btn-start-session')?.addEventListener('click', event => {
      event.preventDefault();
      _showStressModal();
    });
    document.getElementById('hero-start-session')?.addEventListener('click', event => {
      event.preventDefault();
      _showStressModal();
    });

    // Pause / Resume
    document.getElementById('btn-pause')?.addEventListener('click', () => {
      if (Timer.getState() === Timer.STATES.RUNNING) Timer.pause();
      else if (Timer.getState() === Timer.STATES.PAUSED) Timer.resume();
    });

    // Stop
    document.getElementById('btn-stop')?.addEventListener('click', () => {
      if (Timer.isActive()) {
        if (confirm('End this session early?')) {
          const completed = Timer.complete();
          _renderDashboard();
        }
      }
    });

    // Skip break
    document.getElementById('btn-skip-break')?.addEventListener('click', () => {
      Timer.skipBreak();
    });

    // Distraction buttons
    document.querySelectorAll('.distr-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        if (!Timer.isActive() || Timer.getState() !== Timer.STATES.RUNNING) return;
        Timer.logDistraction(type);
        _flashDistractionBtn(btn);
        _showToast(`📌 ${Insights.DISTRACTION_LABELS[type] || type} logged`, 'info');
        _renderDashboard();
      });
    });

    // Done state — reset
    document.getElementById('btn-reset')?.addEventListener('click', () => {
      Timer.reset();
      _renderDashboard();
    });
  }

  function _startSession(stressBefore = null) {
    if (!startPending) return;
    startPending = false;
    const settings = Storage.Settings.get();
    Timer.start(settings.workDuration, { stressBefore });
    _renderDashboard();
  }

  function _showStressModal() {
    if (Timer.isActive()) return;
    startPending = true;
    const modal = document.getElementById('stress-modal');
    if (!modal) {
      _startSession();
      return;
    }
    modal.classList.remove('hidden');
    document.querySelectorAll('.stress-btn').forEach(btn => {
      btn.onclick = event => {
        event.preventDefault();
        modal.classList.add('hidden');
        _startSession(parseInt(btn.dataset.stress, 10));
      };
    });
    document.getElementById('btn-skip-stress')?.addEventListener('click', event => {
      event.preventDefault();
      modal.classList.add('hidden');
      _startSession();
    }, { once: true });
  }

  function _updateTimerDisplay(display) {
    const state = display.state;
    const timerEl = document.getElementById('timer-display');
    const timerLabel = document.getElementById('timer-label');
    const breakDisplay = document.getElementById('break-display');
    const progressRing = document.getElementById('timer-ring-progress');
    const sessionPanel = document.getElementById('session-panel');
    const startPanel = document.getElementById('start-panel');
    const breakPanel = document.getElementById('break-panel');
    const donePanel = document.getElementById('done-panel');
    const pauseBtn = document.getElementById('btn-pause');
    const distrPanel = document.getElementById('distraction-panel');

    if (timerEl) timerEl.textContent = display.timeStr;
    if (breakDisplay) breakDisplay.textContent = display.timeStr;

    // Progress ring
    if (progressRing) {
      const circumference = 2 * Math.PI * 54;
      const offset = circumference * (1 - (display.progress || 0));
      progressRing.style.strokeDasharray = circumference;
      progressRing.style.strokeDashoffset = offset;
    }

    // Panel visibility
    const isSession = state === Timer.STATES.RUNNING || state === Timer.STATES.PAUSED;
    const isBreak = state === Timer.STATES.BREAK;
    const isDone = state === Timer.STATES.DONE;
    const isIdle = state === Timer.STATES.IDLE;

    if (startPanel) startPanel.classList.toggle('hidden', !isIdle);
    if (sessionPanel) sessionPanel.classList.toggle('hidden', !isSession);
    if (breakPanel) breakPanel.classList.toggle('hidden', !isBreak);
    if (donePanel) donePanel.classList.toggle('hidden', !isDone);
    if (distrPanel) distrPanel.classList.toggle('hidden', !isSession || state === Timer.STATES.PAUSED);

    if (timerLabel) {
      timerLabel.textContent = isBreak ? 'Break Time' : isDone ? 'Session Done!' : isIdle ? 'Ready to Focus' : state === Timer.STATES.PAUSED ? 'Paused' : 'Focusing';
    }

    if (pauseBtn) {
      pauseBtn.textContent = state === Timer.STATES.PAUSED ? '▶ Resume' : '⏸ Pause';
    }

    // Pulse animation
    const timerCircle = document.getElementById('timer-circle');
    if (timerCircle) {
      timerCircle.classList.toggle('pulsing', state === Timer.STATES.RUNNING);
    }
  }

  // ── Notes Binding ─────────────────────────────────────────────────────────
  function _bindNotes() {
    document.getElementById('btn-new-note')?.addEventListener('click', () => {
      NotesModule.newNote(Timer.getActiveSessionId());
    });

    document.getElementById('btn-delete-note')?.addEventListener('click', () => {
      if (confirm('Delete this note?')) NotesModule.deleteActive();
    });

    document.getElementById('note-title')?.addEventListener('input', NotesModule.scheduleSave.bind(NotesModule));
    document.getElementById('note-editor')?.addEventListener('input', NotesModule.scheduleSave.bind(NotesModule));
    document.getElementById('note-tags-input')?.addEventListener('input', NotesModule.scheduleSave.bind(NotesModule));

    // Toolbar buttons
    document.getElementById('btn-note-bold')?.addEventListener('click', NotesModule.toggleBold.bind(NotesModule));
    document.getElementById('btn-note-italic')?.addEventListener('click', NotesModule.toggleItalic.bind(NotesModule));
    document.getElementById('btn-note-underline')?.addEventListener('click', NotesModule.toggleUnderline.bind(NotesModule));
    document.getElementById('btn-note-strike')?.addEventListener('click', NotesModule.toggleStrike.bind(NotesModule));
    document.getElementById('btn-note-h3')?.addEventListener('click', NotesModule.insertHeading.bind(NotesModule));
    document.getElementById('btn-note-ul')?.addEventListener('click', NotesModule.insertBulletList.bind(NotesModule));
    document.getElementById('btn-note-ol')?.addEventListener('click', NotesModule.insertNumberedList.bind(NotesModule));
    document.getElementById('btn-note-hr')?.addEventListener('click', NotesModule.insertDivider.bind(NotesModule));

    // Quick note from dashboard
    document.getElementById('btn-quick-note')?.addEventListener('click', () => {
      navigateTo('notes');
      setTimeout(() => NotesModule.newNote(Timer.getActiveSessionId()), 100);
    });
  }

  // ── Search ────────────────────────────────────────────────────────────────
  function _bindSearch() {
    document.getElementById('notes-search')?.addEventListener('input', e => {
      NotesModule.renderList(e.target.value);
    });
  }

  // ── Settings Binding ──────────────────────────────────────────────────────
  function _bindSettings() {
    const settings = Storage.Settings.get();
    const workInput = document.getElementById('settings-work-dur');
    const breakInput = document.getElementById('settings-break-dur');
    const goalInput = document.getElementById('settings-daily-goal');
    const nameInput = document.getElementById('settings-name');

    if (workInput) workInput.value = settings.workDuration;
    if (breakInput) breakInput.value = settings.breakDuration;
    if (goalInput) goalInput.value = settings.dailyGoal;
    if (nameInput) nameInput.value = settings.name;

    document.getElementById('btn-save-settings')?.addEventListener('click', () => {
      Storage.Settings.save({
        workDuration: parseInt(workInput?.value) || 25,
        breakDuration: parseInt(breakInput?.value) || 5,
        dailyGoal: parseInt(goalInput?.value) || 4,
        name: nameInput?.value || '',
      });
      _showToast('✅ Settings saved!', 'success');
      _renderDashboard();
    });
  }

  // ── Theme ─────────────────────────────────────────────────────────────────
  function _initTheme() {
    const savedTheme = localStorage.getItem('ff_theme');
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    const theme = savedTheme || (prefersDark ? 'dark' : 'light');
    _applyTheme(theme);
  }

  function _bindTheme() {
    document.getElementById('theme-toggle')?.addEventListener('click', () => {
      const nextTheme = document.documentElement.classList.contains('theme-dark') ? 'light' : 'dark';
      localStorage.setItem('ff_theme', nextTheme);
      _applyTheme(nextTheme);
      _renderDashboard();
      if (currentView === 'insights') _renderInsights();
    });
  }

  function _applyTheme(theme) {
    const isDark = theme === 'dark';
    document.documentElement.classList.toggle('theme-dark', isDark);
    const toggle = document.getElementById('theme-toggle');
    const icon = document.getElementById('theme-toggle-icon');
    const label = document.getElementById('theme-toggle-label');
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(isDark));
      toggle.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    }
    if (icon) icon.textContent = isDark ? '☀️' : '🌙';
    if (label) label.textContent = isDark ? 'Light Mode' : 'Dark Mode';
  }

  // ── Nav Binding ───────────────────────────────────────────────────────────
  function _bindNav() {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => navigateTo(item.dataset.view));
    });
  }

  function _resetTransientUi() {
    startPending = false;
    document.getElementById('stress-modal')?.classList.add('hidden');
    document.getElementById('mood-modal')?.classList.add('hidden');
  }

  // ── Mood Modal ────────────────────────────────────────────────────────────
  function _showMoodModal(session) {
    const modal = document.getElementById('mood-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    document.querySelectorAll('.mood-btn').forEach(btn => {
      btn.onclick = () => {
        Storage.Sessions.update(session.id, { mood: btn.dataset.mood });
        modal.classList.add('hidden');
        _renderDashboard();
        _showToast('Mood logged 👍', 'info');
      };
    });
    document.getElementById('btn-skip-mood')?.addEventListener('click', () => {
      modal.classList.add('hidden');
    }, { once: true });
  }

  // ── Onboarding ────────────────────────────────────────────────────────────
  function _checkOnboarding() {
    const settings = Storage.Settings.get();
    const hasName = settings.name && settings.name.trim().length > 0;
    if (!hasName) {
      const modal = document.getElementById('onboarding-modal');
      if (modal) modal.classList.remove('hidden');

      document.getElementById('btn-onboarding-start')?.addEventListener('click', () => {
        const nameEl = document.getElementById('onboarding-name');
        const name = nameEl?.value.trim() || 'Friend';
        Storage.Settings.save({ name });
        modal.classList.add('hidden');
        _setText('user-greeting', `Hey, ${name}! 👋`);
        _setText('settings-name', name);
      }, { once: true });
    } else {
      _setText('user-greeting', `Hey, ${settings.name}! 👋`);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function _setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function _scoreLabel(score) {
    if (score >= 80) return '🔥 Excellent';
    if (score >= 65) return '✨ Great';
    if (score >= 50) return '👍 Good';
    if (score >= 35) return '😐 Okay';
    return '💪 Keep going';
  }

  function _formatDateLabel(dateStr) {
    const today = Storage.todayStr();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yd = yesterday.toISOString().slice(0, 10);
    if (dateStr === today) return '📅 Today';
    if (dateStr === yd) return 'Yesterday';
    return new Date(dateStr).toLocaleDateString('default', { weekday: 'long', month: 'short', day: 'numeric' });
  }

  function _formatDuration(minutes) {
    const value = Number(minutes) || 0;
    if (value < 1 && value > 0) return '<1';
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  function _flashDistractionBtn(btn) {
    btn.classList.add('flash');
    setTimeout(() => btn.classList.remove('flash'), 500);
  }

  function _showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 400);
    }, 3000);
  }

  return { init, navigateTo };
})();

window.App = App;
document.addEventListener('DOMContentLoaded', App.init);
