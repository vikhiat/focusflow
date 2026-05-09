// ─── Users Module ─────────────────────────────────────────────────────────────

const UsersModule = (() => {
  // Colour palette for user avatars
  const PALETTE = [
    '#6f5cff', '#ff5f57', '#00a68f', '#f2b84b',
    '#3b9eff', '#e876a8', '#34d399', '#fb923c',
  ];

  function _avatarColor(id) {
    // Deterministic colour from user ID
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
    return PALETTE[Math.abs(hash) % PALETTE.length];
  }

  function _initials(name) {
    return name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  // Called once on app init. Creates a default user from existing settings if
  // no users exist yet (migration path for existing installs).
  function bootstrap() {
    const users = Storage.Users.getAll();
    if (users.length === 0) {
      const settings = Storage.Settings.get();
      const name = (settings.name && settings.name.trim()) ? settings.name : 'Default User';
      const user = Storage.Users.create(name);
      Storage.Users.setActive(user.id);
      // Migrate existing data into this user's namespace
      Storage.Users.migrateToUser(user.id);
      Storage.Settings.save({ name });
    } else if (!Storage.Users.getActive()) {
      // Users exist but none is active → pick the first
      Storage.Users.setActive(users[0].id);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  function render() {
    const container = document.getElementById('users-list');
    _renderJourney();
    if (!container) return;

    const users = Storage.Users.getAll();
    const activeId = Storage.Users.getActive()?.id;

    if (users.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">👤</div><h3>No users yet</h3><p>Add your first user above.</p></div>`;
      return;
    }

    container.innerHTML = users.map(u => {
      const isActive = u.id === activeId;
      const color = _avatarColor(u.id);
      const initials = _initials(u.name);
      const date = new Date(u.createdAt).toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric' });

      // Session count for this user
      // Peek at user's sessions without switching
      let sessionCount = 0;
      try {
        const key = `ff_sessions__u_${u.id}`;
        const raw = localStorage.getItem(key);
        if (raw) {
          const data = JSON.parse(raw);
          sessionCount = Array.isArray(data) ? data.filter(s => s.completed).length : 0;
        }
      } catch { sessionCount = 0; }

      return `
        <div class="user-card ${isActive ? 'user-card-active' : ''}" id="user-card-${u.id}">
          <div class="user-card-left">
            <div class="user-avatar" style="background:${color}20;color:${color};border:2px solid ${color}50">
              ${initials}
            </div>
            <div class="user-card-info">
              <span class="user-card-name">${escapeHtml(u.name)}</span>
              <span class="user-card-meta">${sessionCount} sessions · since ${date}</span>
            </div>
          </div>
          <div class="user-card-actions">
            ${isActive
              ? `<span class="active-badge">Active</span>`
              : `<button class="btn btn-secondary user-switch-btn" data-uid="${u.id}" type="button">Switch</button>`
            }
            <button class="btn btn-danger user-delete-btn" data-uid="${u.id}" data-name="${escapeHtml(u.name)}" type="button" ${isActive && users.length === 1 ? 'disabled title="Cannot delete the only user"' : ''}>Remove</button>
          </div>
        </div>
      `;
    }).join('');

    // Bind switch buttons
    container.querySelectorAll('.user-switch-btn').forEach(btn => {
      btn.addEventListener('click', () => switchUser(btn.dataset.uid));
    });

    // Bind delete buttons
    container.querySelectorAll('.user-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => deleteUser(btn.dataset.uid, btn.dataset.name));
    });
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  function addUser(name) {
    if (!name.trim()) return false;
    const user = Storage.Users.create(name);
    render();
    return user;
  }

  function switchUser(id) {
    if (Storage.Users.getActive()?.id === id) return;
    Storage.Users.setActive(id);
    // Reload the entire app state
    window.dispatchEvent(new CustomEvent('ff:userchange', { detail: { userId: id } }));
    render();
  }

  function deleteUser(id, name) {
    const users = Storage.Users.getAll();
    if (users.length === 1) {
      alert('You cannot remove the only user. Add another user first.');
      return;
    }
    if (!confirm(`Remove "${name}" and all their data? This cannot be undone.`)) return;
    Storage.Users.delete(id);
    window.dispatchEvent(new CustomEvent('ff:userchange', { detail: { userId: Storage.Users.getActive()?.id } }));
    render();
  }

  function deletePreviousRecords() {
    const summary = Storage.getJourneySummary();
    if (summary.previousSessions === 0) {
      alert('There are no previous-day records to delete.');
      return false;
    }
    if (!confirm(`Delete ${summary.previousSessions} previous record${summary.previousSessions !== 1 ? 's' : ''}? Today's sessions will stay.`)) return false;
    Storage.Users.deletePreviousRecords();
    Storage.Sessions.recalculateScores();
    render();
    return true;
  }

  function restartJourney() {
    const active = Storage.Users.getActive();
    const label = active?.name || 'this user';
    if (!confirm(`Restart ${label}'s journey? This deletes all sessions and resets streak stats. Notes and settings will stay.`)) return false;
    Storage.Users.resetActiveJourney({ clearNotes: false });
    render();
    return true;
  }

  function exportJson() {
    const json = Storage.Users.exportJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const date = Storage.todayStr();
    const link = document.createElement('a');
    link.href = url;
    link.download = `focusflow-backup-${date}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return true;
  }

  function importJson(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        resolve(false);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          if (!confirm('Import this JSON backup? It will replace the current local FocusFlow data.')) {
            resolve(false);
            return;
          }
          Storage.Users.importJson(String(reader.result || ''));
          render();
          resolve(true);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('Could not read the selected JSON file.'));
      reader.readAsText(file);
    });
  }

  function _renderJourney() {
    const active = Storage.Users.getActive();
    const summary = Storage.getJourneySummary();
    _setText('journey-owner', active ? `${active.name}'s journey` : 'Current journey');
    _setText('journey-total-sessions', summary.totalSessions);
    _setText('journey-today-sessions', summary.todaySessions);
    _setText('journey-avg-score', summary.avgScore === null ? '—' : summary.avgScore);
    _setText('journey-rollover-copy', `Today is ${_prettyDate(summary.today)}. After 00:00, yesterday stays in history and the dashboard starts fresh.`);

    const deleteBtn = document.getElementById('btn-delete-previous-records');
    if (deleteBtn) {
      deleteBtn.disabled = summary.previousSessions === 0;
      deleteBtn.textContent = summary.previousSessions > 0
        ? `Delete previous records (${summary.previousSessions})`
        : 'No previous records';
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _prettyDate(dateText) {
    return Storage.parseLocalDate(dateText).toLocaleDateString('default', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  function _setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  return { bootstrap, render, addUser, switchUser, deleteUser, deletePreviousRecords, restartJourney, exportJson, importJson };
})();

window.UsersModule = UsersModule;
