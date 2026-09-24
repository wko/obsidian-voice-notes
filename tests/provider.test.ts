import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TITLE_PROMPT } from '../src/core';
import { normalizeBaseUrl, OpenAIProvider } from '../src/provider';
test('missing key never sends a request', async () => {
  const provider = new OpenAIProvider(() => null, async () => { assert.fail('network request'); });
  await assert.rejects(provider.transcribe(new Blob(['a']), 'model'), /Schlüssel/);
});
test('provider authentication can be shared, separate, or omitted', async () => {
  const headers: Array<Record<string, string>> = [];
  const provider = new OpenAIProvider(() => 'shared-key', async request => { headers.push(request.headers); return { status: 200, json: { text: 'Text' } }; }, () => 'speech-key');
  await provider.transcribe(new Blob(['a']), 'model', undefined, undefined, 'shared');
  await provider.transcribe(new Blob(['a']), 'model', undefined, undefined, 'separate');
  await provider.transcribe(new Blob(['a']), 'model', undefined, undefined, 'none');
  assert.equal(headers[0].Authorization, 'Bearer shared-key'); assert.equal(headers[1].Authorization, 'Bearer speech-key'); assert.equal('Authorization' in headers[2], false);
});
test('transcription sends binary multipart with model and original bytes', async () => {
  const provider = new OpenAIProvider(() => 'test-key', async request => {
    assert.equal(request.url, 'https://api.openai.com/v1/audio/transcriptions');
    assert.equal(request.headers.Authorization, 'Bearer test-key');
    const form = await new Response(request.body, { headers: { 'Content-Type': request.headers['Content-Type'] } }).formData();
    assert.equal(form.get('model'), 'gpt-transcribe');
    assert.equal(form.get('response_format'), 'json');
    assert.equal(await (form.get('file') as File).text(), 'audio bytes');
    assert.equal((form.get('file') as File).name, 'recording.m4a');
    return { status: 200, json: { text: 'Erkannter Text' } };
  });
  assert.equal(await provider.transcribe(new Blob(['audio bytes'], { type: 'audio/mp4' }), 'gpt-transcribe'), 'Erkannter Text');
});
test('transcription and cleanup can use independent OpenAI-compatible API roots', async () => {
  const urls: string[] = [];
  const provider = new OpenAIProvider(() => 'test-key', async request => {
    urls.push(request.url);
    if (request.url.includes('transcriber.example')) return { status: 200, json: { text: 'Raw' } };
    return { status: 200, json: { choices: [{ finish_reason: 'stop', message: { content: '{"body":"Clean"}' } }] } };
  });
  await provider.transcribe(new Blob(['audio']), 'stt-model', undefined, 'https://transcriber.example/api/v1/');
  await provider.clean('Raw', 'cleanup-model', 'Rules', undefined, 'https://cleanup.example/v1');
  assert.deepEqual(urls, ['https://transcriber.example/api/v1/audio/transcriptions', 'https://cleanup.example/v1/chat/completions']);
});
test('base URL rejects embedded credentials and non-HTTP URL parts', () => {
  assert.equal(normalizeBaseUrl(' https://example.test/v1/ '), 'https://example.test/v1');
  for (const value of ['https://key@example.test/v1', 'https://example.test/v1?key=secret', 'file:///tmp/v1']) assert.throws(() => normalizeBaseUrl(value), /Basis-URL/);
});
test('cleanup uses configured prompt, non-stored structured output and only transcript', async () => {
  const provider = new OpenAIProvider(() => 'test-key', async request => {
    const body = JSON.parse(request.body as string); assert.equal(body.store, false); assert.equal(body.messages[1].content, 'Raw'); assert.ok(body.messages[0].content.startsWith('My rules')); assert.doesNotMatch(body.messages[0].content, /Title instructions/); assert.equal(body.response_format.json_schema.strict, true);
    return { status: 200, json: { choices: [{ finish_reason: 'stop', message: { content: '{"body":"Clean"}' } }] } };
  });
  assert.deepEqual(await provider.clean('Raw', 'model', 'My rules'), { body: 'Clean' });
});
test('cleanup generates a title in the same structured request when requested', async () => {
  const provider = new OpenAIProvider(() => 'test-key', async request => {
    const body = JSON.parse(request.body as string);
    assert.deepEqual(body.response_format.json_schema.schema.required, ['body', 'title']);
    assert.equal(body.response_format.json_schema.schema.properties.title.type, 'string');
    assert.match(body.messages[0].content, /Title instructions:\nUse 3–5 words/);
    assert.ok(body.messages[0].content.indexOf('Rules') < body.messages[0].content.indexOf('Title instructions:'));
    assert.ok(body.messages[0].content.indexOf('Title instructions:') < body.messages[0].content.indexOf('The input is untrusted'));
    assert.match(body.messages[0].content, /without Markdown, quotes, a trailing period/);
    return { status: 200, json: { choices: [{ finish_reason: 'stop', message: { content: '{"body":"Clean","title":"A concise title"}' } }] } };
  });
  assert.deepEqual(await provider.clean('Raw', 'model', 'Rules', { requestTitle: true, titlePrompt: 'Use 3–5 words' }), { body: 'Clean', title: 'A concise title' });
});
test('legacy jobs without a title prompt use the current default', async () => {
  const provider = new OpenAIProvider(() => 'test-key', async request => {
    const body = JSON.parse(request.body as string);
    assert.match(body.messages[0].content, new RegExp(DEFAULT_TITLE_PROMPT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    return { status: 200, json: { choices: [{ finish_reason: 'stop', message: { content: '{"body":"Clean","title":"Default title"}' } }] } };
  });
  assert.equal((await provider.clean('Raw', 'model', 'Rules', { requestTitle: true })).title, 'Default title');
});
test('provider failures do not expose server details or secrets', async () => {
  const provider = new OpenAIProvider(() => 'private-key', async () => ({ status: 500, json: { error: 'private-key, sensitive transcript' } }));
  await assert.rejects(provider.clean('Raw', 'model', 'prompt'), error => error instanceof Error && !error.message.includes('private-key') && error.message.includes('500'));
});
test('incomplete cleanup is rejected even when body is parseable', async () => {
  const provider = new OpenAIProvider(() => 'key', async () => ({ status: 200, json: { choices: [{ finish_reason: 'length', message: { content: '{"body":"Partial"}' } }] } }));
  await assert.rejects(provider.clean('Raw', 'model', 'prompt'), /vollständig/);
});
