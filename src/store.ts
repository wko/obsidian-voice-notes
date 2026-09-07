import { t } from './i18n';
import type { Job } from './core';
export class JobStore {
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
  async save(job: Job) { await this.run('readwrite', store => store.put(job)); }
  all(): Promise<Job[]> { return this.run('readonly', store => store.getAll()); }
  async remove(id: string) { await this.run('readwrite', store => store.delete(id)); }
  async expireAudio(now = Date.now()) {
    for (const job of await this.all()) if (job.state === 'completed' && job.completedAt && now - job.completedAt > 7 * 86400000 && job.audio) {
      job.audio = null; await this.save(job);
    }
  }
  close() { this.db.close(); }
}
