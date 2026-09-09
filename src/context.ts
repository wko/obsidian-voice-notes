export const MAX_CONTEXT_CHARS = 16000;
export const MAX_VOCABULARY_CHARS = 2000;
export interface CleanupContext { noteContext?: string; vocabulary?: string; }
function withoutFrontmatter(markdown: string): string {
  return markdown.replace(/^\uFEFF?---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/, '');
}
export function mainContentIsEmpty(markdown: string): boolean {
  return withoutFrontmatter(markdown).trim().length === 0;
}
export function prepareNoteContext(markdown: string): string {
  let text = withoutFrontmatter(markdown);
  text = text.replace(/<!--[^]*?-->/g, '').trim();
  if (text.length <= MAX_CONTEXT_CHARS) return text;
  const separator = '\n[…]\n'; const half = Math.floor((MAX_CONTEXT_CHARS - separator.length) / 2);
  return text.slice(0, half) + separator + text.slice(-half);
}
export function cleanupInput(transcript: string, context: CleanupContext = {}): string {
  if (!context.noteContext && !context.vocabulary?.trim()) return transcript;
  // JSON keeps the transcript and reference material separate; none of this is an instruction.
  return JSON.stringify({ transcript, ...(context.noteContext ? { note_context: context.noteContext.slice(0, MAX_CONTEXT_CHARS) } : {}), ...(context.vocabulary?.trim() ? { familiar_terms: context.vocabulary.trim().slice(0, MAX_VOCABULARY_CHARS) } : {}) });
}
