import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availableBasename, sanitizeGeneratedTitle, titledBasename } from '../src/title';

test('appends a generated title to a Unique Notes timestamp by default', () => {
  assert.equal(titledBasename('20260924 083000', 'Morning idea'), '20260924 083000 Morning idea');
});

test('can replace the existing filename', () => {
  assert.equal(titledBasename('20260924 083000', 'Morning idea', 'replace'), 'Morning idea');
});

test('does not append the same title twice after a retry', () => {
  assert.equal(titledBasename('20260924 083000 Morning idea', 'Morning idea'), '20260924 083000 Morning idea');
});

test('sanitizes model output for cross-platform filenames', () => {
  assert.equal(sanitizeGeneratedTitle('# Project: Alpha/Beta?\n'), 'Project Alpha Beta');
  assert.equal(sanitizeGeneratedTitle('CON'), 'CON note');
});

test('resolves filename collisions case-insensitively and deterministically', () => {
  assert.equal(availableBasename('Morning idea', ['morning IDEA', 'Morning idea 2'], '20260924 083000'), 'Morning idea 3');
});

test('allows the current basename without treating it as a collision', () => {
  assert.equal(availableBasename('Morning idea', ['Morning idea'], 'Morning idea'), 'Morning idea');
});
