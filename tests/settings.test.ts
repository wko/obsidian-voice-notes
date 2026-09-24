import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateSettings, snapshotOptions, OPENROUTER_BASE_URL } from '../src/settings';

test('legacy provider settings migrate without changing endpoints or models', () => {
  const split = migrateSettings({ transcriptionBaseUrl: 'http://speech.local/v1', cleanupBaseUrl: 'http://llm.local/v1', transcriptionModel: 'whisper', cleanupModel: 'llama' });
  assert.equal(split.providerPreset, 'custom'); assert.equal(split.useSeparateProviders, true); assert.equal(split.advancedProviderSettings, true);
  assert.equal(split.transcriptionModel, 'whisper'); assert.equal(split.cleanupModel, 'llama');
  const openRouter = migrateSettings({ transcriptionBaseUrl: OPENROUTER_BASE_URL, cleanupBaseUrl: OPENROUTER_BASE_URL });
  assert.equal(openRouter.providerPreset, 'openrouter'); assert.equal(openRouter.useSeparateProviders, false);
});

test('job snapshots contain processing configuration but no internal or secret settings', () => {
  const settings = migrateSettings({ vaultId: 'private-vault-id', secretId: 'legacy-secret', transcriptionAuthMode: 'none', cleanupAuthMode: 'none' });
  const snapshot = snapshotOptions(settings) as unknown as Record<string, unknown>;
  assert.equal(snapshot.transcriptionAuthMode, 'none'); assert.equal(snapshot.cleanupAuthMode, 'none');
  for (const forbidden of ['vaultId', 'secretId', 'providerPreset', 'advancedProviderSettings', 'useSeparateProviders']) assert.equal(forbidden in snapshot, false);
});
