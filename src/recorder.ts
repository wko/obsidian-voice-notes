import { t } from './i18n';
import { Modal, Notice, type App, type TFile } from 'obsidian';
import type { Job, Options } from './core';
import { microphoneHelp, requestMicrophone } from './microphone';
import { RecordingWakeLock } from './wake-lock';
const LIMIT_SECONDS = 600;
const LIMIT_BYTES = 24 * 1024 * 1024;
export class RecorderModal extends Modal {
  private recorder?: MediaRecorder;
  private stream?: MediaStream;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private timer?: number;
  private status!: HTMLElement;
  private controls!: HTMLElement;
  private audio?: Blob;
  private duration = 0;
  private closed = false;
  private saving = false;
  private saved = false;
  private finishing = false;
  private requesting = false;
  private permissionHelp?: HTMLElement;
  private bytes = 0;
  private url?: string;
  private id = crypto.randomUUID();
  private wakeLock = new RecordingWakeLock();
  private hint!: HTMLElement;
  private onVisibility = () => { if (document.hidden && this.recorder?.state === 'recording') this.stop(); };
  constructor(app: App, readonly file: TFile, private options: Options, private accept: (job: Job) => Promise<void>, private release: () => void) { super(app); }
  onOpen() {
    this.contentEl.addClass('voice-append-recorder'); this.setTitle(t('Gedanken ergänzen'));
    this.contentEl.createEl('p', { text: this.file.basename, cls: 'voice-append-target' });
    this.status = this.contentEl.createEl('p', { text: t('Mikrofon wird geöffnet …'), cls: 'voice-append-status', attr: { 'aria-live': 'polite' } });
    this.controls = this.contentEl.createDiv({ cls: 'voice-append-controls' });
    this.hint = this.contentEl.createEl('p', { text: t('Bis zu 10 Minuten. Obsidian während der Aufnahme geöffnet lassen. Stoppen speichert die Aufnahme und startet die Verarbeitung.'), cls: 'voice-append-hint' });
    document.addEventListener('visibilitychange', this.onVisibility);
    void this.start();
  }
  private async start() {
    if (this.requesting || this.closed) return;
    this.requesting = true; this.controls.empty(); this.permissionHelp?.remove();
    this.status.setText(t('Mikrofon wird geöffnet …'));
    const wakeLock = this.wakeLock.start();
    try {
      this.stream = await requestMicrophone();
      if (this.closed) { this.stopTracks(); return; }
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
      this.recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
      this.recorder.ondataavailable = event => {
        if (event.data.size) { this.chunks.push(event.data); this.bytes += event.data.size; }
        if (this.bytes >= LIMIT_BYTES) this.stop();
      };
      this.recorder.onerror = () => { this.status.setText(t('Aufnahme wurde unterbrochen. Verfügbare Audiodaten werden gesichert.')); this.stop(); };
      this.recorder.onstop = () => { void this.finish(); };
      for (const track of this.stream.getAudioTracks()) track.onended = () => this.stop();
      this.startedAt = Date.now(); this.recorder.start(1000);
      void wakeLock.then(active => {
        if (!this.closed && this.recorder?.state === 'recording') this.hint.setText(active
          ? t('Der Bildschirm bleibt während der Aufnahme aktiv. Stoppen speichert die Aufnahme und startet die Verarbeitung.')
          : t('Der Bildschirm kann auf diesem Gerät nicht automatisch aktiv gehalten werden. Obsidian während der Aufnahme geöffnet lassen.'));
      });
      const stop = this.controls.createEl('button', { text: t('Stoppen & anhängen'), cls: 'mod-cta' }); stop.onclick = () => this.stop();
      this.status.setText(`${t('Aufnahme läuft')} · 0:00`);
      this.timer = window.setInterval(() => {
        const seconds = Math.floor((Date.now() - this.startedAt) / 1000);
        this.status.setText(`${t('Aufnahme läuft')} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
        if (seconds >= LIMIT_SECONDS) this.stop();
      }, 250);
    } catch (error) {
      await this.wakeLock.stop();
      this.stopTracks(); if (this.closed) return;
      const help = microphoneHelp(error); this.status.setText(help.message);
      this.controls.empty();
      if (help.help) this.permissionHelp = this.contentEl.createEl('p', { text: help.help, cls: 'voice-append-hint' });
      if (help.settingsUrl) this.controls.createEl('a', { text: t('Mikrofon-Einstellungen öffnen'), cls: 'external-link', attr: { href: help.settingsUrl, target: '_blank', rel: 'noopener' } });
      const retry = this.controls.createEl('button', { text: t('Erneut versuchen'), cls: 'mod-cta' }); retry.onclick = () => { void this.start(); };
      const close = this.controls.createEl('button', { text: t('Schließen') }); close.onclick = () => this.close();
    } finally { this.requesting = false; }
  }
  private stopTracks() { this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); }); }
  private stop() {
    window.clearInterval(this.timer);
    void this.wakeLock.stop();
    if (this.recorder && this.recorder.state !== 'inactive') { this.finishing = true; this.recorder.stop(); }
  }
  private async finish() {
    this.stopTracks(); window.clearInterval(this.timer);
    this.duration = (Date.now() - this.startedAt) / 1000;
    this.audio = new Blob(this.chunks, { type: this.recorder?.mimeType || this.chunks[0]?.type || 'audio/mp4' });
    this.chunks = [];
    if (!this.audio.size) { this.audio = undefined; this.finishing = false; this.status.setText(t('Keine Audiodaten aufgenommen.')); return; }
    this.url = URL.createObjectURL(this.audio);
    this.contentEl.createEl('audio', { attr: { controls: '', src: this.url } });
    await this.save();
  }
  private async save() {
    if (!this.audio || this.saving) return; this.saving = true;
    this.status.setText(t('Aufnahme wird lokal gesichert …')); this.controls.empty();
    try {
      const oversized = this.audio.size > LIMIT_BYTES;
      await this.accept({ id: this.id, targetPath: this.file.path, targetCreatedAt: this.file.stat.ctime, createdAt: this.startedAt, audio: this.audio, mime: this.audio.type, duration: this.duration, options: this.options, state: oversized ? 'failed' : 'queued', ...(oversized ? { error: t('Aufnahme zu groß. Bitte Audio exportieren und kürzere Aufnahme erstellen.') } : {}) });
      this.saved = true; this.saving = false; this.finishing = false;
      new Notice(oversized ? t('Aufnahme lokal gespeichert, aber zu groß für den Upload.') : t('Aufnahme gespeichert. Verarbeitung startet bei Verbindung.'));
      this.close();
    } catch {
      this.finishing = false;
      this.status.setText(t('Speichern fehlgeschlagen. Bitte Audio herunterladen oder erneut speichern.'));
      const retry = this.controls.createEl('button', { text: t('Erneut speichern') }); retry.onclick = () => { void this.save(); };
      this.controls.createEl('a', { text: t('Audio herunterladen'), attr: { href: this.url!, download: `voice-${this.id}.${this.audio.type.includes('mp4') ? 'm4a' : 'webm'}` } });
    } finally { this.saving = false; }
  }
  close() {
    if (this.recorder?.state === 'recording') { this.stop(); return; }
    if (this.saving || this.finishing) return;
    if (this.audio && !this.saved) { new Notice(t('Bitte zuerst die Aufnahme sichern.')); return; }
    super.close();
  }
  onClose() {
    this.closed = true; document.removeEventListener('visibilitychange', this.onVisibility);
    void this.wakeLock.stop();
    if (this.recorder?.state === 'recording') this.stop(); else this.stopTracks();
    if (this.url) URL.revokeObjectURL(this.url);
    this.release();
  }
}
