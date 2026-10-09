import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiKey, DeviceSecret } from '../src/api-key';
function fixture() {
  const values = new Map<string, string>();
  const references = new Map<string, unknown>();
  return {
    values, references,
    store: { getSecret: (id: string) => values.get(id) ?? null, setSecret: (id: string, value: string) => { values.set(id, value); }, listSecrets: () => [...values.keys()] },
    local: { loadLocalStorage: (key: string) => references.get(key) ?? null, saveLocalStorage: (key: string, data: unknown | null) => { if (data === null) references.delete(key); else references.set(key, data); } },
  };
}
test('one string is saved and restored through the plugin-owned secret slot', () => {
  const f = fixture(); const key = new ApiKey(f.store, 'vault'); key.set('  sk-test  ');
  assert.equal(new ApiKey(f.store, 'vault').get(), 'sk-test'); assert.equal(f.values.size, 1);
  key.set('sk-replacement'); assert.equal(f.values.size, 1); assert.equal(key.get(), 'sk-replacement');
});
test('legacy selected key stays usable without altering the original shared secret', () => {
  const f = fixture(); f.values.set('legacy', 'old-key'); const key = new ApiKey(f.store, 'vault', 'legacy');
  assert.equal(key.get(), 'old-key'); key.set('new-key'); assert.equal(key.get(), 'new-key'); assert.equal(f.values.get('legacy'), 'old-key');
});
test('clearing the input does not revive a legacy credential', () => {
  const f = fixture(); f.values.set('legacy', 'old-key'); const key = new ApiKey(f.store, 'vault', 'legacy');
  key.set(''); assert.equal(key.get(), ''); assert.equal(new ApiKey(f.store, 'vault', 'legacy').get(), '');
});
test('a changed synced vault ID does not hide a device-local key', () => {
  const f = fixture(); new ApiKey(f.store, 'original').set('device-key');
  assert.equal(new ApiKey(f.store, 'synced-replacement').get(), 'device-key');
});
test('migrates a unique old plugin key but never guesses among several', () => {
  const f = fixture(); f.values.set('voice-append-old-id', 'old-key');
  assert.equal(new ApiKey(f.store, 'new-id').get(), 'old-key');
  assert.equal(f.values.get('voice-append-api-key'), 'old-key');
  const ambiguous = fixture(); ambiguous.values.set('voice-append-first', 'first'); ambiguous.values.set('voice-append-second', 'second');
  assert.equal(new ApiKey(ambiguous.store, 'new-id').get(), '');
});
test('separate device secret never collides with the shared provider key', () => {
  const f = fixture(); const shared = new ApiKey(f.store, 'vault'); const transcription = new DeviceSecret(f.store, 'voice-append-transcription-api-key');
  shared.set('shared-key'); transcription.set('speech-key');
  assert.equal(shared.get(), 'shared-key'); assert.equal(transcription.get(), 'speech-key'); assert.equal(f.values.size, 2);
});
test('a device-local keychain selection survives a synced vault ID replacement', () => {
  const f = fixture(); f.values.set('my-openai', 'shared-key');
  const key = new ApiKey(f.store, 'original', undefined, f.local); key.select('my-openai');
  const reloaded = new ApiKey(f.store, 'synced-replacement', undefined, f.local);
  assert.equal(reloaded.id, 'my-openai'); assert.equal(reloaded.get(), 'shared-key');
  assert.deepEqual([...f.references], [['voice-append-api-key-selection', 'my-openai']]);
  assert.equal(f.values.has('voice-append-api-key'), false);
});
test('a transcription key is never recovered as an old main provider key', () => {
  const f = fixture(); f.values.set('voice-append-transcription-api-key', 'speech-key');
  assert.equal(new ApiKey(f.store, 'new-vault').get(), '');
  assert.equal(f.values.has('voice-append-api-key'), false);
  f.values.set('voice-append-old-vault', 'main-key');
  assert.equal(new ApiKey(f.store, 'new-vault').get(), 'main-key');
});
for (const kind of ['main', 'transcription'] as const) {
  const ownId = kind === 'main' ? 'voice-append-api-key' : 'voice-append-transcription-api-key';
  const makeKey = (f: ReturnType<typeof fixture>) => kind === 'main'
    ? new ApiKey(f.store, 'vault', 'legacy', f.local)
    : new DeviceSecret(f.store, ownId, f.local);
  test(`${kind} selection reads rotations live without changing a shared secret`, () => {
    const f = fixture(); f.values.set('shared-secret', 'first-key');
    const key = makeKey(f); key.select('shared-secret');
    assert.equal(key.get(), 'first-key'); f.values.set('shared-secret', 'rotated-key');
    assert.equal(key.get(), 'rotated-key');
    assert.deepEqual([...f.references], [[`${ownId}-selection`, 'shared-secret']]);
    assert.deepEqual([...f.values], [['shared-secret', 'rotated-key']]);
  });
  test(`${kind} clearing a selection never revives owned or legacy keys after reload`, () => {
    const f = fixture(); f.values.set(ownId, 'owned-key'); f.values.set('legacy', 'legacy-key');
    const key = makeKey(f); key.select('');
    assert.equal(key.id, ''); assert.equal(key.get(), '');
    assert.equal(makeKey(f).id, ''); assert.equal(makeKey(f).get(), '');
    assert.equal(f.values.get(ownId), 'owned-key'); assert.equal(f.values.get('legacy'), 'legacy-key');
  });
  test(`${kind} missing selected secret never falls back or clears its reference`, () => {
    const f = fixture(); f.values.set(ownId, 'owned-key'); f.values.set('legacy', 'legacy-key');
    const key = makeKey(f); key.select('missing-secret');
    assert.equal(key.get(), ''); assert.equal(makeKey(f).get(), '');
    assert.equal(makeKey(f).id, 'missing-secret');
    f.values.set('missing-secret', 'restored-key'); assert.equal(key.get(), 'restored-key');
  });
  test(`${kind} manually setting a key writes its owned slot instead of the selected shared secret`, () => {
    const f = fixture(); f.values.set('shared-secret', 'shared-key');
    const key = makeKey(f); key.select('shared-secret'); key.set('  replacement-key  ');
    assert.equal(key.id, ownId); assert.equal(key.get(), 'replacement-key');
    assert.equal(makeKey(f).get(), 'replacement-key');
    assert.equal(f.values.get('shared-secret'), 'shared-key');
    assert.deepEqual([...f.references], [[`${ownId}-selection`, ownId]]);
  });
  test(`${kind} selected credential reads never write secrets`, () => {
    const f = fixture(); f.values.set('shared-secret', 'shared-key');
    let secretWrites = 0;
    f.store.setSecret = () => { secretWrites++; };
    const key = makeKey(f); key.select('shared-secret');
    assert.equal(key.id, 'shared-secret');
    assert.equal(key.get(), 'shared-key'); assert.equal(key.get(), 'shared-key');
    assert.equal(secretWrites, 0);
  });
  test(`${kind} failed selection persistence preserves the previous selection`, () => {
    const f = fixture(); f.values.set('shared-secret', 'shared-key');
    const key = makeKey(f); key.select('shared-secret');
    f.local.saveLocalStorage = () => { throw new Error('storage unavailable'); };
    assert.throws(() => key.select('other-secret'), /storage unavailable/);
    assert.equal(key.id, 'shared-secret'); assert.equal(key.get(), 'shared-key');
    assert.equal(makeKey(f).id, 'shared-secret');
  });
}
test('main and transcription keychain references are independent on one device', () => {
  const f = fixture(); f.values.set('llm-key', 'llm-secret'); f.values.set('speech-key', 'speech-secret');
  const main = new ApiKey(f.store, 'vault', undefined, f.local);
  const transcription = new DeviceSecret(f.store, 'voice-append-transcription-api-key', f.local);
  main.select('llm-key'); transcription.select('speech-key');
  assert.equal(main.get(), 'llm-secret'); assert.equal(transcription.get(), 'speech-secret');
  main.select(''); assert.equal(transcription.get(), 'speech-secret');
});
