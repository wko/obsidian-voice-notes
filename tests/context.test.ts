import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareNoteContext, mainContentIsEmpty, cleanupInput, MAX_CONTEXT_CHARS } from '../src/context';
import { OpenAIProvider } from '../src/provider';
import { processJob, type Job } from '../src/core';
test('context is bounded and excludes frontmatter and processing markers', () => {
  const input = '---\nprivate_metadata: not needed\n---\n\nTitle\n<!-- voice-append: id -->\n' + 'x'.repeat(20000) + '\nMost recent thought';
  const context = prepareNoteContext(input);
  assert.ok(context.length <= MAX_CONTEXT_CHARS); assert.ok(context.startsWith('Title')); assert.ok(context.endsWith('Most recent thought'));
  assert.ok(!context.includes('private_metadata')); assert.ok(!context.includes('voice-append'));
});
test('title eligibility ignores frontmatter but not note content', () => {
  assert.equal(mainContentIsEmpty('---\n---\n'), true);
  assert.equal(mainContentIsEmpty('---\naliases: [Inbox]\n---\n\n'), true);
  assert.equal(mainContentIsEmpty('\uFEFF---\ntags: [voice]\n---\r\n'), true);
  assert.equal(mainContentIsEmpty('---\ntags: [voice]\n---\n# Existing title'), false);
  assert.equal(mainContentIsEmpty('A sentence'), false);
});
test('without opt-in and glossary the existing transcript-only contract remains', () => {
  assert.equal(cleanupInput('Only the new thought'), 'Only the new thought');
});
test('context and vocabulary remain separate source fields; only raw transcript is cleaned', async () => {
  const provider = new OpenAIProvider(() => 'key', async request => {
    const body = JSON.parse(request.body as string); const input = JSON.parse(body.input);
    assert.deepEqual(input, { transcript: 'New words', note_context: 'Existing note', familiar_terms: 'Obsidian; Fractals' });
    assert.match(body.instructions, /edit only its transcript field/); assert.match(body.instructions, /Do not copy, rewrite or summarize/);
    return { status: 200, json: { status: 'completed', output: [{ content: [{ type: 'output_text', text: '{"body":"Cleaned addition"}' }] }] } };
  });
  assert.deepEqual(await provider.clean('New words', 'model', 'Rules', { noteContext: 'Existing note', vocabulary: 'Obsidian; Fractals' }), { body: 'Cleaned addition' });
});
test('familiar spellings are also passed to transcription', async () => {
  const provider = new OpenAIProvider(() => 'key', async request => {
    const form = await new Response(request.body, { headers: { 'Content-Type': request.headers['Content-Type'] } }).formData();
    assert.equal(form.get('prompt'), 'Walter Forkel; Obsidian');
    return { status: 200, json: { text: 'Text' } };
  });
  await provider.transcribe(new Blob(['test'], { type: 'audio/webm' }), 'whisper-1', 'Walter Forkel; Obsidian');
});
test('a persisted context is not sent when the job did not opt in', async () => {
  const job: Job = { id: 'id', targetPath: 'Note.md', createdAt: 1, audio: null, mime: '', duration: 0, state: 'queued', raw: 'Raw', noteContext: 'Must not be sent', options: { transcriptionModel: 't', cleanupModel: 'c', prompt: 'p', keepTranscript: false, datedHeading: false, useNoteContext: false } };
  await processJob(job, { transcriber: { async transcribe() { assert.fail('already transcribed'); } }, cleaner: { async clean(_raw, _model, _prompt, context) { assert.equal(context?.noteContext, undefined); return { body: 'Clean' }; } }, async save() {}, async append() {} });
});
