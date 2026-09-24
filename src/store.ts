import { t } from './i18n';
import type { Job } from './core';

interface StoredAudio { id: string; mime?: string; audioBytes?: ArrayBuffer; audio?: Blob; }
export type JobSummary = Omit<Job, 'audio' | 'audioBytes'> & { hasAudio: boolean };

function isJob(value: unknown): value is Job & { hasAudio?: boolean } {
  return typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'string';
}

function summary(value: Job & { hasAudio?: boolean }): JobSummary {
  const { audio, audioBytes, ...metadata } = value;
  return { ...metadata, hasAudio: value.hasAudio ?? (audioBytes instanceof ArrayBuffer || audio instanceof Blob) };
}

export class JobStore {
  private legacyBlobs = new Set<string>();
  private constructor(private db: IDBDatabase) {}

  static open(vaultId: string): Promise<JobStore> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(`voice-append-${vaultId}`, 2);
      request.onupgradeneeded = event => {
        const db = request.result;
        if (event.oldVersion < 1) db.createObjectStore('jobs', { keyPath: 'id' });
        const audioStore = event.oldVersion < 2 ? db.createObjectStore('audio', { keyPath: 'id' }) : request.transaction!.objectStore('audio');
        if (event.oldVersion === 1) {
          const jobs = request.transaction!.objectStore('jobs');
          const cursor = jobs.openCursor();
          cursor.onsuccess = () => {
            const entry = cursor.result;
            if (!entry) return;
            const value = entry.value as Job & { hasAudio?: boolean };
            const hasBytes = value.audioBytes instanceof ArrayBuffer;
            const hasBlob = value.audio instanceof Blob;
            if (hasBytes || hasBlob) audioStore.put({ id: value.id, mime: value.mime, ...(hasBytes ? { audioBytes: value.audioBytes } : { audio: value.audio }) });
            const metadata = summary(value); metadata.hasAudio = hasBytes || hasBlob;
            entry.update(metadata); entry.continue();
          };
        }
      };
      request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(new JobStore(request.result)); };
      request.onerror = () => reject(new Error(t('Lokaler Aufnahmespeicher konnte nicht geöffnet werden.')));
    });
  }

  private run<T>(storeName: 'jobs' | 'audio', mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, mode); const request = op(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = tx.onerror = () => reject(new Error(t('Aufnahme konnte nicht lokal gespeichert werden. Bitte Audio herunterladen.')));
    });
  }

  async save(job: Job) {
    let audio: StoredAudio | null = null;
    if (job.audio) {
      if (!job.audioBytes) {
        try {
          const bytes = await job.audio.arrayBuffer();
          if (!bytes.byteLength || bytes.byteLength !== job.audio.size) throw new Error('incomplete audio');
          job.audioBytes = bytes;
        } catch {
          if (!this.legacyBlobs.has(job.id)) throw new Error(t('Aufnahme konnte nicht lokal gespeichert werden. Bitte Audio herunterladen.'));
          audio = { id: job.id, mime: job.mime, audio: job.audio };
        }
      }
      audio ??= { id: job.id, mime: job.mime, audioBytes: job.audioBytes };
    }
    const metadata = summary(job); metadata.hasAudio = !!audio;
    await new Promise<void>((resolve, reject) => {
      const tx = this.db.transaction(['jobs', 'audio'], 'readwrite');
      tx.objectStore('jobs').put(metadata);
      if (audio) tx.objectStore('audio').put(audio); else tx.objectStore('audio').delete(job.id);
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(new Error(t('Aufnahme konnte nicht lokal gespeichert werden. Bitte Audio herunterladen.')));
    });
    if (!audio?.audio) this.legacyBlobs.delete(job.id);
  }

  async list(): Promise<JobSummary[]> {
    const values = await this.run<unknown[]>('jobs', 'readonly', store => store.getAll());
    return values.filter(isJob).map(summary);
  }

  async get(id: string): Promise<Job | null> {
    const value = await this.run<unknown>('jobs', 'readonly', store => store.get(id));
    if (!isJob(value)) return null;
    const metadata = summary(value);
    if (!metadata.hasAudio) return { ...metadata, audio: null };
    const stored = await this.run<StoredAudio | undefined>('audio', 'readonly', store => store.get(id) as IDBRequest<StoredAudio | undefined>);
    if (stored?.audioBytes instanceof ArrayBuffer) return { ...metadata, audioBytes: stored.audioBytes, audio: new Blob([stored.audioBytes], { type: stored.mime || metadata.mime || '' }) };
    if (stored?.audio instanceof Blob) { this.legacyBlobs.add(id); return { ...metadata, audio: stored.audio }; }
    return { ...metadata, audio: null };
  }

  /** Compatibility helper for processing and tests; UI should use list() and get(). */
  async all(): Promise<Job[]> {
    const jobs: Job[] = [];
    for (const item of await this.list()) { const job = await this.get(item.id); if (job) jobs.push(job); }
    return jobs;
  }

  async remove(id: string) {
    await new Promise<void>((resolve, reject) => {
      const tx = this.db.transaction(['jobs', 'audio'], 'readwrite');
      tx.objectStore('jobs').delete(id); tx.objectStore('audio').delete(id);
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(new Error(t('Aufnahme konnte nicht lokal gespeichert werden. Bitte Audio herunterladen.')));
    });
    this.legacyBlobs.delete(id);
  }

  async expireAudio(now = Date.now()) {
    for (const item of await this.list()) if (item.state === 'completed' && item.completedAt && now - item.completedAt > 7 * 86400000 && item.hasAudio) {
      const job = await this.get(item.id); if (job) { job.audio = null; job.audioBytes = undefined; await this.save(job); }
    }
  }
  close() { this.db.close(); }
}
