// ─── Notes Module ─────────────────────────────────────────────────────────────

const Notes = (() => {
  let activeNoteId = null;
  let saveTimeout = null;
  let onChangeCb = null;

  function getActiveId() { return activeNoteId; }

  function onChange(cb) { onChangeCb = cb; }

  function openNote(id) {
    activeNoteId = id;
    const note = Storage.Notes.getById(id);
    if (!note) return;

    const titleEl = document.getElementById('note-title');
    const editorEl = document.getElementById('note-editor');
    const tagsEl = document.getElementById('note-tags-input');

    if (titleEl) titleEl.value = note.title;
    if (editorEl) editorEl.innerHTML = note.content || '';
    if (tagsEl) tagsEl.value = (note.tags || []).join(', ');

    document.querySelectorAll('.note-item').forEach(el => {
      el.classList.toggle('active', el.dataset.id === id);
    });

    const editorPanel = document.getElementById('note-editor-panel');
    if (editorPanel) editorPanel.classList.remove('hidden');
    const emptyState = document.getElementById('note-empty-state');
    if (emptyState) emptyState.classList.add('hidden');
  }

  function newNote(sessionId = null) {
    const note = Storage.Notes.create('Untitled Note', '', sessionId);
    activeNoteId = note.id;
    renderList();
    openNote(note.id);
    const titleEl = document.getElementById('note-title');
    if (titleEl) { titleEl.focus(); titleEl.select(); }
    return note;
  }

  function saveActive() {
    if (!activeNoteId) return;
    const titleEl = document.getElementById('note-title');
    const editorEl = document.getElementById('note-editor');
    const tagsEl = document.getElementById('note-tags-input');

    const title = titleEl ? titleEl.value || 'Untitled Note' : 'Untitled Note';
    const content = editorEl ? editorEl.innerHTML : '';
    const tags = tagsEl
      ? tagsEl.value.split(',').map(t => t.trim()).filter(Boolean)
      : [];

    Storage.Notes.update(activeNoteId, { title, content, tags });
    renderList();
    if (onChangeCb) onChangeCb();
  }

  function scheduleSave() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveActive, 800);
  }

  function deleteActive() {
    if (!activeNoteId) return;
    Storage.Notes.delete(activeNoteId);
    activeNoteId = null;
    const editorPanel = document.getElementById('note-editor-panel');
    if (editorPanel) editorPanel.classList.add('hidden');
    const emptyState = document.getElementById('note-empty-state');
    if (emptyState) emptyState.classList.remove('hidden');
    renderList();
  }

  function renderList(query = '') {
    const container = document.getElementById('notes-list');
    if (!container) return;

    const notes = query ? Storage.Notes.search(query) : Storage.Notes.getAll();

    if (notes.length === 0) {
      container.innerHTML = `<div class="notes-empty">
        <span class="notes-empty-icon">📝</span>
        <p>${query ? 'No notes match your search.' : 'No notes yet. Create your first note!'}</p>
      </div>`;
      return;
    }

    container.innerHTML = notes.map(note => {
      const preview = stripHtml(note.content).slice(0, 80) || 'No content';
      const date = new Date(note.updatedAt).toLocaleDateString('default', { month: 'short', day: 'numeric' });
      const isActive = note.id === activeNoteId;
      return `
        <div class="note-item ${isActive ? 'active' : ''}" data-id="${note.id}" onclick="NotesModule.openNote('${note.id}')">
          <div class="note-item-header">
            <span class="note-item-title">${escHtml(note.title)}</span>
            <span class="note-item-date">${date}</span>
          </div>
          <p class="note-item-preview">${escHtml(preview)}</p>
          ${note.tags.length ? `<div class="note-tags">${note.tags.map(t => `<span class="note-tag">${escHtml(t)}</span>`).join('')}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  // ── Toolbar commands ───────────────────────────────────────────────────────
  function execCmd(cmd, value = null) {
    document.getElementById('note-editor')?.focus();
    document.execCommand(cmd, false, value);
    scheduleSave();
  }

  function insertBulletList() { execCmd('insertUnorderedList'); }
  function insertNumberedList() { execCmd('insertOrderedList'); }
  function toggleBold() { execCmd('bold'); }
  function toggleItalic() { execCmd('italic'); }
  function toggleUnderline() { execCmd('underline'); }
  function toggleStrike() { execCmd('strikeThrough'); }

  function insertHeading() {
    const editor = document.getElementById('note-editor');
    if (!editor) return;
    document.execCommand('formatBlock', false, 'h3');
    scheduleSave();
  }

  function insertDivider() {
    document.execCommand('insertHTML', false, '<hr/><p><br/></p>');
    scheduleSave();
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function stripHtml(html) {
    const d = document.createElement('div');
    d.innerHTML = html;
    return d.textContent || d.innerText || '';
  }

  function escHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return {
    getActiveId, onChange, openNote, newNote, saveActive, scheduleSave, deleteActive,
    renderList, execCmd, insertBulletList, insertNumberedList, toggleBold, toggleItalic,
    toggleUnderline, toggleStrike, insertHeading, insertDivider,
  };
})();

window.NotesModule = Notes;
