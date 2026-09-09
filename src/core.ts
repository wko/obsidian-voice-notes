import { t } from './i18n';
import { getLocale } from './i18n';
import { mainContentIsEmpty, type CleanupContext } from './context';
import type { AppendPlan } from './append-journal';
export const DEFAULT_PROMPT = `Carefully clean up my dictated addition. Remove filler words, repetitions, and abandoned sentence fragments. Correct obvious slips of the tongue. Organize the result into readable Markdown paragraphs and add short headings only when useful. Preserve the original language, tone, meaning, claims, uncertainty, examples, and level of detail. Do not infer new meaning, remove substance, or add information or advice. Return only the cleaned addition.`;
export interface Options { transcriptionModel: string; cleanupModel: string; prompt: string; keepTranscript: boolean; datedHeading: boolean; useNoteContext?: boolean; vocabulary?: string; generateTitle?: boolean; }
export interface Job {
  id: string; targetPath: string; targetCreatedAt?: number; createdAt: number;
  audio: Blob | null; mime: string; duration: number; options: Options;
  state: 'queued' | 'transcribing' | 'cleaning' | 'appending' | 'completed' | 'failed';
  raw?: string; cleaned?: string; generatedTitle?: string; requestTitle?: boolean; completedAt?: number; error?: string;
  noteContext?: string;
  appendPlan?: AppendPlan;
}
export function appendText(current: string, job: Job): string {
  if (!job.cleaned?.trim()) throw new Error(t('Die Bereinigung enthält keinen Text.'));
  const body = job.cleaned.trim().replace(/<!--\s*voice-append[^>]*-->/g, '');
  const lines: string[] = [];
  const title = job.generatedTitle?.replace(/<!--[^]*?-->/g, '').replace(/^\s*#+\s*/, '').replace(/\s+/g, ' ').trim().slice(0, 160);
  if (job.options.generateTitle && job.requestTitle && title && mainContentIsEmpty(current)) lines.push(`# ${title}`, '');
  if (job.options.datedHeading) lines.push(`## ${t('Ergänzung')} – ${new Intl.DateTimeFormat(getLocale(), { dateStyle: 'short', timeStyle: 'short' }).format(job.createdAt)}`, '');
  lines.push(body);
  if (job.options.keepTranscript && job.raw) lines.push('', `> [!note]- ${t('Originaltranskript')}`, ...job.raw.replace(/\r\n?/g, '\n').split('\n').map(line => `> ${line}`));
  return current + (current.endsWith('\n\n') || !current ? '' : current.endsWith('\n') ? '\n' : '\n\n') + lines.join('\n') + '\n';
}
export interface Transcriber { transcribe(audio: Blob, model: string, vocabulary?: string): Promise<string>; }
export interface CleanedResult { body: string; title?: string; }
export interface Cleaner { clean(transcript: string, model: string, prompt: string, context?: CleanupContext & { requestTitle?: boolean }): Promise<CleanedResult>; }
export async function processJob(job: Job, services: { transcriber: Transcriber; cleaner: Cleaner; save(job: Job): Promise<void>; append(job: Job): Promise<void> }): Promise<void> {
  if (job.state === 'completed') return;
  try {
    job.error = undefined;
    if (job.raw === undefined) {
      if (!job.audio) throw new Error(t('Die Audiodatei fehlt.'));
      job.state = 'transcribing'; await services.save(job);
      const raw = await services.transcriber.transcribe(job.audio, job.options.transcriptionModel, job.options.vocabulary);
      if (!raw.trim()) throw new Error(t('Keine Sprache erkannt. Die Aufnahme bleibt gespeichert.'));
      job.raw = raw; await services.save(job);
    }
    if (job.cleaned === undefined) {
      job.state = 'cleaning'; await services.save(job);
      const cleaned = await services.cleaner.clean(job.raw, job.options.cleanupModel, job.options.prompt, { noteContext: job.options.useNoteContext ? job.noteContext : undefined, vocabulary: job.options.vocabulary, requestTitle: job.requestTitle });
      if (!cleaned.body.trim()) throw new Error(t('Die Bereinigung enthält keinen Text.'));
      job.cleaned = cleaned.body; job.generatedTitle = cleaned.title; await services.save(job);
    }
    job.state = 'appending'; await services.save(job);
    await services.append(job);
    job.state = 'completed'; job.completedAt = Date.now(); await services.save(job);
  } catch (error) {
    job.state = 'failed'; job.error = error instanceof Error ? error.message : t('Verarbeitung fehlgeschlagen.');
    await services.save(job);
    throw error;
  }
}
