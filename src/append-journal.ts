import { appendText, type Job } from './core';
import { t } from './i18n';
export interface AppendPlan { beforeLength: number; beforeHash: string; addition: string; }
async function hash(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function createAppendPlan(current: string, job: Job): Promise<AppendPlan> {
  return { beforeLength: current.length, beforeHash: await hash(current), addition: appendText(current, job).slice(current.length) };
}
export async function inspectAppend(current: string, plan: AppendPlan): Promise<'ready' | 'applied' | 'conflict'> {
  if (current.length < plan.beforeLength || await hash(current.slice(0, plan.beforeLength)) !== plan.beforeHash) return 'conflict';
  if (current.length === plan.beforeLength) return 'ready';
  return current.slice(plan.beforeLength, plan.beforeLength + plan.addition.length) === plan.addition ? 'applied' : 'conflict';
}
export async function applyAppendPlan(current: string, plan: AppendPlan): Promise<string> {
  const state = await inspectAppend(current, plan);
  if (state === 'applied') return current;
  if (state === 'ready') return current + plan.addition;
  throw new Error(t('Die Notiz wurde während einer unterbrochenen Ergänzung geändert. Bitte den Text prüfen; zur Sicherheit wird nichts erneut angehängt.'));
}
export function removeLegacyComments(text: string): string {
  return text.replace(/^<!-- voice-append: [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12} -->[ \t]*(?:\r?\n|$)/gmi, '');
}
