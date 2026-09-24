import { t, setLanguage, getLocale, type Message } from './i18n';
import { MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, requestUrl, getLanguage, normalizePath, setIcon, type TAbstractFile, type App, type SettingDefinition, type SettingDefinitionItem } from 'obsidian';
import { DEFAULT_PROMPT, DEFAULT_TITLE_PROMPT, processJob, type Job } from './core';
import { footerExtension, voiceButton } from './editor';
import { OPENAI_BASE_URL, OpenAIProvider, normalizeBaseUrl } from './provider';
import { RecorderModal } from './recorder';
import { JobStore, type JobSummary } from './store';
import { ApiKey, DeviceSecret } from './api-key';
import { createAppendPlan, inspectAppend, applyAppendPlan } from './append-journal';
import { noteProgress, type ProgressJob } from './progress';
import { prepareNoteContext, mainContentIsEmpty, MAX_VOCABULARY_CHARS } from './context';
import { availableBasename, titledBasename } from './title';
import { applyPreset, DEFAULTS, migrateSettings, snapshotOptions, type ProviderPreset, type Settings } from './settings';
import { runConfigurationTest, type ConfigurationTestResult } from './config-test';
import configurationTestAudio from './assets/configuration-test.wav';
declare const VOICE_APPEND_LAB: boolean;
const LABELS: Record<Job['state'], Message> = { queued: 'Wartet auf Verarbeitung', transcribing: 'Wird transkribiert', cleaning: 'Wird bereinigt', appending: 'Wird angehängt', completed: 'Angehängt', failed: 'Benötigt Aufmerksamkeit' };
export default class VoiceAppend extends Plugin {
  settings!: Settings;
  store!: JobStore;
  apiKey!: ApiKey;
  transcriptionApiKey!: DeviceSecret;
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
    this.settings = migrateSettings(saved);
    const savedSettings = saved && typeof saved === 'object' ? saved as Partial<Settings> : {};
    // Persist endpoint defaults once, so subsequent launches and new job snapshots
    // use the same explicit configuration. Secret references remain untouched.
    if (!('transcriptionBaseUrl' in savedSettings) || !('cleanupBaseUrl' in savedSettings) || savedSettings.settingsVersion !== this.settings.settingsVersion) await this.saveSettings();
    this.updateAppearance();
    if (!this.settings.vaultId) { this.settings.vaultId = crypto.randomUUID(); await this.saveSettings(); }
    this.apiKey = new ApiKey(this.app.secretStorage, this.settings.vaultId, this.settings.secretId);
    this.transcriptionApiKey = new DeviceSecret(this.app.secretStorage, 'voice-append-transcription-api-key');
    this.store = await JobStore.open(this.settings.vaultId);
    for (const job of await this.store.list()) { this.cacheProgress(job); const file = this.app.vault.getAbstractFileByPath(job.targetPath); if (file instanceof TFile) this.targetFiles.set(job.id, file); }
    this.provider = new OpenAIProvider(() => this.apiKey.get(), request => requestUrl(request), () => this.transcriptionApiKey.get());
    this.addSettingTab(new VoiceSettings(this.app, this));
    this.addCommand({ id: 'record', name: t('Gedanken ergänzen'), icon: 'mic', checkCallback: checking => { const file = this.app.workspace.getActiveFile(); if (!file || file.extension !== 'md') return false; if (!checking) this.start(file); return true; } });
    this.addCommand({ id: 'outbox', name: t('Aufnahmen und Status öffnen'), callback: () => this.openOutbox() });
    if (VOICE_APPEND_LAB) this.addCommand({ id: 'lab-test', name: t('Lab: Test-Ergänzung ohne Mikrofon und API'), callback: async () => {
      const file = this.app.workspace.getActiveFile(); if (!file || file.extension !== 'md') return;
      const job: Job = { id: crypto.randomUUID(), targetPath: file.path, createdAt: Date.now(), audio: null, mime: '', duration: 0, options: snapshotOptions(this.settings), state: 'queued', raw: 'So, I want to append my thoughts directly to this note, even if I switch notes in between.', cleaned: 'I want to append my thoughts directly to this note, even if I switch notes in between.' };
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
  private cacheProgress(job: Pick<Job, 'id' | 'state' | 'targetPath' | 'createdAt'>) { this.progressJobs.set(job.id, { id: job.id, state: job.state, targetPath: job.targetPath, createdAt: job.createdAt }); }
  private async saveJob(job: Job) { await this.store.save(job); this.cacheProgress(job); this.notify(); }
  private bindProgress(el: HTMLElement, file: () => TFile | null | undefined): () => void {
    const content = el.querySelector<HTMLElement>('.voice-append-footer-content') ?? el;
    const row = el.ownerDocument.win.createDiv({ cls: 'voice-append-progress' });
    row.setAttribute('role', 'status'); row.setAttribute('aria-live', 'polite'); row.setAttribute('aria-atomic', 'true');
    const icon = el.ownerDocument.win.createSpan(); icon.setAttribute('aria-hidden', 'true');
    const text = el.ownerDocument.win.createSpan();
    const details = el.ownerDocument.win.createEl('button', { cls: 'voice-append-progress-details' });
    details.type = 'button'; details.title = t('Status anzeigen'); details.onclick = () => this.openOutbox();
    const chevron = el.ownerDocument.win.createSpan({ cls: 'voice-append-progress-chevron' }); chevron.setAttribute('aria-hidden', 'true'); setIcon(chevron, 'chevron-right');
    details.append(icon, text, chevron); row.append(details); content.prepend(row);
    let previous = '';
    const render = () => {
      const target = file(); const state = target ? noteProgress(this.progressJobs.values(), target.path) : null;
      const signature = JSON.stringify(state); if (signature === previous) return; previous = signature;
      el.classList.toggle('has-progress', !!state);
      row.hidden = !state;
      if (!state) return;
      icon.className = state.spinning ? 'voice-append-spinner' : 'voice-append-status-icon';
      setIcon(icon, state.spinning ? 'loader-circle' : state.failed ? 'circle-alert' : 'clock');
      text.textContent = t(state.label); details.setAttribute('aria-label', `${t(state.label)}. ${t('Status anzeigen')}`); row.classList.toggle('is-error', state.failed);
    };
    const unsubscribe = this.subscribe(render); render();
    return () => { unsubscribe(); row.remove(); };
  }
  notify() { this.listeners.forEach(listener => listener()); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  updateAppearance() { this.app.workspace.containerEl.classList.toggle('voice-append-hide-inline-button', !this.settings.showInlineButton); }
  start(file: TFile) {
    if (this.recorder) { new Notice(t('Eine Aufnahme ist bereits geöffnet.')); return; }
    const options = snapshotOptions(this.settings);
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
  openConfigurationTest() { new ConfigurationTestModal(this.app, this).open(); }
  runConfigurationTest(onStage: (stage: 'transcription' | 'cleanup') => void) {
    const bytes = Uint8Array.from(atob(configurationTestAudio), character => character.charCodeAt(0));
    return runConfigurationTest(new Blob([bytes], { type: 'audio/wav' }), snapshotOptions(this.settings), { transcriber: this.provider, cleaner: this.provider }, onStage);
  }
  private async updatePaths(file: TAbstractFile, oldPath: string) {
    for (const item of await this.store.list()) if ((item.targetPath === oldPath || item.targetPath.startsWith(oldPath + '/')) && item.state !== 'completed') {
      const job = await this.store.get(item.id); if (!job) continue;
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
      const jobs = (await this.store.list()).sort((a, b) => a.createdAt - b.createdAt);
      for (const item of jobs) {
        if (this.disposed) break;
        if (item.state === 'completed' || (item.state === 'failed' && item.id !== retryId)) continue;
        const job = await this.store.get(item.id); if (!job) continue;
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
        } catch (error) {
          if (job.state !== 'failed') { job.state = 'failed'; job.error = error instanceof Error ? error.message : t('Verarbeitung fehlgeschlagen.'); await this.saveJob(job); }
          new Notice(t('Voice Append: Aufnahme bleibt gespeichert. Details unter „Aufnahmen und Status“.'));
        }
      }
    } finally {
      this.activeId = undefined; this.running = false; this.notify();
      if (!this.disposed && navigator.onLine && (await this.store.list()).some(job => job.state === 'queued')) void this.runQueue();
    }
  }
  private async append(job: Job) {
    if (this.disposed) throw new Error(t('Plugin wurde beendet. Bitte erneut versuchen.'));
    let file = this.targetFiles.get(job.id) ?? this.app.vault.getAbstractFileByPath(job.targetPath);
    if (!(file instanceof TFile) && job.titleRenamePlan) file = this.app.vault.getAbstractFileByPath(job.titleRenamePlan.targetPath);
    if (!(file instanceof TFile) || file.extension !== 'md' || this.app.vault.getAbstractFileByPath(file.path) !== file) throw new Error(t('Zielnotiz nicht gefunden. Bitte öffnen und die Aufnahme über den Status neu zuordnen.'));
    this.targetFiles.set(job.id, file);
    if (job.targetCreatedAt !== undefined && job.targetCreatedAt !== file.stat.ctime) throw new Error(t('Die Zieldatei wurde möglicherweise ersetzt. Bitte die gewünschte Notiz öffnen und die Aufnahme neu zuordnen.'));
    const openEditor = () => this.app.workspace.getLeavesOfType('markdown').map(leaf => leaf.view).find((view): view is MarkdownView => view instanceof MarkdownView && view.file === file && view.getMode() === 'source')?.editor;
    const initial = openEditor()?.getValue() ?? await this.app.vault.read(file);
    const recovering = !!job.appendPlan;
    if (!job.appendPlan) {
      job.titleRenameEligible = !!job.options.generateTitle && !!job.requestTitle && !!job.generatedTitle && mainContentIsEmpty(initial);
      job.appendPlan = await createAppendPlan(initial, job); await this.saveJob(job);
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      if (this.disposed) throw new Error(t('Plugin wurde beendet. Bitte erneut versuchen.'));
      const editor = openEditor();
      const before = editor?.getValue() ?? await this.app.vault.read(file);
      const state = await inspectAppend(before, job.appendPlan);
      if (state === 'conflict' && !recovering) {
        // No write has happened in this invocation yet; incorporate intervening manual edits.
        job.titleRenameEligible = !!job.options.generateTitle && !!job.requestTitle && !!job.generatedTitle && mainContentIsEmpty(before);
        delete job.titleRenamePlan; delete job.titleRenameDone;
        job.appendPlan = await createAppendPlan(before, job); await this.saveJob(job); continue;
      }
      const after = await applyAppendPlan(before, job.appendPlan);
      if (editor) {
        if (editor !== openEditor() || editor.getValue() !== before) continue;
        if (after !== before) editor.replaceRange(after.slice(before.length), editor.offsetToPos(before.length));
        for (let check = 0; check < 50; check++) {
          if (await inspectAppend(await this.app.vault.read(file), job.appendPlan) === 'applied') { await this.finishTitleRename(job, file); return; }
          await new Promise(resolve => window.setTimeout(resolve, 100));
        }
        throw new Error(t('Text ist im Editor eingefügt, Speicherung noch nicht bestätigt. Erneut versuchen fügt ihn nicht doppelt ein.'));
      }
      let changed = false;
      await this.app.vault.process(file, current => {
        if (current !== before) { changed = true; return current; }
        return after;
      });
      if (!changed) { await this.finishTitleRename(job, file); return; }
    }
    throw new Error(t('Die Notiz wird gerade geändert. Bitte die Ergänzung erneut versuchen.'));
  }
  private async finishTitleRename(job: Job, file: TFile) {
    if (!job.titleRenameEligible || job.titleRenameDone) return;
    if (!job.titleRenamePlan) {
      const candidate = titledBasename(file.basename, job.generatedTitle, job.options.titleFilenameMode ?? 'append');
      if (!candidate || candidate === file.basename) { job.titleRenameDone = true; await this.saveJob(job); return; }
      const siblings: string[] = [];
      for (const child of file.parent?.children ?? []) if (child instanceof TFile && child.extension === 'md') siblings.push(String(child.basename));
      const basename = availableBasename(candidate, siblings, file.basename);
      if (!basename) throw new Error(t('Für den erzeugten Titel konnte kein freier Dateiname gefunden werden.'));
      const folder = file.parent?.path;
      job.titleRenamePlan = {
        sourcePath: file.path,
        targetPath: normalizePath(`${folder && folder !== '/' ? `${folder}/` : ''}${basename}.md`),
        sourceCreatedAt: file.stat.ctime,
      };
      await this.saveJob(job);
    }
    const plan = job.titleRenamePlan;
    if (file.path === plan.targetPath) {
      job.targetPath = file.path; job.targetCreatedAt = file.stat.ctime; job.titleRenameDone = true;
      this.targetFiles.set(job.id, file); await this.saveJob(job); return;
    }
    if (file.path !== plan.sourcePath) {
      // Respect a manual rename that happened after the append was planned.
      job.targetPath = file.path; job.targetCreatedAt = file.stat.ctime; job.titleRenameDone = true; delete job.titleRenamePlan;
      await this.saveJob(job); return;
    }
    let targetPath = plan.targetPath;
    const existing = this.app.vault.getAbstractFileByPath(targetPath);
    if (existing && existing !== file) {
      const siblings: string[] = [];
      for (const child of file.parent?.children ?? []) if (child instanceof TFile && child.extension === 'md') siblings.push(String(child.basename));
      const candidate = titledBasename(file.basename, job.generatedTitle, job.options.titleFilenameMode ?? 'append');
      const basename = availableBasename(candidate, siblings, file.basename);
      if (!basename) throw new Error(t('Für den erzeugten Titel konnte kein freier Dateiname gefunden werden.'));
      const folder = file.parent?.path;
      targetPath = normalizePath(`${folder && folder !== '/' ? `${folder}/` : ''}${basename}.md`);
      job.titleRenamePlan.targetPath = targetPath; await this.saveJob(job);
    }
    await this.app.fileManager.renameFile(file, targetPath);
    job.targetPath = file.path; job.targetCreatedAt = file.stat.ctime; job.titleRenameDone = true;
    this.targetFiles.set(job.id, file); await this.saveJob(job);
  }
  private async initializeNotes() {
    this.notesReady = true;
    this.refreshReadingFooters(); await this.runQueue();
  }
  async reassign(job: Job) {
    if (this.running) { new Notice(t('Bitte die laufende Verarbeitung abwarten.')); return; }
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== 'md') { new Notice(t('Bitte zuerst die gewünschte Zielnotiz öffnen.')); return; }
    if (job.targetPath !== file.path) {
      delete job.appendPlan; delete job.titleRenameEligible; delete job.titleRenamePlan; delete job.titleRenameDone;
    }
    job.targetPath = file.path; job.targetCreatedAt = file.stat.ctime; this.targetFiles.set(job.id, file); await this.saveJob(job); this.notify(); await this.runQueue(job.id);
  }
  removeRecording(job: Pick<Job, 'id' | 'state'>) {
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
  onunload() { this.disposed = true; this.app.workspace.containerEl.classList.remove('voice-append-hide-inline-button'); this.recorder?.close(); this.readingFooters.forEach(item => { item.dispose(); item.el.remove(); }); this.listeners.clear(); if (!this.running) this.store?.close(); /* In-flight requests retain the DB to persist recoverable results. */ }
}
class ConfigurationTestModal extends Modal {
  private runId = 0;
  constructor(app: App, private plugin: VoiceAppend) { super(app); }
  onOpen() { this.setTitle(t('Konfiguration testen')); this.render(); void this.run(); }
  onClose() { this.runId++; }
  private render(stage?: 'transcription' | 'cleanup', result?: ConfigurationTestResult, error?: string) {
    const el = this.contentEl; el.empty();
    el.createEl('p', { text: t('Eine kurze mitgelieferte Testaufnahme wird an den Transkriptions-Provider und anschließend an den LLM-Provider gesendet. Es können geringe Providerkosten entstehen.') });
    if (stage) {
      const status = el.createDiv({ cls: 'voice-append-test-status' }); const icon = status.createSpan({ cls: 'voice-append-spinner' }); setIcon(icon, 'loader-circle');
      status.createSpan({ text: stage === 'transcription' ? t('Transkription wird getestet …') : t('Bereinigung wird getestet …') });
    }
    if (result) {
      el.createEl('p', { text: t('Konfiguration funktioniert.'), cls: 'voice-append-test-success' });
      const raw = el.createEl('details'); raw.createEl('summary', { text: t('Testtranskript anzeigen') }); raw.createEl('p', { text: result.transcript });
      const cleaned = el.createEl('details'); cleaned.createEl('summary', { text: t('Bereinigtes Testergebnis anzeigen') }); cleaned.createEl('p', { text: result.cleaned });
    }
    if (error) el.createEl('p', { text: error, cls: 'voice-append-error' });
    const controls = el.createDiv({ cls: 'voice-append-controls' });
    if (!stage) controls.createEl('button', { text: error ? t('Erneut versuchen') : t('Noch einmal testen'), cls: 'mod-cta' }).onclick = () => { void this.run(); };
    controls.createEl('button', { text: t('Schließen') }).onclick = () => this.close();
  }
  private async run() {
    const id = ++this.runId;
    try {
      const result = await this.plugin.runConfigurationTest(stage => { if (id === this.runId) this.render(stage); });
      if (id === this.runId) this.render(undefined, result);
    } catch (error) {
      if (id === this.runId) this.render(undefined, undefined, error instanceof Error ? error.message : t('Konfigurationstest fehlgeschlagen.'));
    }
  }
}
type VoiceSettingSpec = { name: string; desc: string; visible?: () => boolean; render?: (setting: Setting) => void };
type VoiceSettingGroupSpec = { heading: string; items: VoiceSettingSpec[] };
class VoiceSettings extends PluginSettingTab {
  constructor(app: App, private plugin: VoiceAppend) { super(app, plugin); }
  getSettingDefinitions(): SettingDefinitionItem[] {
    return this.groups().map(group => ({
      type: 'group', heading: group.heading,
      items: group.items.filter(item => !item.visible || item.visible()).map(item => (item.render
        ? { name: item.name, desc: item.desc, render: item.render }
        : { name: item.name, desc: item.desc }) as SettingDefinition),
    }));
  }
  display() { this.renderFallback(); }
  private refreshSettings() {
    const update = (this as unknown as { update?: () => void }).update;
    if (typeof update === 'function') update.call(this); else this.renderFallback();
  }
  private renderFallback() {
    const el = this.containerEl; el.empty();
    for (const group of this.groups()) {
      new Setting(el).setName(group.heading).setHeading();
      for (const item of group.items) {
        if (item.visible && !item.visible()) continue;
        const setting = new Setting(el).setName(item.name).setDesc(item.desc); item.render?.(setting);
      }
    }
  }
  private groups(): VoiceSettingGroupSpec[] {
    let keyValue = this.plugin.apiKey.get();
    let transcriptionKey = this.plugin.transcriptionApiKey.get();
    const saveMainKey = async () => {
      try {
        this.plugin.apiKey.set(keyValue); delete this.plugin.settings.secretId; await this.plugin.saveSettings();
        new Notice(t('API-Schlüssel gespeichert.')); return true;
      } catch { new Notice(t('API-Schlüssel konnte nicht gespeichert werden.')); return false; }
    };
    const endpointDescription = t('Vollständige OpenAI-kompatible API-Basis, z. B. https://api.openai.com/v1. API-Schlüssel gehören nicht in diese URL.');
    const endpoint = (key: 'transcriptionBaseUrl' | 'cleanupBaseUrl', name: string, visible: () => boolean): VoiceSettingSpec => ({
      name, desc: endpointDescription, visible,
      render: setting => { setting.addText(text => text.setValue(this.plugin.settings[key] ?? OPENAI_BASE_URL).onChange(async value => {
        try {
          const normalized = normalizeBaseUrl(value); this.plugin.settings[key] = normalized;
          if (!this.plugin.settings.useSeparateProviders) this.plugin.settings.transcriptionBaseUrl = this.plugin.settings.cleanupBaseUrl = normalized;
          this.plugin.settings.providerPreset = 'custom'; await this.plugin.saveSettings();
        } catch { new Notice(t('Ungültige API-Basis-URL.')); text.setValue(this.plugin.settings[key] ?? OPENAI_BASE_URL); }
      })); },
    });
    const providerItems: VoiceSettingSpec[] = [
      { name: t('Datenverarbeitung'), desc: t('Neue Aufnahmen werden direkt an die konfigurierten Transkriptions- und LLM-Provider übertragen. Notizkontext wird nur übertragen, wenn du ihn unten aktivierst.') },
      { name: t('Provider-Voreinstellung'), desc: t('Setzt passende Endpoints und Standardmodelle. Custom behält manuell konfigurierte Werte bei.'), render: setting => { setting.addDropdown(dropdown => dropdown
        .addOption('openai', 'OpenAI').addOption('openrouter', t('OpenRouter')).addOption('custom', t('Benutzerdefiniert'))
        .setValue(this.plugin.settings.providerPreset).onChange(async value => { applyPreset(this.plugin.settings, value as ProviderPreset); await this.plugin.saveSettings(); this.refreshSettings(); })); } },
      { name: t('LLM-Provider-API-Schlüssel'), desc: t('Wird für den LLM-Provider und standardmäßig auch für den Transkriptions-Provider verwendet. Auf jedem Gerät einmal lokal speichern; Obsidian Sync überträgt ihn nicht.'), render: setting => { setting.addText(text => {
        text.inputEl.type = 'password'; text.inputEl.autocomplete = 'off'; text.inputEl.spellcheck = false;
        text.setPlaceholder(t('LLM-Provider-API-Schlüssel')).setValue(keyValue).onChange(value => { keyValue = value; });
      }).addButton(button => button.setButtonText(t('Speichern')).onClick(saveMainKey)); } },
      { name: t('Transkriptionsmodell'), desc: t('Modellname beim Transkriptions-Provider. Gilt für neue Aufnahmen.'), render: setting => { setting.addText(text => text.setValue(this.plugin.settings.transcriptionModel).onChange(async value => { this.plugin.settings.transcriptionModel = value.trim() || DEFAULTS.transcriptionModel; await this.plugin.saveSettings(); })); } },
      { name: t('LLM-Modell'), desc: t('Modellname beim LLM-Provider für Bereinigung und optionale Titel. Gilt für neue Aufnahmen.'), render: setting => { setting.addText(text => text.setValue(this.plugin.settings.cleanupModel).onChange(async value => { this.plugin.settings.cleanupModel = value.trim() || DEFAULTS.cleanupModel; await this.plugin.saveSettings(); })); } },
      { name: t('Konfiguration testen'), desc: t('Speichert den eingegebenen Schlüssel und prüft Transkription sowie Bereinigung mit einer kurzen mitgelieferten Testaufnahme. Verändert keine Notiz.'), render: setting => { setting.addButton(button => button.setButtonText(t('Test starten')).setCta().onClick(async () => { if (await saveMainKey()) this.plugin.openConfigurationTest(); })); } },
      { name: t('Erweiterte Provider-Einstellungen'), desc: t('Zeigt individuelle Endpoints und Authentifizierung für lokale oder getrennte Provider.'), render: setting => { setting.addToggle(toggle => toggle.setValue(this.plugin.settings.advancedProviderSettings).onChange(async value => { this.plugin.settings.advancedProviderSettings = value; await this.plugin.saveSettings(); this.refreshSettings(); })); } },
      { name: t('Getrennte Provider verwenden'), desc: t('Ermöglicht unterschiedliche Endpoints und Zugangsdaten für Transkription und Bereinigung.'), visible: () => this.plugin.settings.advancedProviderSettings, render: setting => { setting.addToggle(toggle => toggle.setValue(this.plugin.settings.useSeparateProviders).onChange(async value => {
        this.plugin.settings.useSeparateProviders = value;
        if (!value) this.plugin.settings.transcriptionBaseUrl = this.plugin.settings.cleanupBaseUrl;
        await this.plugin.saveSettings(); this.refreshSettings();
      })); } },
      endpoint('transcriptionBaseUrl', t('Transkriptions-Provider-Basis-URL'), () => this.plugin.settings.advancedProviderSettings && this.plugin.settings.useSeparateProviders),
      endpoint('cleanupBaseUrl', this.plugin.settings.useSeparateProviders ? t('LLM-Provider-Basis-URL') : t('Gemeinsame Provider-Basis-URL'), () => this.plugin.settings.advancedProviderSettings),
      { name: t('LLM-Authentifizierung'), desc: t('API-Schlüssel verwendet den oben gespeicherten LLM-Provider-Schlüssel. Ohne Authentifizierung ist für lokale Provider gedacht.'), visible: () => this.plugin.settings.advancedProviderSettings, render: setting => { setting.addDropdown(dropdown => dropdown
        .addOption('shared', t('LLM-Provider-API-Schlüssel verwenden')).addOption('none', t('Keine Authentifizierung'))
        .setValue(this.plugin.settings.cleanupAuthMode ?? 'shared').onChange(async value => { this.plugin.settings.cleanupAuthMode = value === 'none' ? 'none' : 'shared'; await this.plugin.saveSettings(); })); } },
      { name: t('Transkriptions-Authentifizierung'), desc: t('Kann den LLM-Schlüssel teilen, einen eigenen lokalen Schlüssel verwenden oder den Authorization-Header weglassen.'), visible: () => this.plugin.settings.advancedProviderSettings, render: setting => { setting.addDropdown(dropdown => dropdown
        .addOption('shared', t('LLM-Provider-API-Schlüssel verwenden')).addOption('separate', t('Separaten Schlüssel verwenden')).addOption('none', t('Keine Authentifizierung'))
        .setValue(this.plugin.settings.transcriptionAuthMode ?? 'shared').onChange(async value => { this.plugin.settings.transcriptionAuthMode = value === 'separate' || value === 'none' ? value : 'shared'; await this.plugin.saveSettings(); this.refreshSettings(); })); } },
      { name: t('Transkriptions-Provider-API-Schlüssel'), desc: t('Wird nur für Transkriptionsanfragen verwendet und lokal im Obsidian Secret Storage gespeichert.'), visible: () => this.plugin.settings.advancedProviderSettings && this.plugin.settings.transcriptionAuthMode === 'separate', render: setting => { setting.addText(text => {
        text.inputEl.type = 'password'; text.inputEl.autocomplete = 'off'; text.inputEl.spellcheck = false;
        text.setPlaceholder(t('Transkriptions-Provider-API-Schlüssel')).setValue(transcriptionKey).onChange(value => { transcriptionKey = value; });
      }).addButton(button => button.setButtonText(t('Speichern')).onClick(() => { try { this.plugin.transcriptionApiKey.set(transcriptionKey); new Notice(t('API-Schlüssel gespeichert.')); } catch { new Notice(t('API-Schlüssel konnte nicht gespeichert werden.')); } })); } },
    ];
    const processingItems: VoiceSettingSpec[] = [
      { name: t('Bereinigungs-Prompt'), desc: t('Gilt für neue Aufnahmen. Bereits gespeicherte Aufnahmen behalten ihren ursprünglichen Prompt.'), render: setting => { setting.addTextArea(text => { text.inputEl.rows = 9; text.inputEl.addClass('voice-append-prompt'); text.setValue(this.plugin.settings.prompt).onChange(async value => { this.plugin.settings.prompt = value || DEFAULT_PROMPT; await this.plugin.saveSettings(); }); }); } },
      { name: t('Standard-Prompt wiederherstellen'), desc: t('Setzt den Bereinigungs-Prompt für neue Aufnahmen auf die mitgelieferte Vorgabe zurück.'), render: setting => { setting.addButton(button => button.setButtonText(t('Zurücksetzen')).onClick(async () => { this.plugin.settings.prompt = DEFAULT_PROMPT; await this.plugin.saveSettings(); this.refreshSettings(); })); } },
      { name: t('Aufnahme-Button in Notizen anzeigen'), desc: t('Der Aufnahmebefehl bleibt über Befehlspalette, Ribbon und mobile Werkzeugleiste verfügbar.'), render: setting => { setting.addToggle(toggle => toggle.setValue(this.plugin.settings.showInlineButton).onChange(async value => { this.plugin.settings.showInlineButton = value; this.plugin.updateAppearance(); await this.plugin.saveSettings(); })); } },
      { name: t('Titel für leere Notizen erzeugen'), desc: t('Erzeugt beim Bereinigen einen Titel und benennt die Notiz um, wenn sie außer Frontmatter noch keinen Inhalt hat.'), render: setting => { setting.addToggle(toggle => toggle.setValue(this.plugin.settings.generateTitle ?? false).onChange(async value => { this.plugin.settings.generateTitle = value; await this.plugin.saveSettings(); })); } },
      { name: t('Titel-Prompt'), desc: t('Gilt für neue Aufnahmen und wird beim Cleanup nur dann als eigene Titelanweisung eingefügt, wenn ein Titel erzeugt werden soll.'), render: setting => { setting.addTextArea(text => {
        text.inputEl.rows = 4; text.inputEl.addClass('voice-append-prompt'); text.setValue(this.plugin.settings.titlePrompt ?? DEFAULT_TITLE_PROMPT).onChange(async value => { this.plugin.settings.titlePrompt = value || DEFAULT_TITLE_PROMPT; await this.plugin.saveSettings(); });
      }); } },
      { name: t('Standard-Titel-Prompt wiederherstellen'), desc: t('Setzt den Titel-Prompt für neue Aufnahmen auf die mitgelieferte Vorgabe zurück.'), render: setting => { setting.addButton(button => button.setButtonText(t('Zurücksetzen')).onClick(async () => { this.plugin.settings.titlePrompt = DEFAULT_TITLE_PROMPT; await this.plugin.saveSettings(); this.refreshSettings(); })); } },
      { name: t('Verhalten des Dateinamens'), desc: t('Anhängen behält bestehende Namen wie Zeitstempel von Unique Notes bei. Ersetzen verwendet nur den erzeugten Titel.'), render: setting => { setting.addDropdown(dropdown => dropdown
        .addOption('append', t('An bestehenden Dateinamen anhängen')).addOption('replace', t('Bestehenden Dateinamen ersetzen'))
        .setValue(this.plugin.settings.titleFilenameMode ?? 'append').onChange(async value => { this.plugin.settings.titleFilenameMode = value === 'replace' ? 'replace' : 'append'; await this.plugin.saveSettings(); })); } },
      { name: t('Originaltranskript anhängen'), desc: t('Standardmäßig aus. Bei Aktivierung als eingeklappter Abschnitt unter der Ergänzung.'), render: setting => { setting.addToggle(toggle => toggle.setValue(this.plugin.settings.keepTranscript).onChange(async value => { this.plugin.settings.keepTranscript = value; await this.plugin.saveSettings(); })); } },
      { name: t('Datierte Überschrift'), desc: t('Fügt vor jeder neuen Ergänzung eine Überschrift mit Datum und Uhrzeit ein.'), render: setting => { setting.addToggle(toggle => toggle.setValue(this.plugin.settings.datedHeading).onChange(async value => { this.plugin.settings.datedHeading = value; await this.plugin.saveSettings(); })); } },
      { name: t('Notizkontext beim Bereinigen verwenden'), desc: t('Optional. Sendet bis zu 16.000 Zeichen der aktuellen Notiz an den LLM-Provider. Hilft bei Bezügen und Begriffen; bestehender Text wird nicht umgeschrieben.'), render: setting => { setting.addToggle(toggle => toggle.setValue(this.plugin.settings.useNoteContext ?? false).onChange(async value => { this.plugin.settings.useNoteContext = value; await this.plugin.saveSettings(); })); } },
      { name: t('Bekannte Namen und Konzepte'), desc: t('Optional. Namen, Fachbegriffe und bevorzugte Schreibweisen, etwa „Obsidian; Walter Forkel; Fractals“. Wird für Transkription und Bereinigung verwendet. Maximal 2.000 Zeichen.'), render: setting => { setting.addTextArea(text => {
        text.inputEl.rows = 4; text.inputEl.maxLength = MAX_VOCABULARY_CHARS; text.setValue(this.plugin.settings.vocabulary ?? '').onChange(async value => { this.plugin.settings.vocabulary = value.slice(0, MAX_VOCABULARY_CHARS); await this.plugin.saveSettings(); });
      }); } },
      { name: t('Gespeicherte Aufnahmen'), desc: t('Lokal auf diesem Gerät. Erfolgreiche Audiodateien bleiben sieben Tage erhalten. Offene Aufnahmen werden nicht automatisch gelöscht.'), render: setting => { setting.addButton(button => button.setButtonText(t('Aufnahmen und Status')).onClick(() => this.plugin.openOutbox())); } },
    ];
    const aboutItems: VoiceSettingSpec[] = [
      { name: t('Erstellt von Walter Forkel'), desc: t('Öffnet das GitHub-Profil des Entwicklers.'), render: setting => { setting.addButton(button => button.setButtonText(t('Profil öffnen')).onClick(() => window.open('https://github.com/wko', '_blank'))); } },
      { name: t('Repository und Dokumentation'), desc: t('Quellcode, Dokumentation und aktuelle Entwicklung auf GitHub.'), render: setting => { setting.addButton(button => button.setButtonText(t('Repository öffnen')).onClick(() => window.open('https://github.com/wko/obsidian-voice-notes', '_blank'))); } },
      { name: t('Fehler melden'), desc: t('Erstellt einen strukturierten Bugreport. Entferne vorher API-Schlüssel und private Notizinhalte.'), render: setting => { setting.addButton(button => button.setButtonText(t('Bugreport öffnen')).onClick(() => window.open('https://github.com/wko/obsidian-voice-notes/issues/new?template=bug_report.yml', '_blank'))); } },
      { name: t('Funktion vorschlagen'), desc: t('Beschreibe deinen Anwendungsfall und die gewünschte Verbesserung.'), render: setting => { setting.addButton(button => button.setButtonText(t('Feature-Anfrage öffnen')).onClick(() => window.open('https://github.com/wko/obsidian-voice-notes/issues/new?template=feature_request.yml', '_blank'))); } },
      { name: t('Aufnahmegrenzen'), desc: t('Erste Entwicklungsversion: Aufnahmen bei geöffneter App. Displaysperre oder ein vom System beendeter Prozess können die laufende, noch nicht gespeicherte Aufnahme unterbrechen.') },
    ];
    return [
      { heading: t('Provider-Einrichtung'), items: providerItems },
      { heading: t('Verarbeitung'), items: processingItems },
      { heading: t('Über Voice Append'), items: aboutItems },
    ];
  }
}
class Outbox extends Modal {
  private unsubscribe?: () => void;
  private urls: string[] = [];
  private renderVersion = 0;
  private rendering = false;
  private renderAgain = false;
  private closed = true;
  constructor(app: App, private plugin: VoiceAppend) { super(app); }
  onOpen() { this.closed = false; this.setTitle(t('Aufnahmen und Status')); this.unsubscribe = this.plugin.subscribe(() => this.requestRender()); this.requestRender(); }
  private requestRender() {
    if (this.rendering) { this.renderAgain = true; return; }
    this.rendering = true;
    void (async () => {
      try {
        do { this.renderAgain = false; await this.render(); } while (this.renderAgain);
      } catch {
        if (!this.closed) { this.contentEl.empty(); this.contentEl.createEl('p', { text: t('Aufnahmen konnten nicht geladen werden. Bitte Obsidian neu starten und erneut versuchen.'), cls: 'voice-append-error' }); }
      } finally { this.rendering = false; }
    })();
  }
  private async render() {
    const version = ++this.renderVersion; const jobs = await this.plugin.store.list();
    if (version !== this.renderVersion) return;
    this.urls.forEach(url => URL.revokeObjectURL(url)); this.urls = []; this.contentEl.empty();
    if (!jobs.length) this.contentEl.createEl('p', { text: t('Noch keine Aufnahmen. Öffne eine Notiz und tippe am Ende auf das Mikrofon.') });
    for (const job of jobs.sort((a, b) => b.createdAt - a.createdAt)) {
      const card = this.contentEl.createDiv({ cls: 'voice-append-job' });
      const path = typeof job.targetPath === 'string' && job.targetPath ? job.targetPath : t('Unbekannte Zielnotiz');
      const label = Object.prototype.hasOwnProperty.call(LABELS, job.state) ? t(LABELS[job.state]) : t('Benötigt Aufmerksamkeit');
      const created = typeof job.createdAt === 'number' && Number.isFinite(job.createdAt) ? new Date(job.createdAt).toLocaleString(getLocale()) : t('Unbekannter Zeitpunkt');
      card.createEl('strong', { text: path }); card.createEl('p', { text: `${label} · ${created}` });
      if (typeof job.error === 'string' && job.error) card.createEl('p', { text: job.error, cls: 'voice-append-error' });
      if (job.hasAudio) {
        const load = card.createEl('button', { text: t('Audio laden'), cls: 'voice-append-audio-load' });
        load.onclick = () => { void this.loadAudio(job, card, load); };
      }
      if (typeof job.raw === 'string' && job.raw) { const details = card.createEl('details'); details.createEl('summary', { text: t('Transkript anzeigen') }); details.createEl('p', { text: job.raw }); }
      if (job.state === 'failed' || job.state === 'queued') {
        const retry = card.createEl('button', { text: t('Erneut versuchen') }); retry.onclick = () => { void this.plugin.runQueue(job.id); };
        const assign = card.createEl('button', { text: t('An geöffnete Notiz anhängen') }); assign.onclick = () => { void this.reassign(job.id); };
      }
      if (['completed', 'failed', 'queued'].includes(job.state)) { const remove = card.createEl('button', { text: t('Aufnahme löschen') }); remove.onclick = () => this.plugin.removeRecording(job); }
    }
  }
  private async loadAudio(summary: JobSummary, card: HTMLElement, button: HTMLButtonElement) {
    button.disabled = true;
    try {
      const job = await this.plugin.store.get(summary.id);
      if (!job?.audio) throw new Error('missing audio');
      const bytes = await job.audio.arrayBuffer();
      if (!bytes.byteLength || bytes.byteLength !== job.audio.size) throw new Error('unreadable audio');
      if (!card.isConnected) return;
      const mime = typeof job.mime === 'string' ? job.mime : '';
      this.urls.forEach(url => URL.revokeObjectURL(url)); this.urls = [];
      this.contentEl.querySelectorAll('.voice-append-loaded-audio').forEach(element => element.remove());
      this.contentEl.querySelectorAll<HTMLButtonElement>('.voice-append-audio-load').forEach(element => { element.hidden = false; element.disabled = false; });
      const url = URL.createObjectURL(new Blob([bytes], { type: mime })); this.urls.push(url);
      card.createEl('audio', { cls: 'voice-append-loaded-audio', attr: { controls: '', src: url } });
      card.createEl('a', { text: t('Audio herunterladen'), cls: 'voice-append-loaded-audio', attr: { href: url, download: `voice-${job.id}.${mime.includes('mp4') || mime.includes('m4a') ? 'm4a' : mime.includes('wav') ? 'wav' : 'webm'}` } });
      button.hidden = true;
    } catch {
      if (card.isConnected) card.createEl('p', { text: t('Gespeicherte Audiodaten können nicht gelesen werden. Die übrigen Aufnahmedaten bleiben verfügbar.'), cls: 'voice-append-error' });
      button.disabled = false;
    }
  }
  private async reassign(id: string) {
    try { const job = await this.plugin.store.get(id); if (job) await this.plugin.reassign(job); else new Notice(t('Aufnahme wurde nicht gefunden.')); }
    catch { new Notice(t('Aufnahme konnte nicht geladen werden.')); }
  }
  onClose() { this.closed = true; this.renderVersion++; this.renderAgain = false; this.unsubscribe?.(); this.urls.forEach(url => URL.revokeObjectURL(url)); this.urls = []; }
}
