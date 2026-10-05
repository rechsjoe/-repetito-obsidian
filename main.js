const { Plugin, ItemView, Modal, Notice, normalizePath, setIcon } = require('obsidian');

const VIEW = 'repetito-view';
const DATA_DIR = 'Repetito';
const DATA_FILE = `${DATA_DIR}/repetito-data.json`;
const PDF_DIR = `${DATA_DIR}/PDFs`;
const RATINGS = ['Sehr schwer', 'Schwer', 'Mittel', 'Leicht', 'Sehr leicht'];
const INDEPENDENCE = ['Ohne Hilfe', 'Mit Hilfe', 'Nicht gelöst'];

function uid() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`; }
function freshData() {
  return { version: 1, folders: [], exercises: [], dailyGoal: 5, session: null };
}
function safeName(s) { return String(s || '').replace(/[\\/:*?"<>|]/g, '-').trim() || 'PDF'; }
function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), rem = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}` : `${m}:${String(rem).padStart(2, '0')}`;
}
function average(values) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; }
function dayKey(time) {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function lastAttempt(exercise) { return exercise.attempts?.at(-1) || null; }
function ratingIndex(exercise) {
  const rating = lastAttempt(exercise)?.rating;
  return rating ? RATINGS.indexOf(rating) : -1;
}
function orderExercises(items) {
  return [...items].sort((a, b) => {
    const ai = ratingIndex(a), bi = ratingIndex(b);
    const ap = ai < 0 ? -1 : ai, bp = bi < 0 ? -1 : bi;
    if (ap !== bp) return ap - bp;
    return (lastAttempt(a)?.date || 0) - (lastAttempt(b)?.date || 0);
  });
}

class RepetitoView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this.timer = null; this.filter = ''; this.filterRating = ''; this.filterIndependence = ''; this.onlyFavorites = false; }
  getViewType() { return VIEW; }
  getDisplayText() { return 'Repetito'; }
  getIcon() { return 'graduation-cap'; }
  async onOpen() { await this.render(); }
  async onClose() { this.stopTicker(); await this.plugin.flushRunningTimer(); }

  async render() {
    this.stopTicker();
    const root = this.containerEl.children[1] || this.containerEl;
    root.empty(); root.addClass('repetito-root');
    const data = this.plugin.data;
    const header = root.createDiv({ cls: 'repetito-header' });
    header.createEl('h2', { text: 'Repetito' });
    this.button(header, 'Startseite', 'house', () => this.render());
    this.button(header, 'Neuer Ordner', 'folder-plus', () => this.addFolder());
    this.button(header, 'Neue Übung', 'plus', () => this.addExercise());
    this.button(header, 'Repetition starten', 'play', () => this.startRound());
    if (data.session) this.button(header, 'Runde fortsetzen', 'rotate-cw', () => this.resumeRound());
    this.dashboard(root);
    const controls = root.createDiv({ cls: 'repetito-controls' });
    const search = controls.createEl('input', { attr: { type: 'search', placeholder: 'Ordner und Übungen suchen…', 'aria-label': 'Suchen' } });
    search.value = this.filter;
    search.addEventListener('input', () => { this.filter = search.value; this.renderTree(tree); });
    const rating = controls.createEl('select', { attr: { 'aria-label': 'Nach Schwierigkeit filtern' } });
    this.option(rating, '', 'Alle Schwierigkeiten'); RATINGS.forEach(x => this.option(rating, x, x)); rating.value = this.filterRating;
    rating.addEventListener('change', () => { this.filterRating = rating.value; this.renderTree(tree); });
    const independent = controls.createEl('select', { attr: { 'aria-label': 'Nach Selbstständigkeit filtern' } });
    this.option(independent, '', 'Alle Bewertungen'); INDEPENDENCE.forEach(x => this.option(independent, x, x)); independent.value = this.filterIndependence;
    independent.addEventListener('change', () => { this.filterIndependence = independent.value; this.renderTree(tree); });
    const favLabel = controls.createEl('label', { cls: 'repetito-check' });
    const fav = favLabel.createEl('input', { attr: { type: 'checkbox' } }); fav.checked = this.onlyFavorites;
    favLabel.createSpan({ text: 'Favoriten' }); fav.addEventListener('change', () => { this.onlyFavorites = fav.checked; this.renderTree(tree); });
    const tree = root.createDiv({ cls: 'repetito-tree' });
    this.renderTree(tree);
  }

  dashboard(root) {
    const d = this.plugin.data, now = Date.now();
    const today = d.exercises.flatMap(x => x.attempts || []).filter(x => dayKey(x.date) === dayKey(now)).length;
    const panel = root.createDiv({ cls: 'repetito-dashboard' });
    const goal = panel.createDiv({ cls: 'repetito-card' });
    goal.createEl('h3', { text: 'Tagesziel' });
    goal.createEl('div', { text: `${today} von ${d.dailyGoal} Repetitionen heute` });
    const progress = goal.createEl('progress', { attr: { max: Math.max(1, d.dailyGoal), value: Math.min(today, d.dailyGoal) } });
    progress.addClass('repetito-progress');
    this.button(goal, 'Ziel ändern', 'target', () => this.changeGoal());
    const stats = panel.createDiv({ cls: 'repetito-card' });
    stats.createEl('h3', { text: 'Lernstand' });
    const counts = Array(RATINGS.length + 1).fill(0);
    d.exercises.forEach(x => { const i = ratingIndex(x); counts[i < 0 ? 0 : i + 1]++; });
    const names = ['Noch nicht repetiert', ...RATINGS];
    const total = Math.max(1, d.exercises.length);
    const bar = stats.createDiv({ cls: 'repetito-stacked' });
    counts.forEach((n, i) => { const segment = bar.createDiv({ cls: `repetito-segment rep-segment-${i}` }); segment.style.width = `${100 * n / total}%`; segment.setAttribute('title', `${names[i]}: ${n}`); });
    const legend = stats.createDiv({ cls: 'repetito-legend' });
    names.forEach((n, i) => legend.createSpan({ text: `${n}: ${counts[i]}`, cls: `rep-legend-${i}` }));
    stats.createEl('small', { text: `${d.exercises.length} Übungen insgesamt` });
  }

  renderTree(container) {
    if (!container?.isConnected) return;
    container.empty();
    const data = this.plugin.data;
    const folderMatches = f => !this.filter || f.name.toLowerCase().includes(this.filter.toLowerCase());
    const exerciseMatches = x => {
      if (this.filter && !x.name.toLowerCase().includes(this.filter.toLowerCase())) return false;
      if (this.onlyFavorites && !x.favorite) return false;
      if (this.filterRating && lastAttempt(x)?.rating !== this.filterRating) return false;
      if (this.filterIndependence && lastAttempt(x)?.independence !== this.filterIndependence) return false;
      return true;
    };
    const drawFolder = (folder, host, depth) => {
      const children = data.folders.filter(x => x.parentId === folder.id);
      const exercises = data.exercises.filter(x => x.folderId === folder.id && exerciseMatches(x));
      if (!folderMatches(folder) && !children.length && !exercises.length) return;
      const row = host.createDiv({ cls: 'repetito-row repetito-folder-row' }); row.style.setProperty('--depth', depth);
      const disclosure = this.button(row, 'Ein-/ausklappen', 'chevron-down', () => { body.toggleClass('repetito-hidden', !body.hasClass('repetito-hidden')); disclosure.toggleClass('is-collapsed', body.hasClass('repetito-hidden')); });
      disclosure.addClass('repetito-disclosure');
      row.createSpan({ text: folder.name, cls: 'repetito-item-name' });
      this.button(row, 'Übung in diesem Ordner erstellen', 'plus', () => this.addExercise(folder.id));
      this.button(row, 'Ordner bearbeiten', 'pencil', () => this.editFolder(folder));
      this.button(row, 'Ordner verschieben', 'folder-input', () => this.moveFolder(folder));
      this.button(row, 'Unterordner erstellen', 'folder-plus', () => this.addFolder(folder.id));
      this.button(row, 'Löschen', 'trash-2', () => this.deleteFolder(folder));
      const aggregate = this.subtreeExercises(folder.id);
      const counts = Array(RATINGS.length + 1).fill(0);
      aggregate.forEach(x => { const i = ratingIndex(x); counts[i < 0 ? 0 : i + 1]++; });
      const mini = row.createDiv({ cls: 'repetito-folder-progress', attr: { title: `${aggregate.length} Übungen in diesem Ordner` } });
      const total = Math.max(1, aggregate.length);
      counts.forEach((n, i) => { const segment = mini.createDiv({ cls: `repetito-segment rep-segment-${i}` }); segment.style.width = `${100 * n / total}%`; });
      const body = host.createDiv({ cls: 'repetito-folder-content' });
      children.forEach(x => drawFolder(x, body, depth + 1));
      exercises.forEach(x => this.drawExerciseRow(x, body, depth + 1));
      if (!children.length && !exercises.length) body.createEl('small', { text: 'Noch keine Übungen', cls: 'repetito-empty' });
    };
    const treeHost = container.createDiv();
    data.folders.filter(x => !x.parentId || !data.folders.some(p => p.id === x.parentId)).forEach(x => drawFolder(x, treeHost, 0));
    data.exercises.filter(x => !x.folderId && exerciseMatches(x)).forEach(x => this.drawExerciseRow(x, treeHost, 0));
    if (!data.folders.length && !data.exercises.length) container.createEl('p', { text: 'Erstelle einen Ordner oder lege direkt eine Übung an.' });
  }

  drawExerciseRow(exercise, host, depth) {
    const row = host.createDiv({ cls: 'repetito-row repetito-exercise-row' }); row.style.setProperty('--depth', depth);
    const attempt = lastAttempt(exercise);
    this.button(row, exercise.favorite ? 'Favorit entfernen' : 'Als Favorit markieren', exercise.favorite ? 'star' : 'star', async () => { exercise.favorite = !exercise.favorite; await this.plugin.persist(); await this.render(); });
    const name = row.createEl('button', { text: exercise.name, cls: 'repetito-link' }); name.addEventListener('click', () => this.showExercise(exercise.id));
    row.createSpan({ text: attempt ? `${attempt.rating} · ${formatTime(attempt.seconds)}` : 'Noch nicht repetiert', cls: 'repetito-meta' });
    this.button(row, 'Übung bearbeiten', 'pencil', () => this.editExercise(exercise));
    this.button(row, 'Übung verschieben', 'folder-input', () => this.moveExercise(exercise));
    this.button(row, 'Löschen', 'trash-2', () => this.deleteExercise(exercise));
  }

  subtreeExercises(folderId) {
    const ids = new Set([folderId]); let changed = true;
    while (changed) { changed = false; this.plugin.data.folders.forEach(f => { if (ids.has(f.parentId) && !ids.has(f.id)) { ids.add(f.id); changed = true; } }); }
    return this.plugin.data.exercises.filter(x => ids.has(x.folderId));
  }

  async showExercise(id) {
    const ex = this.plugin.exercise(id); if (!ex) return;
    this.stopTicker();
    const root = this.containerEl.children[1] || this.containerEl; root.empty(); root.addClass('repetito-root');
    const head = root.createDiv({ cls: 'repetito-header' });
    this.button(head, 'Zurück zur Übersicht', 'arrow-left', () => this.render()); head.createEl('h2', { text: ex.name });
    const timerPanel = root.createDiv({ cls: 'repetito-card repetito-timer-card' });
    timerPanel.createEl('h3', { text: 'Repetition' });
    const clock = timerPanel.createEl('div', { text: '0:00', cls: 'repetito-clock' });
    const timerButtons = timerPanel.createDiv({ cls: 'repetito-actions' });
    const start = this.button(timerButtons, this.plugin.data.session && this.plugin.data.session.exerciseId !== ex.id ? 'Andere Repetition läuft' : 'Starten', 'play', async () => { await this.beginAttempt(ex.id); start.setText('Läuft'); start.disabled = true; pause.disabled = false; finish.disabled = false; this.updateClock(clock); this.timer = window.setInterval(() => this.updateClock(clock), 500); });
    const sameSession = this.plugin.data.session?.exerciseId === ex.id;
    if (this.plugin.data.session && !sameSession) start.disabled = true;
    const pause = this.button(timerButtons, 'Pausieren', 'pause', async () => { await this.togglePause(); pause.setText(this.plugin.data.session?.paused ? 'Fortsetzen' : 'Pausieren'); this.updateClock(clock); }); pause.disabled = !sameSession;
    const finish = this.button(timerButtons, 'Abschliessen', 'check', () => this.finishAttempt(ex.id)); finish.disabled = !sameSession;
    this.button(timerButtons, 'Abbrechen', 'x', () => this.cancelAttempt(ex.id));
    if (this.plugin.data.session?.exerciseId === ex.id) {
      const session = this.plugin.data.session;
      start.setText(session.paused ? 'Fortsetzen' : 'Läuft'); start.disabled = !session.paused;
      pause.setText(session.paused ? 'Fortsetzen' : 'Pausieren'); pause.disabled = false;
      finish.disabled = false; this.updateClock(clock);
      if (!session.paused) this.timer = window.setInterval(() => this.updateClock(clock), 500);
    }
    const attempts = ex.attempts || [];
    const times = attempts.map(x => x.seconds);
    const stats = root.createDiv({ cls: 'repetito-stats' });
    [['Abgeschlossen', attempts.length], ['Zuletzt', attempts.length ? new Date(attempts.at(-1).date).toLocaleDateString('de-CH') : '–'], ['Schwierigkeit', lastAttempt(ex)?.rating || '–'], ['Letzte Zeit', times.length ? formatTime(times.at(-1)) : '–'], ['Schnellste Zeit', times.length ? formatTime(Math.min(...times)) : '–'], ['Durchschnitt', times.length ? formatTime(average(times)) : '–']].forEach(([a,b]) => { const c = stats.createDiv({ cls: 'repetito-stat' }); c.createEl('small', { text: a }); c.createEl('strong', { text: String(b) }); });
    root.createEl('h3', { text: 'Aufgaben' });
    this.pdfList(root, ex, 'task');
    root.createEl('h3', { text: 'Lösungen' });
    const reveal = root.createEl('button', { text: 'Lösungen anzeigen' });
    const solutions = root.createDiv({ cls: 'repetito-hidden' });
    reveal.addEventListener('click', () => { solutions.toggleClass('repetito-hidden', !solutions.hasClass('repetito-hidden')); reveal.setText(solutions.hasClass('repetito-hidden') ? 'Lösungen anzeigen' : 'Lösungen verbergen'); });
    this.pdfList(solutions, ex, 'solution');
    root.createEl('h3', { text: 'Notizen zur Aufgabe' });
    const notes = root.createEl('textarea', { cls: 'repetito-notes', attr: { placeholder: 'Lösungswege, Fehler, Merksätze und offene Fragen…', rows: '7' } }); notes.value = ex.notes || '';
    let saveWait; notes.addEventListener('input', () => { ex.notes = notes.value; window.clearTimeout(saveWait); saveWait = window.setTimeout(() => this.plugin.persist(), 300); });
    root.createEl('h3', { text: 'Repetitionsverlauf' });
    const history = root.createDiv({ cls: 'repetito-history' });
    [...attempts].reverse().forEach(item => {
      const row = history.createDiv({ cls: 'repetito-history-row' });
      row.createSpan({ text: `${new Date(item.date).toLocaleString('de-CH')} · ${formatTime(item.seconds)} · ${item.rating} · ${item.independence}` });
      this.button(row, 'Eintrag bearbeiten', 'pencil', () => this.editAttempt(ex, item));
      this.button(row, 'Eintrag löschen', 'trash-2', () => this.confirm('Diesen Repetitionsverlauf löschen?', async () => { ex.attempts = ex.attempts.filter(a => a.id !== item.id); await this.plugin.persist(); await this.showExercise(ex.id); }));
    });
  }

  pdfList(host, exercise, type) {
    const files = exercise.pdfs.filter(x => x.type === type);
    if (!files.length) host.createEl('p', { text: 'Noch keine PDFs zugeordnet.', cls: 'repetito-empty' });
    files.forEach(file => {
      const row = host.createDiv({ cls: 'repetito-pdf-row' });
      const open = row.createEl('button', { text: file.name, cls: 'repetito-link' }); open.addEventListener('click', () => this.app.workspace.openLinkText(file.path, '', true));
      this.button(row, 'Zuordnung entfernen', 'unlink', () => this.confirm('PDF-Zuordnung entfernen? Die Originaldatei bleibt erhalten.', async () => { exercise.pdfs = exercise.pdfs.filter(x => x.id !== file.id); await this.plugin.persist(); await this.showExercise(exercise.id); }));
    });
    this.button(host, type === 'task' ? 'Aufgaben-PDF hinzufügen' : 'Lösungs-PDF hinzufügen', 'file-plus', () => this.addPdf(exercise, type));
  }

  addPdf(exercise, type) {
    const modal = new Modal(this.app); modal.titleEl.setText(type === 'task' ? 'Aufgaben-PDF hinzufügen' : 'Lösungs-PDF hinzufügen');
    const choices = modal.contentEl; choices.createEl('p', { text: 'Vorhandene PDF aus dem Vault wählen oder eine neue Datei hinzufügen.' });
    const select = choices.createEl('select'); select.createEl('option', { text: 'PDF im Vault auswählen…', attr: { value: '' } });
    this.app.vault.getFiles().filter(f => f.extension.toLowerCase() === 'pdf').forEach(f => select.createEl('option', { text: f.path, attr: { value: f.path } }));
    const attach = choices.createEl('button', { text: 'Diese PDF zuordnen' }); attach.addEventListener('click', async () => {
      if (!select.value) { new Notice('Wähle zuerst eine PDF aus.'); return; }
      await this.attachPdf(exercise, type, select.value); modal.close(); await this.showExercise(exercise.id);
    });
    const input = choices.createEl('input', { attr: { type: 'file', accept: 'application/pdf,.pdf', 'aria-label': 'Neue PDF hinzufügen' } });
    input.addEventListener('change', async () => {
      const file = input.files?.[0]; if (!file) return;
      try {
        await this.app.vault.createFolder(PDF_DIR).catch(() => {});
        const path = normalizePath(`${PDF_DIR}/${safeName(file.name)}`);
        let finalPath = path, n = 2; while (this.app.vault.getAbstractFileByPath(finalPath)) { const dot = path.lastIndexOf('.'); finalPath = `${path.slice(0, dot)} (${n++})${path.slice(dot)}`; }
        await this.app.vault.createBinary(finalPath, await file.arrayBuffer());
        await this.attachPdf(exercise, type, finalPath); modal.close(); await this.showExercise(exercise.id);
      } catch (e) { new Notice(`PDF konnte nicht importiert werden: ${e.message}`); }
    });
    modal.open();
  }

  async attachPdf(exercise, type, path) {
    exercise.pdfs.push({ id: uid(), type, path, name: path.split('/').at(-1) }); await this.plugin.persist();
  }

  addFolder(parentId = null) {
    const modal = new TextModal(this.app, 'Neuer Ordner', 'Ordnername', async name => {
      this.plugin.data.folders.push({ id: uid(), name, parentId }); await this.plugin.persist(); await this.render();
    }); modal.open();
  }
  editFolder(folder) {
    const modal = new TextModal(this.app, 'Ordner umbenennen', 'Ordnername', async name => { folder.name = name; await this.plugin.persist(); await this.render(); }, folder.name); modal.open();
  }
  moveFolder(folder) {
    const descendants = new Set([folder.id]); let changed = true;
    while (changed) { changed = false; this.plugin.data.folders.forEach(f => { if (descendants.has(f.parentId) && !descendants.has(f.id)) { descendants.add(f.id); changed = true; } }); }
    const choices = this.plugin.data.folders.filter(f => !descendants.has(f.id));
    this.moveModal('Ordner verschieben', choices, folder.parentId, async destination => { folder.parentId = destination || null; await this.plugin.persist(); await this.render(); });
  }
  moveExercise(exercise) {
    this.moveModal('Übung verschieben', this.plugin.data.folders, exercise.folderId, async destination => { exercise.folderId = destination || null; await this.plugin.persist(); await this.render(); });
  }
  moveModal(title, folders, selectedId, callback) {
    const modal = new Modal(this.app); modal.titleEl.setText(title); const c = modal.contentEl;
    const select = c.createEl('select', { attr: { 'aria-label': 'Zielordner' } });
    this.option(select, '', 'Hauptverzeichnis');
    folders.forEach(f => this.option(select, f.id, `${f.name}${f.parentId ? ` (${this.folderPath(f.id)})` : ''}`));
    select.value = selectedId || '';
    c.createEl('button', { text: 'Verschieben' }).addEventListener('click', async () => { await callback(select.value); modal.close(); }); modal.open();
  }
  folderPath(id) {
    const names = []; let current = this.plugin.data.folders.find(f => f.id === id); const seen = new Set();
    while (current && !seen.has(current.id)) { seen.add(current.id); names.unshift(current.name); current = this.plugin.data.folders.find(f => f.id === current.parentId); }
    return names.join(' / ');
  }
  addExercise(folderId = null) {
    const modal = new TextModal(this.app, 'Neue Übung', 'Name der Übung', async name => {
      const ex = { id: uid(), name, folderId, notes: '', favorite: false, pdfs: [], attempts: [] }; this.plugin.data.exercises.push(ex); await this.plugin.persist(); await this.showExercise(ex.id);
    }); modal.open();
  }
  editExercise(ex) {
    const modal = new TextModal(this.app, 'Übung umbenennen', 'Name der Übung', async name => { ex.name = name; await this.plugin.persist(); await this.render(); }, ex.name); modal.open();
  }
  deleteExercise(ex) {
    this.confirm(`„${ex.name}“ und alle Notizen und Repetitionsdaten löschen? Zugeordnete PDFs bleiben im Vault erhalten.`, async () => { this.plugin.data.exercises = this.plugin.data.exercises.filter(x => x.id !== ex.id); await this.plugin.persist(); await this.render(); });
  }
  deleteFolder(folder) {
    const descendants = new Set([folder.id]); let changed = true;
    while (changed) { changed = false; this.plugin.data.folders.forEach(f => { if (descendants.has(f.parentId) && !descendants.has(f.id)) { descendants.add(f.id); changed = true; } }); }
    const exercises = this.plugin.data.exercises.filter(x => descendants.has(x.folderId));
    this.confirm(`Ordner „${folder.name}“ mit ${descendants.size} Ordner(n) sowie ${exercises.length} Übung(en), Notizen und Verläufen löschen? PDFs bleiben erhalten.`, async () => {
      this.plugin.data.folders = this.plugin.data.folders.filter(x => !descendants.has(x.id)); this.plugin.data.exercises = this.plugin.data.exercises.filter(x => !descendants.has(x.folderId)); await this.plugin.persist(); await this.render();
    });
  }
  changeGoal() {
    const modal = new TextModal(this.app, 'Tagesziel ändern', 'Anzahl pro Tag', async value => { const n = Number(value); if (Number.isInteger(n) && n > 0) { this.plugin.data.dailyGoal = n; await this.plugin.persist(); await this.render(); } else new Notice('Gib eine positive ganze Zahl ein.'); }, String(this.plugin.data.dailyGoal), 'number'); modal.open();
  }

  startRound() {
    if (this.plugin.data.session) { new Notice('Es läuft bereits eine Runde.'); return; }
    const modal = new Modal(this.app); modal.titleEl.setText('Repetitionsrunde zusammenstellen');
    const c = modal.contentEl; c.createEl('p', { text: 'Wähle Ordner aus. Unterordner werden einbezogen. Ohne Auswahl werden alle Übungen verwendet.' });
    const checks = [];
    this.plugin.data.folders.forEach(f => { const label = c.createEl('label', { cls: 'repetito-check' }); const input = label.createEl('input', { attr: { type: 'checkbox' } }); label.createSpan({ text: f.name }); checks.push([f.id, input]); });
    const include = c.createEl('label', { cls: 'repetito-check' }); const includeInput = include.createEl('input', { attr: { type: 'checkbox' } }); includeInput.checked = true; include.createSpan({ text: 'Unterordner einbeziehen' });
    const limit = c.createEl('input', { attr: { type: 'number', min: '1', placeholder: 'Alle Übungen', 'aria-label': 'Maximale Anzahl' } });
    const favorites = c.createEl('label', { cls: 'repetito-check' }); const favOnly = favorites.createEl('input', { attr: { type: 'checkbox' } }); favorites.createSpan({ text: 'Nur Favoriten' });
    const unrated = c.createEl('label', { cls: 'repetito-check' }); const un = unrated.createEl('input', { attr: { type: 'checkbox' } }); unrated.createSpan({ text: 'Nur noch nicht repetierte' });
    const byRating = c.createEl('select', { attr: { 'aria-label': 'Schwierigkeit der Runde' } }); this.option(byRating, '', 'Alle Schwierigkeiten'); RATINGS.forEach(x => this.option(byRating, x, x));
    const byIndependence = c.createEl('select', { attr: { 'aria-label': 'Selbstständigkeit der Runde' } }); this.option(byIndependence, '', 'Alle Selbstständigkeiten'); INDEPENDENCE.forEach(x => this.option(byIndependence, x, x));
    const launch = c.createEl('button', { text: 'Runde starten' }); launch.addEventListener('click', async () => {
      const selected = new Set(checks.filter(x => x[1].checked).map(x => x[0]));
      if (selected.size && includeInput.checked) { let change = true; while (change) { change = false; this.plugin.data.folders.forEach(f => { if (selected.has(f.parentId) && !selected.has(f.id)) { selected.add(f.id); change = true; } }); } }
      let items = this.plugin.data.exercises.filter(x => !selected.size || selected.has(x.folderId));
      if (favOnly.checked) items = items.filter(x => x.favorite);
      if (un.checked) items = items.filter(x => !x.attempts.length);
      if (byRating.value) items = items.filter(x => lastAttempt(x)?.rating === byRating.value);
      if (byIndependence.value) items = items.filter(x => lastAttempt(x)?.independence === byIndependence.value);
      items = orderExercises(items);
      if (limit.value) items = items.slice(0, Math.max(1, Number(limit.value)));
      if (!items.length) { new Notice('Keine Übungen entsprechen der Auswahl.'); return; }
      this.plugin.data.session = { ids: items.map(x => x.id), index: 0, elapsed: 0, paused: true, exerciseId: items[0].id, startedAt: 0, completed: [] };
      await this.plugin.persist(); modal.close(); await this.showExercise(items[0].id); new Notice(`Runde mit ${items.length} Übung(en) bereit. Starte den Timer.`);
    }); modal.open();
  }

  async beginAttempt(exerciseId) {
    let s = this.plugin.data.session;
    if (s && s.exerciseId !== exerciseId) { new Notice('Beende erst die laufende Übung.'); return; }
    if (!s) s = this.plugin.data.session = { ids: [exerciseId], index: 0, elapsed: 0, paused: true, exerciseId, startedAt: 0, single: true };
    if (s.paused) { s.paused = false; s.startedAt = Date.now(); await this.plugin.persist(); }
  }
  async togglePause() {
    const s = this.plugin.data.session; if (!s) return;
    if (!s.paused) { s.elapsed += (Date.now() - s.startedAt) / 1000; s.paused = true; s.startedAt = 0; }
    else { s.paused = false; s.startedAt = Date.now(); }
    await this.plugin.persist();
  }
  currentElapsed() { const s = this.plugin.data.session; return s ? s.elapsed + (!s.paused && s.startedAt ? (Date.now() - s.startedAt) / 1000 : 0) : 0; }
  updateClock(clock) { clock.setText(formatTime(this.currentElapsed())); }
  stopTicker() { if (this.timer) window.clearInterval(this.timer); this.timer = null; }

  async finishAttempt(exerciseId) {
    const s = this.plugin.data.session; if (!s || s.exerciseId !== exerciseId) return;
    if (!s.paused) s.elapsed += (Date.now() - s.startedAt) / 1000;
    s.paused = true; s.startedAt = 0; await this.plugin.persist(); this.stopTicker();
    const modal = new Modal(this.app); modal.titleEl.setText('Repetition bewerten');
    const c = modal.contentEl; c.createEl('p', { text: `Bearbeitungszeit: ${formatTime(s.elapsed)}` });
    c.createEl('label', { text: 'Schwierigkeit' }); const rating = c.createEl('select'); RATINGS.forEach(x => this.option(rating, x, x));
    c.createEl('label', { text: 'Selbstständigkeit' }); const independence = c.createEl('select'); INDEPENDENCE.forEach(x => this.option(independence, x, x));
    c.createEl('button', { text: 'Speichern' }).addEventListener('click', async () => {
      const ex = this.plugin.exercise(exerciseId); ex.attempts.push({ id: uid(), date: Date.now(), seconds: Math.max(0, Math.round(s.elapsed)), rating: rating.value, independence: independence.value });
      if (s.single) this.plugin.data.session = null;
      else s.completed.push({ exerciseName: ex.name, seconds: Math.max(0, Math.round(s.elapsed)), rating: rating.value, independence: independence.value });
      await this.plugin.persist(); modal.close();
      if (this.plugin.data.session && !s.single) await this.nextRoundExercise(); else await this.showExercise(exerciseId);
    });
    c.createEl('button', { text: 'Abbrechen' }).addEventListener('click', () => { modal.close(); this.render(); }); modal.open();
  }

  async nextRoundExercise() {
    const s = this.plugin.data.session;
    s.index++;
    if (s.index >= s.ids.length) {
      this.plugin.data.session = null; await this.plugin.persist();
      this.showRoundSummary(s); await this.render(); return;
    }
    s.exerciseId = s.ids[s.index]; s.elapsed = 0; s.paused = true; s.startedAt = 0; delete s.completedAt;
    await this.plugin.persist(); await this.showExercise(s.exerciseId);
  }

  showRoundSummary(session) {
    const modal = new Modal(this.app); modal.titleEl.setText('Repetitionsrunde abgeschlossen');
    const c = modal.contentEl; const completed = session.completed || [];
    const total = completed.reduce((sum, x) => sum + x.seconds, 0);
    c.createEl('p', { text: `${completed.length} Übung(en) abgeschlossen · Gesamtzeit ${formatTime(total)}` });
    const list = c.createEl('ul'); completed.forEach(x => list.createEl('li', { text: `${x.exerciseName}: ${formatTime(x.seconds)} · ${x.rating} · ${x.independence}` }));
    c.createEl('button', { text: 'Schliessen' }).addEventListener('click', () => modal.close()); modal.open();
  }

  resumeRound() {
    const s = this.plugin.data.session; if (!s) return;
    const ex = this.plugin.exercise(s.exerciseId); if (!ex) { this.plugin.data.session = null; this.plugin.persist(); new Notice('Gespeicherte Runde war ungültig.'); return this.render(); }
    this.showExercise(ex.id);
  }
  async cancelAttempt(exerciseId) {
    const s = this.plugin.data.session; if (!s || s.exerciseId !== exerciseId) return;
    this.confirm('Laufenden Versuch und die Runde abbrechen? Es wird kein Versuch gespeichert.', async () => { this.stopTicker(); this.plugin.data.session = null; await this.plugin.persist(); await this.render(); });
  }
  editAttempt(ex, item) {
    const modal = new Modal(this.app); modal.titleEl.setText('Repetition korrigieren'); const c = modal.contentEl;
    const secs = c.createEl('input', { attr: { type: 'number', min: '0', value: String(item.seconds), 'aria-label': 'Sekunden' } });
    const rating = c.createEl('select'); RATINGS.forEach(x => this.option(rating, x, x)); rating.value = item.rating;
    const independence = c.createEl('select'); INDEPENDENCE.forEach(x => this.option(independence, x, x)); independence.value = item.independence;
    c.createEl('button', { text: 'Änderungen speichern' }).addEventListener('click', async () => { item.seconds = Math.max(0, Number(secs.value)); item.rating = rating.value; item.independence = independence.value; await this.plugin.persist(); modal.close(); await this.showExercise(ex.id); }); modal.open();
  }
  async confirm(message, action) {
    const modal = new Modal(this.app); modal.titleEl.setText('Bitte bestätigen'); modal.contentEl.createEl('p', { text: message });
    modal.contentEl.createEl('button', { text: 'Abbrechen' }).addEventListener('click', () => modal.close());
    modal.contentEl.createEl('button', { text: 'Bestätigen', cls: 'mod-warning' }).addEventListener('click', async () => { modal.close(); await action(); }); modal.open();
  }
  button(host, label, icon, action) {
    const b = host.createEl('button', { cls: 'repetito-icon-button', attr: { 'aria-label': label, title: label } });
    setIcon(b, icon); b.addEventListener('click', action); return b;
  }
  option(select, value, label) { select.createEl('option', { text: label, attr: { value } }); }
}

