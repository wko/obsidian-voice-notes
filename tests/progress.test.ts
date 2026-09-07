import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteProgress, type ProgressJob } from '../src/progress';
const job = (state: ProgressJob['state'], targetPath = 'Target.md'): ProgressJob => ({ id: state, targetPath, state, createdAt: 1 });
test('progress only appears in the bound target note', () => {
  assert.equal(noteProgress([job('transcribing')], 'Another.md'), null);
  assert.equal(noteProgress([job('transcribing')], 'Target.md')?.spinning, true);
});
test('all processing phases spin and completed jobs disappear', () => {
  for (const state of ['transcribing', 'cleaning', 'appending'] as const) assert.equal(noteProgress([job(state)], 'Target.md')?.spinning, true);
  assert.equal(noteProgress([job('completed')], 'Target.md'), null);
});
test('waiting and errors never spin indefinitely', () => {
  assert.deepEqual(noteProgress([job('queued')], 'Target.md'), { label: 'Wartet auf Verarbeitung', spinning: false, failed: false });
  assert.deepEqual(noteProgress([job('failed')], 'Target.md'), { label: 'Benötigt Aufmerksamkeit', spinning: false, failed: true });
});
test('active work takes precedence over old errors and queued work', () => {
  assert.equal(noteProgress([job('failed'), job('queued'), job('cleaning')], 'Target.md')?.label, 'Wird bereinigt');
});
