import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('bundled configuration audio is a small mono 16 kHz PCM WAV', async () => {
  const bytes = await readFile(new URL('../src/assets/configuration-test.wav', import.meta.url));
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF'); assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  assert.equal(bytes.readUInt16LE(22), 1); assert.equal(bytes.readUInt32LE(24), 16000); assert.equal(bytes.readUInt16LE(34), 16);
  assert.ok(bytes.length > 32000 && bytes.length < 100000);
});