class TextModal extends Modal {
  constructor(app, title, placeholder, onSubmit, initial = '', type = 'text') { super(app); Object.assign(this, { title, placeholder, onSubmit, initial, type }); }
  onOpen() {
    this.titleEl.setText(this.title); const input = this.contentEl.createEl('input', { attr: { type: this.type, placeholder: this.placeholder, value: this.initial, 'aria-label': this.placeholder } });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit.click(); });
    const submit = this.contentEl.createEl('button', { text: 'Speichern' }); submit.addEventListener('click', async () => { const value = input.value.trim(); if (!value) return new Notice('Bitte einen Wert eingeben.'); await this.onSubmit(value); this.close(); }); input.focus();
  }
  onClose() { this.contentEl.empty(); }
}

module.exports = class RepetitoPlugin extends Plugin {
  async onload() {
    this.data = freshData();
    await this.app.vault.createFolder(DATA_DIR).catch(() => {});
    await this.app.vault.createFolder(PDF_DIR).catch(() => {});
    try { this.data = { ...freshData(), ...JSON.parse(await this.app.vault.adapter.read(DATA_FILE)) }; }
    catch (_) { await this.persist(); }
    this.registerView(VIEW, leaf => new RepetitoView(leaf, this));
    this.addRibbonIcon('graduation-cap', 'Repetito öffnen', () => this.activateView());
    this.addCommand({ id: 'open', name: 'Repetito öffnen', callback: () => this.activateView() });
    this.addCommand({ id: 'start-round', name: 'Repetitionsrunde starten', callback: async () => { await this.activateView(); this.mainLeaf?.view.startRound(); } });
  }
  onunload() { void this.flushRunningTimer(); }
  async persist() {
    try { await this.app.vault.adapter.write(DATA_FILE, JSON.stringify(this.data, null, 2)); }
    catch (e) { new Notice(`Repetito konnte nicht speichern: ${e.message}`); }
  }
  async flushRunningTimer() {
    const s = this.data?.session;
    if (s && !s.paused && s.startedAt) { s.elapsed += (Date.now() - s.startedAt) / 1000; s.paused = true; s.startedAt = 0; await this.persist(); }
  }
  exercise(id) { return this.data.exercises.find(x => x.id === id); }
  async activateView() {
    if (!this.mainLeaf || !this.mainLeaf.view || this.mainLeaf.view.getViewType?.() !== VIEW) {
      this.mainLeaf = this.app.workspace.getLeaf('tab');
    }
    await this.mainLeaf.setViewState({ type: VIEW, active: true });
    this.app.workspace.revealLeaf(this.mainLeaf);
  }
};
