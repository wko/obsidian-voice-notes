import type { Cleaner, Options, Transcriber } from './core';
import { t } from './i18n';

export interface ConfigurationTestResult { transcript: string; cleaned: string; }

export async function runConfigurationTest(audio: Blob, options: Options, services: { transcriber: Transcriber; cleaner: Cleaner }, onStage?: (stage: 'transcription' | 'cleanup') => void): Promise<ConfigurationTestResult> {
  onStage?.('transcription');
  const transcript = await services.transcriber.transcribe(audio, options.transcriptionModel, undefined, options.transcriptionBaseUrl, options.transcriptionAuthMode);
  if (!transcript.trim()) throw new Error(t('Keine Sprache erkannt. Die Aufnahme bleibt gespeichert.'));
  onStage?.('cleanup');
  const result = await services.cleaner.clean(transcript, options.cleanupModel, options.prompt, undefined, options.cleanupBaseUrl, options.cleanupAuthMode);
  if (!result.body.trim()) throw new Error(t('Die Bereinigung enthält keinen Text.'));
  return { transcript, cleaned: result.body };
}
