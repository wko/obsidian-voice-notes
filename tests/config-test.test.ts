import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runConfigurationTest } from '../src/config-test';
import type { Options } from '../src/core';

const options: Options = { transcriptionModel: 'speech', cleanupModel: 'clean', transcriptionBaseUrl: 'http://speech/v1', cleanupBaseUrl: 'http://llm/v1', transcriptionAuthMode: 'none', cleanupAuthMode: 'shared', prompt: 'Rules', keepTranscript: false, datedHeading: false };

test('configuration test runs transcription then cleanup with the active settings', async () => {
  const stages: string[] = [];
  const result = await runConfigurationTest(new Blob(['audio']), options, {
    transcriber: { async transcribe(_audio, model, vocabulary, url, auth) { assert.equal(model, 'speech'); assert.equal(vocabulary, undefined); assert.equal(url, 'http://speech/v1'); assert.equal(auth, 'none'); return 'Raw sample'; } },
    cleaner: { async clean(raw, model, prompt, context, url, auth) { assert.equal(raw, 'Raw sample'); assert.equal(model, 'clean'); assert.equal(prompt, 'Rules'); assert.equal(context, undefined); assert.equal(url, 'http://llm/v1'); assert.equal(auth, 'shared'); return { body: 'Clean sample' }; } },
  }, stage => stages.push(stage));
  assert.deepEqual(stages, ['transcription', 'cleanup']); assert.deepEqual(result, { transcript: 'Raw sample', cleaned: 'Clean sample' });
});

test('configuration test never calls cleanup after transcription failure', async () => {
  await assert.rejects(runConfigurationTest(new Blob(['audio']), options, {
    transcriber: { async transcribe() { return ''; } },
    cleaner: { async clean() { assert.fail('cleanup called'); } },
  }), /Keine Sprache/);
});
