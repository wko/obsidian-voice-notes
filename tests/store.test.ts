import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JobStore } from '../src/store';
import type { Job } from '../src/core';
function job(id: string): Job { return { id, targetPath: 'Notes.md', createdAt: 1, audio: new Blob(['retained audio']), mime: 'audio/mp4', duration: 1, state: 'queued', options: { prompt: 'Clean', transcriptionModel: 't', cleanupModel: 'c', keepTranscript: true, datedHeading: false } }; }
test('audio and settings survive database close/reopen; vaults isolated', async () => {
  const id = crypto.randomUUID(); let store = await JobStore.open(id); await store.save(job('a')); store.close();
  store = await JobStore.open(id); const recovered = (await store.all())[0]; assert.equal(await recovered.audio!.text(), 'retained audio'); assert.equal(recovered.options.prompt, 'Clean'); store.close();
  const other = await JobStore.open(crypto.randomUUID()); assert.deepEqual(await other.all(), []); other.close();
});
test('retention removes only audio from completed jobs older than seven days', async () => {
  const store = await JobStore.open(crypto.randomUUID()); const now = Date.now();
  const completed = { ...job('done'), state: 'completed' as const, completedAt: now - 8 * 86400000, raw: 'raw', cleaned: 'clean' };
  await store.save(completed); await store.save({ ...job('failed'), state: 'failed' }); await store.save(job('queued'));
  await store.expireAudio(now); const jobs = await store.all();
  assert.equal(jobs.find(j => j.id === 'done')!.audio, null); assert.equal(jobs.find(j => j.id === 'done')!.cleaned, 'clean');
  assert.ok(jobs.find(j => j.id === 'failed')!.audio); assert.ok(jobs.find(j => j.id === 'queued')!.audio); store.close();
});
