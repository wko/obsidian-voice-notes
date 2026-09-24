export type TitleFilenameMode = 'append' | 'replace';

const MAX_BASENAME_BYTES = 180;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

function truncateUtf8(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  let result = '';
  for (const character of value) {
    if (encoder.encode(result + character).byteLength > maxBytes) break;
    result += character;
  }
  return result;
}

export function sanitizeGeneratedTitle(raw: string | undefined): string {
  if (!raw) return '';
  let title = raw.normalize('NFC')
    .replace(/<!--[^]*?-->/g, '')
    .replace(/^\s*#+\s*/, '')
    .replace(/[<>:"/\\|?*]/g, ' ')
    .split('').map(character => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127 ? ' ' : character;
    }).join('')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.'“”„"‘’]+|[\s.'“”„"‘’]+$/g, '')
    .trim();
  if (!title || title === '.' || title === '..') return '';
  if (WINDOWS_RESERVED.test(title)) title = `${title} note`;
  return truncateUtf8(title, MAX_BASENAME_BYTES).replace(/[ .]+$/g, '');
}

export function titledBasename(current: string, rawTitle: string | undefined, mode: TitleFilenameMode = 'append'): string {
  const title = sanitizeGeneratedTitle(rawTitle);
  if (!title) return '';
  if (mode === 'replace') return title;
  const suffix = ` ${title}`;
  if (current.normalize('NFC').toLocaleLowerCase() === title.toLocaleLowerCase() || current.normalize('NFC').toLocaleLowerCase().endsWith(suffix.toLocaleLowerCase())) return current;
  const prefix = truncateUtf8(current.normalize('NFC').trim(), Math.max(0, MAX_BASENAME_BYTES - new TextEncoder().encode(suffix).byteLength)).replace(/[ .]+$/g, '');
  return prefix ? `${prefix}${suffix}` : title;
}

export function availableBasename(candidate: string, existing: Iterable<string>, current: string): string {
  const occupied = new Set([...existing].map(name => name.normalize('NFC').toLocaleLowerCase()));
  const currentKey = current.normalize('NFC').toLocaleLowerCase();
  if (candidate.normalize('NFC').toLocaleLowerCase() === currentKey || !occupied.has(candidate.normalize('NFC').toLocaleLowerCase())) return candidate;
  for (let suffix = 2; suffix < 10000; suffix++) {
    const suffixText = ` ${suffix}`;
    const stem = truncateUtf8(candidate, MAX_BASENAME_BYTES - new TextEncoder().encode(suffixText).byteLength).replace(/[ .]+$/g, '');
    const next = `${stem}${suffixText}`;
    if (!occupied.has(next.normalize('NFC').toLocaleLowerCase())) return next;
  }
  return '';
}
