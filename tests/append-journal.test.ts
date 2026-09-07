import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAppendPlan, applyAppendPlan, inspectAppend, removeLegacyComments } from '../src/append-journal';
import type { Job } from '../src/core';
const job = (): Job => ({ id: crypto.randomUUID(), targetPath: 'Note.md', createdAt: 1, state: 'appending', audio: null, mime: '', duration: 0, cleaned: 'New thought', options: { transcriptionModel: 't', cleanupModel: 'c', prompt: '', keepTranscript: false, datedHeading: false } });
test('local journal resumes both sides of a crash without a note marker', async () => {
  const before = 'Existing text\n'; const plan = await createAppendPlan(before, job());
  assert.equal(await inspectAppend(before, plan), 'ready');
  const after = await applyAppendPlan(before, plan);
  assert.equal(after, 'Existing text\n\nNew thought\n');
  assert.equal(await inspectAppend(after, plan), 'applied'); assert.equal(await applyAppendPlan(after, plan), after);
  assert.equal(await applyAppendPlan(after + '\nLater manual thought', plan), after + '\nLater manual thought');
});
test('ambiguous changes after a crash never append automatically', async () => {
  const plan = await createAppendPlan('Original', job());
  await assert.rejects(applyAppendPlan('Changed original\n\nNew thought\n', plan));
  await assert.rejects(applyAppendPlan('Original plus edits', plan));
});
test('distinct recordings may intentionally append identical words', async () => {
  const first = await applyAppendPlan('', await createAppendPlan('', job()));
  const second = await applyAppendPlan(first, await createAppendPlan(first, job()));
  assert.equal(second, 'New thought\n\nNew thought\n');
});
test('migration removes legacy plugin comment lines without changing prose or other comments', () => {
  const marker = '<!-- voice-append: 11111111-1111-4111-8111-111111111111 -->';
  assert.equal(removeLegacyComments(`Original\r\n${marker}\r\nManual text\n<!-- Keep this -->\n`), 'Original\r\nManual text\n<!-- Keep this -->\n');
  assert.equal(removeLegacyComments('No metadata here'), 'No metadata here');
});
