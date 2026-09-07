import type { Job } from './core';
import type { Message } from './i18n';
export type ProgressJob = Pick<Job, 'id' | 'targetPath' | 'state' | 'createdAt'>;
export interface NoteProgress { label: Message; spinning: boolean; failed: boolean; }
export function noteProgress(jobs: Iterable<ProgressJob>, path: string): NoteProgress | null {
  const pending = [...jobs].filter(job => job.targetPath === path && job.state !== 'completed');
  const active = pending.find(job => ['transcribing', 'cleaning', 'appending'].includes(job.state));
  const job = active ?? pending.find(job => job.state === 'queued') ?? pending.sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!job) return null;
  const labels: Record<Exclude<Job['state'], 'completed'>, Message> = { queued: 'Wartet auf Verarbeitung', transcribing: 'Wird transkribiert', cleaning: 'Wird bereinigt', appending: 'Wird angehängt', failed: 'Benötigt Aufmerksamkeit' };
  return { label: labels[job.state as Exclude<Job['state'], 'completed'>], spinning: !!active, failed: job.state === 'failed' };
}
