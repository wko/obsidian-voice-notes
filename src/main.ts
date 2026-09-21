import { t, setLanguage, getLocale, type Message } from './i18n';
import { MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, requestUrl, getLanguage, setIcon, type TAbstractFile, type App } from 'obsidian';
import { DEFAULT_PROMPT, processJob, type Job, type Options } from './core';
import { footerExtension, voiceButton } from './editor';
import { OPENAI_BASE_URL, OpenAIProvider, normalizeBaseUrl } from './provider';
import { RecorderModal } from './recorder';
import { JobStore } from './store';
import { ApiKey } from './api-key';
import { createAppendPlan, inspectAppend, applyAppendPlan, removeLegacyComments } from './append-journal';
import { noteProgress, type ProgressJob } from './progress';
import { prepareNoteContext, mainContentIsEmpty, MAX_VOCABULARY_CHARS } from './context';
interface Settings extends Options { vaultId: string; secretId?: string; legacyCommentsRemoved?: boolean; showInlineButton: boolean; }
declare const VOICE_APPEND_LAB: boolean;
const DEFAULTS: Settings = { vaultId: '', transcriptionBaseUrl: OPENAI_BASE_URL, cleanupBaseUrl: OPENAI_BASE_URL, transcriptionModel: 'gpt-transcribe', cleanupModel: 'gpt-5.6-luna', prompt: DEFAULT_PROMPT, keepTranscript: false, datedHeading: false, useNoteContext: false, vocabulary: '', generateTitle: false, showInlineButton: true };
const LABELS: Record<Job['state'], Message> = { queued: 'Wartet auf Verarbeitung', transcribing: 'Wird transkribiert', cleaning: 'Wird bereinigt', appending: 'Wird angehängt', completed: 'Angehängt', failed: 'Benötigt Aufmerksamkeit' };
export default class VoiceAppend extends Plugin {
  settings!: Settings;
  store!: JobStore;
  apiKey!: ApiKey;
  private progressJobs = new Map<string, ProgressJob>();
  private provider!: OpenAIProvider;
  private recorder?: RecorderModal;
  private running = false;
  private notesReady = false;
  private activeId?: string;
  private disposed = false;
  private readingFooters = new Map<MarkdownView, { host: HTMLElement; el: HTMLElement; dispose: () => void }>();
  private listeners = new Set<() => void>();
  private targetFiles = new Map<string, TFile>();
  async onload() {
    setLanguage(getLanguage());
    const saved: unknown = await this.loadData();
    this.settings = this.migrateSettings(saved);
    const savedSettings = saved && typeof saved === 'object' ? saved as Partial<Settings> : {};
    // Persist endpoint defaults once, so subsequent launches and new job snapshots
    // use the same explicit configuration. Secret references remain untouched.
    if (!('transcriptionBaseUrl' in savedSettings) || !('cleanupBaseUrl' in savedSettings)) await this.saveSettings();
    this.updateAppearance();
    if (!this.settings.vaultId) { this.settings.vaultId = crypto.randomUUID(); await this.saveSettings(); }
    this.apiKey = new ApiKey(this.app.secretStorage, this.settings.vaultId, this.settings.secretId);
    this.store = await JobStore.open(this.settings.vaultId);
    for (const job of await this.store.all()) { this.cacheProgress(job); const file = this.app.vault.getAbstractFileByPath(job.targetPath); if (file instanceof TFile) this.targetFiles.set(job.id, file); }
    this.provider = new OpenAIProvider(() => this.apiKey.get(), request => requestUrl(request));
    this.addSettingTab(new VoiceSettings(this.app, this));
    this.addCommand({ id: 'record', name: t('Gedanken ergänzen'), icon: 'mic', checkCallback: checking => { const file = this.app.workspace.getActiveFile(); if (!file || file.extension !== 'md') return false; if (!checking) this.start(file); return true; } });
    this.addCommand({ id: 'outbox', name: t('Aufnahmen und Status öffnen'), callback: () => this.openOutbox() });
    if (VOICE_APPEND_LAB) this.addCommand({ id: 'lab-test', name: t('Lab: Test-Ergänzung ohne Mikrofon und API'), callback: async () => {
      const file = this.app.workspace.getActiveFile(); if (!file || file.extension !== 'md') return;
      const job: Job = { id: crypto.randomUUID(), targetPath: file.path, createdAt: Date.now(), audio: null, mime: '', duration: 0, options: { ...this.settings }, state: 'queued', raw: 'So, I want to append my thoughts directly to this note, even if I switch notes in between.', cleaned: 'I want to append my thoughts directly to this note, even if I switch notes in between.' };
      await this.saveJob(job); this.targetFiles.set(job.id, file); await this.runQueue();
    } });
    if (VOICE_APPEND_LAB) this.addCommand({ id: 'lab-progress', name: t('Lab: Fortschrittsanzeige testen (ohne API)'), callback: async () => {
      const file = this.app.workspace.getActiveFile(); if (!file || file.extension !== 'md') return;
      const id = crypto.randomUUID();
      try {
        for (const state of ['transcribing', 'cleaning', 'appending'] as const) {
          if (this.disposed) break;
          this.progressJobs.set(id, { id, state, targetPath: file.path, createdAt: Date.now() }); this.notify();
          await new Promise(resolve => window.setTimeout(resolve, 3000));
        }
      } finally { this.progressJobs.delete(id); this.notify(); }
    } });
    this.addRibbonIcon('mic', `Voice Append: ${t('Gedanken ergänzen')}`, () => { const file = this.app.workspace.getActiveFile(); if (file?.extension === 'md') this.start(file); else new Notice(t('Bitte zuerst eine Markdown-Notiz öffnen.')); });
    this.registerEditorExtension(footerExtension(file => this.start(file), (el, file) => this.bindProgress(el, file)));
    // Reading view re-renders after postprocessors; keep its footer attached through that lifecycle.
    let refreshTimer = 0;
    const observer = new MutationObserver(() => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => { if (!this.disposed) this.refreshReadingFooters(); }, 60);
    });
    observer.observe(this.app.workspace.containerEl, { childList: true, subtree: true });
    this.register(() => { observer.disconnect(); window.clearTimeout(refreshTimer); });
    this.registerEvent(this.app.workspace.on('layout-change', () => this.refreshReadingFooters()));
    this.registerEvent(this.app.workspace.on('file-open', () => { this.refreshReadingFooters(); this.notify(); }));
    this.registerMarkdownPostProcessor(() => { window.setTimeout(() => { if (!this.disposed) this.refreshReadingFooters(); }, 0); });
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      void this.updatePaths(file, oldPath);
    }));
    this.registerDomEvent(window, 'online', () => { void this.runQueue(); });
    this.registerDomEvent(document, 'visibilitychange', () => { if (!document.hidden) void this.runQueue(); });
    this.app.workspace.onLayoutReady(() => { void this.initializeNotes(); });
    await this.store.expireAudio();
  }
  saveSettings() { return this.saveData(this.settings); }
  /** Adds endpoint defaults to pre-provider configurations without touching secret references. */
  private migrateSettings(saved: unknown): Settings {
    const candidate = saved && typeof saved === 'object' ? saved as Partial<Settings> : {};
    const settings = { ...DEFAULTS, ...candidate };
    for (const key of ['transcriptionBaseUrl', 'cleanupBaseUrl'] as const) {
      try { settings[key] = normalizeBaseUrl(settings[key]); } catch { settings[key] = DEFAULTS[key]; }
    }
    return settings;
  }
  private cacheProgress(job: Job) { this.progressJobs.set(job.id, { id: job.id, state: job.state, targetPath: job.targetPath, createdAt: job.createdAt }); }
  private async saveJob(job: Job) { await this.store.save(job); this.cacheProgress(job); this.notify(); }
  private bindProgress(el: HTMLElement, file: () => TFile | null | undefined): () => void {
    const row = el.ownerDocument.createElement('div'); row.className = 'voice-append-progress';
    row.setAttribute('role', 'status'); row.setAttribute('aria-live', 'polite'); row.setAttribute('aria-atomic', 'true');
    const icon = el.ownerDocument.createElement('span'); icon.setAttribute('aria-hidden', 'true');
    const text = el.ownerDocument.createElement('span');
    const details = el.ownerDocument.createElement('button'); details.className = 'voice-append-progress-details';
    details.type = 'button'; details.textContent = t('Status anzeigen'); details.onclick = () => this.openOutbox();
    row.append(icon, text, details); el.prepend(row);
    let previous = '';
    const render = () => {
      const target = file(); const state = target ? noteProgress(this.progressJobs.values(), target.path) : null;
      const signature = JSON.stringify(state); if (signature === previous) return; previous = signature;
      el.classList.toggle('has-progress', !!state);
      row.hidden = !state;
      if (!state) return;
      icon.className = state.spinning ? 'voice-append-spinner' : 'voice-append-status-icon';
      setIcon(icon, state.spinning ? 'loader-circle' : state.failed ? 'circle-alert' : 'clock');
      text.textContent = t(state.label); row.classList.toggle('is-error', state.failed);
    };
    const unsubscribe = this.subscribe(render); render();
    return () => { unsubscribe(); row.remove(); };
  }
  notify() { this.listeners.forEach(listener => listener()); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  updateAppearance() { this.app.workspace.containerEl.classList.toggle('voice-append-hide-inline-button', !this.settings.showInlineButton); }
  start(file: TFile) {
    if (this.recorder) { new Notice(t('Eine Aufnahme ist bereits geöffnet.')); return; }
    const options = { ...this.settings };
    const snapshot: Promise<{ noteContext?: string; requestTitle: boolean; error?: string }> = options.useNoteContext || options.generateTitle
      ? this.readNote(file).then(markdown => ({ noteContext: options.useNoteContext ? prepareNoteContext(markdown) : undefined, requestTitle: !!options.generateTitle && mainContentIsEmpty(markdown) }), () => ({ requestTitle: false, ...(options.useNoteContext ? { error: t('Kontext konnte nicht gelesen werden. Die Aufnahme bleibt gespeichert.') } : {}) }))
      : Promise.resolve({ requestTitle: false });
    this.recorder = new RecorderModal(this.app, file, options, async job => {
      const context = await snapshot;
      job.noteContext = context.noteContext;
      job.requestTitle = context.requestTitle;
      if (context.error) { job.state = 'failed'; job.error = context.error; }
      await this.saveJob(job); this.targetFiles.set(job.id, file); this.notify(); void this.runQueue();
      this.scrollToProgress(file);
    }, () => { this.recorder = undefined; });
    this.recorder.open();
  }
  private scrollToProgress(file: TFile) {
    const view = this.app.workspace.getLeavesOfType('markdown').map(leaf => leaf.view)
      .find((candidate): candidate is MarkdownView => candidate instanceof MarkdownView && candidate.file === file);
    if (!view) return;
    if (view.getMode() === 'source') {
      const end = view.editor.offsetToPos(view.editor.getValue().length);
      view.editor.scrollIntoView({ from: end, to: end }, true);
    }
    window.requestAnimationFrame(() => {
      const target = view.contentEl.querySelector<HTMLElement>('.voice-append-progress:not([hidden])')
        ?? view.contentEl.querySelector<HTMLElement>('.voice-append-footer');
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
  private async readNoteContext(file: TFile): Promise<string> {
    return prepareNoteContext(await this.readNote(file));
  }
  private async readNote(file: TFile): Promise<string> {
    const view = this.app.workspace.getLeavesOfType('markdown').map(leaf => leaf.view).find((view): view is MarkdownView => view instanceof MarkdownView && view.file === file && view.getMode() === 'source');
    return view ? view.editor.getValue() : this.app.vault.read(file);
  }
  openOutbox() { new Outbox(this.app, this).open(); }
  private async updatePaths(file: TAbstractFile, oldPath: string) {
    for (const job of await this.store.all()) if ((job.targetPath === oldPath || job.targetPath.startsWith(oldPath + '/')) && job.state !== 'completed') {
      job.targetPath = file.path + job.targetPath.slice(oldPath.length);
      const target = this.app.vault.getAbstractFileByPath(job.targetPath); if (target instanceof TFile) this.targetFiles.set(job.id, target);
      this.cacheProgress(job);
      if (job.id !== this.activeId) await this.saveJob(job);
    }
    this.notify();
  }
  async runQueue(retryId?: string) {
    if (!this.notesReady || this.running || this.disposed || !navigator.onLine) return;
    this.running = true;
    try {
      const jobs = (await this.store.all()).sort((a, b) => a.createdAt - b.createdAt);
      for (const job of jobs) {
        if (this.disposed) break;
        if (job.state === 'completed' || (job.state === 'failed' && job.id !== retryId)) continue;
        if (job.audio && job.audio.size > 24 * 1024 * 1024) continue;
        this.activeId = job.id;
        try {
          if (job.options.useNoteContext && job.noteContext === undefined && job.cleaned === undefined) {
            const file = this.targetFiles.get(job.id) ?? this.app.vault.getAbstractFileByPath(job.targetPath);
            if (!(file instanceof TFile)) throw new Error(t('Zielnotiz nicht gefunden. Bitte öffnen und die Aufnahme über den Status neu zuordnen.'));
            job.noteContext = await this.readNoteContext(file); await this.saveJob(job);
          }
          await processJob(job, { transcriber: this.provider, cleaner: this.provider, save: async current => {
            const file = this.targetFiles.get(current.id); if (file) current.targetPath = file.path;
            await this.saveJob(current); this.notify();
          }, append: current => this.append(current) });
          new Notice(t('Gedanken an „{path}“ angehängt.', { path: job.targetPath.replace(/\.md$/, '') }));
        } catch (error) {
          if (job.state !== 'failed') { job.state = 'failed'; job.error = error instanceof Error ? error.message : t('Verarbeitung fehlgeschlagen.'); await this.saveJob(job); }
          new Notice(t('Voice Append: Aufnahme bleibt gespeichert. Details unter „Aufnahmen und Status“.'));
        }
      }
    } finally {
      this.activeId = undefined; this.running = false; this.notify();
      if (!this.disposed && navigator.onLine && (await this.store.all()).some(job => job.state === 'queued')) void this.runQueue();
    }
  }
  private async append(job: Job) {
    if (this.disposed) throw new Error(t('Plugin wurde beendet. Bitte erneut versuchen.'));
    const file = this.targetFiles.get(job.id) ?? this.app.vault.getAbstractFileByPath(job.targetPath);
    if (!(file instanceof TFile) || file.extension !== 'md' || this.app.vault.getAbstractFileByPath(file.path) !== file) throw new Error(t('Zielnotiz nicht gefunden. Bitte öffnen und die Aufnahme über den Status neu zuordnen.'));
    if (job.targetCreatedAt !== undefined && job.targetCreatedAt !== file.stat.ctime) throw new Error(t('Die Zieldatei wurde möglicherweise ersetzt. Bitte die gewünschte Notiz öffnen und die Aufnahme neu zuordnen.'));
    const openEditor = () => this.app.workspace.getLeavesOfType('markdown').map(leaf => leaf.view).find((view): view is MarkdownView => view instanceof MarkdownView && view.file === file && view.getMode() === 'source')?.editor;
    const initial = openEditor()?.getValue() ?? await this.app.vault.read(file);
    const recovering = !!job.appendPlan;
    if (!job.appendPlan) { job.appendPlan = await createAppendPlan(initial, job); await this.saveJob(job); }
    for (let attempt = 0; attempt < 4; attempt++) {
      if (this.disposed) throw new Error(t('Plugin wurde beendet. Bitte erneut versuchen.'));
      const editor = openEditor();
      const before = editor?.getValue() ?? await this.app.vault.read(file);
      const state = await inspectAppend(before, job.appendPlan);
      if (state === 'conflict' && !recovering) {
        // No write has happened in this invocation yet; incorporate intervening manual edits.
        job.appendPlan = await createAppendPlan(before, job); await this.saveJob(job); continue;
      }
      const after = await applyAppendPlan(before, job.appendPlan);
      if (editor) {
        if (editor !== openEditor() || editor.getValue() !== before) continue;
        if (after !== before) editor.replaceRange(after.slice(before.length), editor.offsetToPos(before.length));
        for (let check = 0; check < 50; check++) {
          if (await inspectAppend(await this.app.vault.read(file), job.appendPlan) === 'applied') return;
          await new Promise(resolve => window.setTimeout(resolve, 100));
        }
        throw new Error(t('Text ist im Editor eingefügt, Speicherung noch nicht bestätigt. Erneut versuchen fügt ihn nicht doppelt ein.'));
      }
      let changed = false;
      await this.app.vault.process(file, current => {
        if (current !== before) { changed = true; return current; }
        return after;
      });
      if (!changed) return;
    }
    throw new Error(t('Die Notiz wird gerade geändert. Bitte die Ergänzung erneut versuchen.'));
  }
  private async initializeNotes() {
    if (!this.settings.legacyCommentsRemoved) {
      // Remove only this plugin's old, exact UUID comment lines. All other Markdown is preserved.
      for (const file of this.app.vault.getMarkdownFiles()) {
        const view = this.app.workspace.getLeavesOfType('markdown').map(leaf => leaf.view).find((view): view is MarkdownView => view instanceof MarkdownView && view.file === file && view.getMode() === 'source');
        if (view) {
          const current = view.editor.getValue();
          const matches = [...current.matchAll(/^<!-- voice-append: [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12} -->[ \t]*(?:\r?\n|$)/gmi)];
          if (matches.length) view.editor.transaction({ changes: matches.map(match => ({ from: view.editor.offsetToPos(match.index), to: view.editor.offsetToPos(match.index + match[0].length), text: '' })) });
        } else {
          const current = await this.app.vault.read(file);
          if (removeLegacyComments(current) !== current) await this.app.vault.process(file, removeLegacyComments);
        }
      }
      this.settings.legacyCommentsRemoved = true; await this.saveSettings();
    }
    this.notesReady = true;
    this.refreshReadingFooters(); await this.runQueue();
  }
  async reassign(job: Job) {
    if (this.running) { new Notice(t('Bitte die laufende Verarbeitung abwarten.')); return; }
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== 'md') { new Notice(t('Bitte zuerst die gewünschte Zielnotiz öffnen.')); return; }
    if (job.targetPath !== file.path) delete job.appendPlan;
    job.targetPath = file.path; job.targetCreatedAt = file.stat.ctime; this.targetFiles.set(job.id, file); await this.saveJob(job); this.notify(); await this.runQueue(job.id);
  }
  removeRecording(job: Job) {
    if (this.running || !['completed', 'failed', 'queued'].includes(job.state)) { new Notice(t('Bitte die laufende Verarbeitung abwarten.')); return; }
    const modal = new Modal(this.app); modal.setTitle(t('Aufnahme löschen?'));
    modal.contentEl.createEl('p', { text: t('Audio und Verarbeitungsergebnisse dieser Aufnahme werden aus dem lokalen Speicher gelöscht. Bereits angehängter Notiztext bleibt erhalten.') });
    const cancel = modal.contentEl.createEl('button', { text: t('Abbrechen') }); cancel.onclick = () => modal.close();
    const confirm = modal.contentEl.createEl('button', { text: t('Aufnahme löschen'), cls: 'mod-warning' });
    confirm.onclick = async () => { if (this.running) { new Notice(t('Bitte die laufende Verarbeitung abwarten.')); return; } await this.store.remove(job.id); this.targetFiles.delete(job.id); this.progressJobs.delete(job.id); modal.close(); this.notify(); };
    modal.open();
  }
  private refreshReadingFooters() {
    const views = this.app.workspace.getLeavesOfType('markdown').map(leaf => leaf.view).filter((view): view is MarkdownView => view instanceof MarkdownView && view.getMode() === 'preview');
    for (const [view, item] of this.readingFooters) if (!views.includes(view) || !item.host.isConnected) { item.dispose(); item.el.remove(); this.readingFooters.delete(view); }
    for (const view of views) {
      const host = view.contentEl.querySelector<HTMLElement>('.markdown-preview-sizer');
      if (!host) continue;
      const existing = this.readingFooters.get(view);
      if (existing?.host === host && existing.el.isConnected) { if (host.lastElementChild !== existing.el) host.append(existing.el); continue; }
      existing?.dispose(); existing?.el.remove();
      const el = voiceButton(host.ownerDocument, () => { if (view.file) this.start(view.file); });
      const dispose = this.bindProgress(el, () => view.file);
      host.append(el); this.readingFooters.set(view, { host, el, dispose });
    }
  }
  onunload() { this.disposed = true; this.app.workspace.containerEl.classList.remove('voice-append-hide-inline-button'); this.recorder?.close(); this.readingFooters.forEach(item => { item.dispose(); item.el.remove(); }); this.listeners.clear(); /* In-flight requests retain the DB to persist recoverable results. */ }
}
class VoiceSettings extends PluginSettingTab {
  constructor(app: App, private plugin: VoiceAppend) { super(app, plugin); }
  display() {
    const el = this.containerEl; el.empty();
    el.createEl('p', { text: t('Neue Aufnahmen und ihre Transkripte werden direkt an OpenAI übertragen. Notizkontext wird nur übertragen, wenn du ihn unten aktivierst.') });
    let keyValue = this.plugin.apiKey.get();
    new Setting(el).setName(t('OpenAI-Schlüssel')).setDesc(t('Ein OpenAI-API-Schlüssel für Transkription und Bereinigung. Auf jedem Gerät einmal lokal speichern; Obsidian Sync überträgt den Schlüssel nicht.'))
      .addText(text => {
        text.inputEl.type = 'password'; text.inputEl.autocomplete = 'off'; text.inputEl.spellcheck = false;
        text.setPlaceholder(t('OpenAI-Schlüssel')).setValue(keyValue).onChange(value => { keyValue = value; });
      })
      .addButton(button => button.setButtonText(t('Speichern')).onClick(async () => {
        try {
          this.plugin.apiKey.set(keyValue); delete this.plugin.settings.secretId; await this.plugin.saveSettings();
          new Notice(t('API-Schlüssel gespeichert.'));
        } catch { new Notice(t('API-Schlüssel konnte nicht gespeichert werden.')); }
      }));
    const endpointDescription = t('Vollständige OpenAI-kompatible API-Basis, z. B. https://api.openai.com/v1. API-Schlüssel gehören nicht in diese URL.');
    for (const [key, name] of [['transcriptionBaseUrl', t('Transkriptions-Basis-URL')], ['cleanupBaseUrl', t('Bereinigungs-Basis-URL')]] as const) {
      new Setting(el).setName(name).setDesc(endpointDescription).addText(text => text.setValue(this.plugin.settings[key] ?? OPENAI_BASE_URL).onChange(async value => {
        try { this.plugin.settings[key] = normalizeBaseUrl(value); await this.plugin.saveSettings(); }
        catch { new Notice(t('Ungültige API-Basis-URL.')); text.setValue(this.plugin.settings[key] ?? OPENAI_BASE_URL); }
      }));
    }
    for (const [key, name] of [['transcriptionModel', t('Transkriptionsmodell')], ['cleanupModel', t('Bereinigungsmodell')]] as const) {
      new Setting(el).setName(name).addText(text => text.setValue(this.plugin.settings[key]).onChange(async value => { this.plugin.settings[key] = value.trim() || DEFAULTS[key]; await this.plugin.saveSettings(); }));
    }
    new Setting(el).setName(t('Bereinigungs-Prompt')).setDesc(t('Gilt für neue Aufnahmen. Bereits gespeicherte Aufnahmen behalten ihren ursprünglichen Prompt.')).addTextArea(text => { text.inputEl.rows = 9; text.inputEl.addClass('voice-append-prompt'); text.setValue(this.plugin.settings.prompt).onChange(async value => { this.plugin.settings.prompt = value || DEFAULT_PROMPT; await this.plugin.saveSettings(); }); });
    new Setting(el).setName(t('Standard-Prompt wiederherstellen')).addButton(button => button.setButtonText(t('Zurücksetzen')).onClick(async () => { this.plugin.settings.prompt = DEFAULT_PROMPT; await this.plugin.saveSettings(); this.display(); }));
    new Setting(el).setName(t('Aufnahme-Button in Notizen anzeigen')).setDesc(t('Der Aufnahmebefehl bleibt über Befehlspalette, Ribbon und mobile Werkzeugleiste verfügbar.')).addToggle(toggle => toggle.setValue(this.plugin.settings.showInlineButton).onChange(async value => { this.plugin.settings.showInlineButton = value; this.plugin.updateAppearance(); await this.plugin.saveSettings(); }));
    new Setting(el).setName(t('Titel für leere Notizen erzeugen')).setDesc(t('Erzeugt beim Bereinigen eine H1-Überschrift, wenn die Notiz außer Frontmatter noch keinen Inhalt hat. Der Dateiname bleibt unverändert.')).addToggle(toggle => toggle.setValue(this.plugin.settings.generateTitle ?? false).onChange(async value => { this.plugin.settings.generateTitle = value; await this.plugin.saveSettings(); }));
    new Setting(el).setName(t('Originaltranskript anhängen')).setDesc(t('Standardmäßig aus. Bei Aktivierung als eingeklappter Abschnitt unter der Ergänzung.')).addToggle(toggle => toggle.setValue(this.plugin.settings.keepTranscript).onChange(async value => { this.plugin.settings.keepTranscript = value; await this.plugin.saveSettings(); }));
    new Setting(el).setName(t('Datierte Überschrift')).addToggle(toggle => toggle.setValue(this.plugin.settings.datedHeading).onChange(async value => { this.plugin.settings.datedHeading = value; await this.plugin.saveSettings(); }));
    new Setting(el).setName(t('Notizkontext beim Bereinigen verwenden')).setDesc(t('Optional. Sendet bis zu 16.000 Zeichen der aktuellen Notiz an OpenAI. Hilft bei Bezügen und Begriffen; bestehender Text wird nicht umgeschrieben.')).addToggle(toggle => toggle.setValue(this.plugin.settings.useNoteContext ?? false).onChange(async value => { this.plugin.settings.useNoteContext = value; await this.plugin.saveSettings(); }));
    new Setting(el).setName(t('Bekannte Namen und Konzepte')).setDesc(t('Optional. Namen, Fachbegriffe und bevorzugte Schreibweisen, etwa „Obsidian; Walter Forkel; Fractals“. Wird für Transkription und Bereinigung verwendet. Maximal 2.000 Zeichen.')).addTextArea(text => {
      text.inputEl.rows = 4; text.inputEl.maxLength = MAX_VOCABULARY_CHARS;
      text.setValue(this.plugin.settings.vocabulary ?? '').onChange(async value => { this.plugin.settings.vocabulary = value.slice(0, MAX_VOCABULARY_CHARS); await this.plugin.saveSettings(); });
    });
    new Setting(el).setName(t('Gespeicherte Aufnahmen')).setDesc(t('Lokal auf diesem Gerät. Erfolgreiche Audiodateien bleiben sieben Tage erhalten. Offene Aufnahmen werden nicht automatisch gelöscht.')).addButton(button => button.setButtonText(t('Aufnahmen und Status')).onClick(() => this.plugin.openOutbox()));
    el.createEl('p', { text: t('Erste Entwicklungsversion: Aufnahmen bei geöffneter App. Displaysperre oder ein vom System beendeter Prozess können die laufende, noch nicht gespeicherte Aufnahme unterbrechen.'), cls: 'voice-append-hint' });
  }
}
class Outbox extends Modal {
  private unsubscribe?: () => void;
  private urls: string[] = [];
  private renderVersion = 0;
  constructor(app: App, private plugin: VoiceAppend) { super(app); }
  onOpen() { this.setTitle(t('Aufnahmen und Status')); this.unsubscribe = this.plugin.subscribe(() => { void this.render(); }); void this.render(); }
  private async render() {
    const version = ++this.renderVersion; const jobs = await this.plugin.store.all();
    if (version !== this.renderVersion) return;
    this.urls.forEach(url => URL.revokeObjectURL(url)); this.urls = []; this.contentEl.empty();
    if (!jobs.length) this.contentEl.createEl('p', { text: t('Noch keine Aufnahmen. Öffne eine Notiz und tippe am Ende auf das Mikrofon.') });
    for (const job of jobs.sort((a, b) => b.createdAt - a.createdAt)) {
      const card = this.contentEl.createDiv({ cls: 'voice-append-job' });
      card.createEl('strong', { text: job.targetPath }); card.createEl('p', { text: `${t(LABELS[job.state])} · ${new Date(job.createdAt).toLocaleString(getLocale())}` });
      if (job.error) card.createEl('p', { text: job.error, cls: 'voice-append-error' });
      if (job.audio) { const url = URL.createObjectURL(job.audio); this.urls.push(url); card.createEl('audio', { attr: { controls: '', src: url } }); card.createEl('a', { text: t('Audio herunterladen'), attr: { href: url, download: `voice-${job.id}.${job.mime.includes('mp4') ? 'm4a' : 'webm'}` } }); }
      if (job.raw) { const details = card.createEl('details'); details.createEl('summary', { text: t('Transkript anzeigen') }); details.createEl('p', { text: job.raw }); }
      if (job.state === 'failed' || job.state === 'queued') {
        const retry = card.createEl('button', { text: t('Erneut versuchen') }); retry.onclick = () => { void this.plugin.runQueue(job.id); };
        const assign = card.createEl('button', { text: t('An geöffnete Notiz anhängen') }); assign.onclick = () => { void this.plugin.reassign(job); };
      }
      if (['completed', 'failed', 'queued'].includes(job.state)) { const remove = card.createEl('button', { text: t('Aufnahme löschen') }); remove.onclick = () => this.plugin.removeRecording(job); }
    }
  }
  onClose() { this.renderVersion++; this.unsubscribe?.(); this.urls.forEach(url => URL.revokeObjectURL(url)); }
}
