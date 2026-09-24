import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendText, DEFAULT_PROMPT, processJob, type Job } from '../src/core';
import { createAppendPlan, applyAppendPlan } from '../src/append-journal';
const job = (): Job => ({ id: '11111111-1111-4111-8111-111111111111', targetPath: 'Thoughts.md', createdAt: 1788768000000, audio: new Blob(['audio'], { type: 'audio/mp4' }), mime: 'audio/mp4', duration: 2, state: 'queued', options: { transcriptionModel: 'transcribe', cleanupModel: 'clean', prompt: DEFAULT_PROMPT, keepTranscript: true, datedHeading: false } });
test('preserves every original byte and appends collapsed transcript', () => {
  const original = '---\ntags: [mine]\n---\n\n# Manual title\nHand-edited text.  \n';
  const j = { ...job(), raw: 'Ähm.\nGedanke.', cleaned: 'Gedanke.' };
  const result = appendText(original, j);
  assert.ok(result.startsWith(original)); assert.ok(result.includes('> Ähm.\n> Gedanke.'));
  assert.ok(!result.includes('<!-- voice-append:'));
});
test('supports empty notes and no transcript or heading', () => {
  const j = job(); j.cleaned = 'Neuer Gedanke'; j.options.keepTranscript = false;
  assert.equal(appendText('', j), 'Neuer Gedanke\n');
});
test('keeps generated titles out of note content', () => {
  const j = job(); j.options.keepTranscript = false; j.options.generateTitle = true; j.requestTitle = true; j.cleaned = 'A useful thought.'; j.generatedTitle = '# Useful thought\n';
  assert.equal(appendText('---\ntags: [inbox]\n---\n', j), '---\ntags: [inbox]\n---\n\nA useful thought.\n');
  assert.equal(appendText('Existing body', j), 'Existing body\n\nA useful thought.\n');
});
test('resumes after cleanup failure without transcribing twice', async () => {
  const j = job(); let transcriptions = 0; let cleanup = 0; let appends = 0;
  const services = { transcriber: { async transcribe() { transcriptions++; return 'raw'; } }, cleaner: { async clean() { if (++cleanup === 1) throw new Error('offline'); return { body: 'cleaned' }; } }, async save() {}, async append() { appends++; } };
  await assert.rejects(processJob(j, services)); assert.equal(j.raw, 'raw'); assert.equal(j.state, 'failed');
  await processJob(j, services); assert.equal(transcriptions, 1); assert.equal(cleanup, 2); assert.equal(appends, 1); assert.equal(j.state, 'completed');
});
test('crash after append before completion persistence cannot duplicate text', async () => {
  const j = job(); let note = 'Existing'; let rejectCompletion = true;
  const services = { transcriber: { async transcribe() { return 'raw'; } }, cleaner: { async clean() { return { body: 'clean' }; } }, async save(current: Job) { if (current.state === 'completed' && rejectCompletion) { rejectCompletion = false; throw new Error('storage'); } }, async append(current: Job) { current.appendPlan ??= await createAppendPlan(note, current); note = await applyAppendPlan(note, current.appendPlan); } };
  await assert.rejects(processJob(j, services)); const written = note;
  await processJob(j, services); assert.equal(note, written); assert.equal(j.state, 'completed');
});
test('missing target retains audio and cleaned output for reassignment', async () => {
  const j = job(); await assert.rejects(processJob(j, { transcriber: { async transcribe() { return 'raw'; } }, cleaner: { async clean() { return { body: 'clean' }; } }, async save() {}, async append() { throw new Error('missing target'); } }));
  assert.equal(j.cleaned, 'clean'); assert.ok(j.audio); assert.equal(j.state, 'failed');
});
test('empty speech never invokes cleanup or appends', async () => {
  const j = job(); await assert.rejects(processJob(j, { transcriber: { async transcribe() { return ' '; } }, cleaner: { async clean() { assert.fail('cleanup called'); } }, async save() {}, async append() { assert.fail('append called'); } }));
  assert.equal(j.raw, undefined); assert.ok(j.audio);
});
test('snapshotted prompt is used and completed jobs are not reprocessed', async () => {
  const j = job(); j.options.prompt = 'My prompt';
  const services = { transcriber: { async transcribe() { return 'raw'; } }, cleaner: { async clean(raw: string, model: string, prompt: string) { assert.equal(raw, 'raw'); assert.equal(prompt, 'My prompt'); return { body: 'clean' }; } }, async save() {}, async append() {} };
  await processJob(j, services);
  await processJob(j, { ...services, async save() { assert.fail('completed job saved again'); } });
});
