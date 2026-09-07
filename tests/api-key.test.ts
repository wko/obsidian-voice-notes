import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiKey } from '../src/api-key';
function fixture() { const values = new Map<string, string>(); return { values, store: { getSecret: (id: string) => values.get(id) ?? null, setSecret: (id: string, value: string) => { values.set(id, value); } } }; }
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
