import { test } from 'node:test';
import assert from 'node:assert/strict';
import { t, setLanguage, getLocale } from '../src/i18n';
test('button and UI use Obsidian language with English fallback', () => {
  setLanguage('en'); assert.equal(t('Gedanken ergänzen'), 'Append via voice'); assert.equal(t('Stoppen & anhängen'), 'Stop & append'); assert.equal(t('Aufnahme-Button in Notizen anzeigen'), 'Show recording button in notes'); assert.equal(t('Titel-Prompt'), 'Title prompt'); assert.equal(t('LLM-Provider-API-Schlüssel'), 'LLM provider API key'); assert.equal(t('Über Voice Append'), 'About Voice Append'); assert.equal(getLocale(), 'en-US');
  setLanguage('de-DE'); assert.equal(t('Gedanken ergänzen'), 'Gedanken ergänzen'); assert.equal(getLocale(), 'de-DE');
  setLanguage('fr'); assert.equal(t('Erneut versuchen'), 'Try again');
  setLanguage('de');
});
test('localized messages interpolate user filenames literally', () => {
  setLanguage('en'); assert.equal(t('Gedanken an „{path}“ angehängt.', { path: 'Notes/$&' }), 'Appended to “Notes/$&”.');
  setLanguage('de');
});
