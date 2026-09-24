import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JobStore } from '../src/store';
import { OpenAIProvider } from '../src/provider';
import type { Job } from '../src/core';
function job(id: string): Job { return { id, targetPath: 'Notes.md', createdAt: 1, audio: new Blob(['retained audio']), mime: 'audio/mp4', duration: 1, state: 'queued', options: { prompt: 'Clean', transcriptionModel: 't', cleanupModel: 'c', keepTranscript: true, datedHeading: false } }; }
async function createLegacyDatabase(vaultId: string, value: Job) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(`voice-append-${vaultId}`, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('jobs', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => { const tx = db.transaction('jobs', 'readwrite'); tx.objectStore('jobs').put(value); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
}
test('audio and settings survive database close/reopen; vaults isolated', async () => {
  const id = crypto.randomUUID(); let store = await JobStore.open(id); await store.save(job('a')); store.close();
  store = await JobStore.open(id);
  const summaries = await store.list(); assert.equal(summaries[0].hasAudio, true); assert.equal('audio' in summaries[0], false); assert.equal('audioBytes' in summaries[0], false);
  const recovered = (await store.all())[0]; assert.equal(await recovered.audio!.text(), 'retained audio'); assert.equal(recovered.options.prompt, 'Clean');
  let uploaded = false;
  const provider = new OpenAIProvider(() => 'test-key', request => {
    uploaded = true; assert.equal(request.url.endsWith('/audio/transcriptions'), true);
    assert.ok(request.body instanceof ArrayBuffer); assert.equal(new TextDecoder().decode(request.body).includes('retained audio'), true);
    return Promise.resolve({ status: 200, json: { text: 'Transcribed' } });
  });
  assert.equal(await provider.transcribe(recovered.audio!, 'test-model'), 'Transcribed'); assert.equal(uploaded, true); store.close();
  const other = await JobStore.open(crypto.randomUUID()); assert.deepEqual(await other.all(), []); other.close();
});
test('new recordings reject unreadable audio before being reported saved', async () => {
  const store = await JobStore.open(crypto.randomUUID());
  const broken = job('broken'); broken.audio = new Blob(['bytes']); broken.audio.arrayBuffer = async () => { throw new Error('Blob not readable'); };
  await assert.rejects(store.save(broken), /Audio herunterladen/); assert.deepEqual(await store.all(), []); store.close();
});
test('legacy readable blobs migrate to durable bytes on the next save', async () => {
  const vaultId = crypto.randomUUID(); const dbName = `voice-append-${vaultId}`;
  await createLegacyDatabase(vaultId, job('legacy-readable'));
  const reopened = await JobStore.open(vaultId); const recovered = (await reopened.all())[0];
  await reopened.save(recovered); reopened.close();
  const persisted = await new Promise<{ metadata: Job & { hasAudio: boolean }; audio: { audioBytes: ArrayBuffer } }>((resolve, reject) => { const request = indexedDB.open(dbName, 2); request.onsuccess = () => { const db = request.result; const tx = db.transaction(['jobs', 'audio'], 'readonly'); const metadata = tx.objectStore('jobs').get('legacy-readable'); const audio = tx.objectStore('audio').get('legacy-readable'); tx.oncomplete = () => { resolve({ metadata: metadata.result as Job & { hasAudio: boolean }, audio: audio.result as { audioBytes: ArrayBuffer } }); db.close(); }; tx.onerror = () => reject(tx.error); }; request.onerror = () => reject(request.error); });
  assert.equal(persisted.metadata.hasAudio, true); assert.equal('audio' in persisted.metadata, false); assert.equal('audioBytes' in persisted.metadata, false); assert.equal(new TextDecoder().decode(persisted.audio.audioBytes), 'retained audio');
});
test('legacy unreadable blobs retain the job and produce a recoverable error on retry', async () => {
  const vaultId = crypto.randomUUID();
  await createLegacyDatabase(vaultId, job('legacy'));
  const reopened = await JobStore.open(vaultId); const recovered = (await reopened.all())[0];
  assert.equal(recovered.audioBytes, undefined); assert.ok(recovered.audio);
  recovered.audio!.arrayBuffer = async () => { throw new Error('Blob not readable'); };
  recovered.state = 'failed'; recovered.error = 'Stored audio cannot be read';
  await reopened.save(recovered);
  const retained = (await reopened.all())[0]; assert.equal(retained.state, 'failed'); assert.ok(retained.audio); assert.equal(retained.error, 'Stored audio cannot be read'); reopened.close();
});
test('retention removes only audio from completed jobs older than seven days', async () => {
  const store = await JobStore.open(crypto.randomUUID()); const now = Date.now();
  const completed = { ...job('done'), state: 'completed' as const, completedAt: now - 8 * 86400000, raw: 'raw', cleaned: 'clean' };
  await store.save(completed); await store.save({ ...job('failed'), state: 'failed' }); await store.save(job('queued'));
  await store.expireAudio(now); const jobs = await store.all();
  assert.equal(jobs.find(j => j.id === 'done')!.audio, null); assert.equal(jobs.find(j => j.id === 'done')!.cleaned, 'clean');
  assert.ok(jobs.find(j => j.id === 'failed')!.audio); assert.ok(jobs.find(j => j.id === 'queued')!.audio); store.close();
});
