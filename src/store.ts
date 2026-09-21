import { t } from './i18n';
import type { Job } from './core';
function isJob(value: unknown): value is Job {
  return typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'string';
}
export class JobStore {
  private legacyBlobs = new Set<string>();
  private constructor(private db: IDBDatabase) {}
  static open(vaultId: string): Promise<JobStore> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(`voice-append-${vaultId}`, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('jobs', { keyPath: 'id' });
      request.onsuccess = () => resolve(new JobStore(request.result));
      request.onerror = () => reject(new Error(t('Lokaler Aufnahmespeicher konnte nicht geöffnet werden.')));
    });
  }
  private run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('jobs', mode); const request = op(tx.objectStore('jobs'));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = tx.onerror = () => reject(new Error(t('Aufnahme konnte nicht lokal gespeichert werden. Bitte Audio herunterladen.')));
    });
  }
  async save(job: Job) {
    if (!job.audio) {
      job.audioBytes = undefined;
      await this.run('readwrite', store => store.put({ ...job, audio: null }));
      this.legacyBlobs.delete(job.id);
      return;
    }
    if (!job.audioBytes) {
      try {
        const bytes = await job.audio.arrayBuffer();
        if (!bytes.byteLength || bytes.byteLength !== job.audio.size) throw new Error('incomplete audio');
        job.audioBytes = bytes;
      } catch {
        if (!this.legacyBlobs.has(job.id)) throw new Error(t('Aufnahme konnte nicht lokal gespeichert werden. Bitte Audio herunterladen.'));
        // Keep an older unreadable Blob and its job state intact; never silently discard it.
        await this.run('readwrite', store => store.put(job));
        return;
      }
    }
    await this.run('readwrite', store => store.put({ ...job, audio: null }));
    this.legacyBlobs.delete(job.id);
  }
  async all(): Promise<Job[]> {
    const values = await this.run<unknown[]>('readonly', store => store.getAll());
    return values.filter(isJob).map(job => {
      if (job.audioBytes instanceof ArrayBuffer) {
        job.audio = new Blob([job.audioBytes], { type: job.mime });
      } else if (job.audio instanceof Blob) {
        this.legacyBlobs.add(job.id);
      }
      return job;
    });
  }
  async remove(id: string) { await this.run('readwrite', store => store.delete(id)); this.legacyBlobs.delete(id); }
  async expireAudio(now = Date.now()) {
    for (const job of await this.all()) if (job.state === 'completed' && job.completedAt && now - job.completedAt > 7 * 86400000 && job.audio) {
      job.audio = null; await this.save(job);
    }
  }
  close() { this.db.close(); }
}
