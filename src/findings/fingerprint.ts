import { createHash } from 'node:crypto';

export const FINGERPRINT_VERSION = 2;

export function normalizeSnippet(text: unknown): string {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function fingerprint({ repo, file, category, snippet }: { repo: string; file: string; category: string; snippet: string }): string {
  const key = [repo, file.replace(/\\/g, '/'), category, normalizeSnippet(snippet)].join('\n');
  return createHash('sha256').update(key).digest('hex').slice(0, 32);
}

// The fingerprint is anchored to the source line the finding points at, never to the snippet the model quotes:
// the same bug quoted two ways across runs produced two fingerprints, and the history recorded it twice.
// A line too short to identify anything (a brace) widens to its neighbours.
export function anchorLine(fileText: string, line: number): string {
  const lines = fileText.split(/\r?\n/);
  const at = normalizeSnippet(lines[line - 1]);
  if (at.length >= 8) return at;
  return normalizeSnippet(lines.slice(Math.max(0, line - 2), line + 1).join('\n'));
}

// The snippet shown to people: the model's quote when it really occurs in the file, otherwise the anchor line.
// locateSnippet decides first whether the quote and the line agree.
export function anchorSnippet(fileText: string, line: number, modelSnippet: unknown): string {
  const normalizedModel = normalizeSnippet(modelSnippet);
  if (normalizedModel.length >= 8 && normalizeSnippet(fileText).includes(normalizedModel)) return normalizedModel;
  return anchorLine(fileText, line);
}

// How far from the reported line the quoted code may sit and still be taken as the line the model meant.
export const SNIPPET_WINDOW = 5;

const compact = (s: string) => s.replace(/\s+/g, '');

// The part of the model's quote to look for: its first line long enough to identify anything, without a line-number
// prefix the model may have copied, and only the longest piece when it elided code with "...".
export function quotedKey(modelSnippet: unknown): string | null {
  for (const raw of String(modelSnippet ?? '').split(/\r?\n/)) {
    const line = raw.replace(/^\s*\d+(?:\s*[:|→]|\t)\s*/, '');
    const piece = line
      .split(/\.\.\.|…/)
      .map(compact)
      .sort((a, b) => b.length - a.length)[0];
    if (piece && piece.length >= 8) return piece;
  }
  return null;
}

// Where the model's quote puts the finding. near: the quote is within SNIPPET_WINDOW lines of the reported line, and
// `line` is the nearest occurrence. far: it is in the file, but not near the line, which is kept. absent: it is
// nowhere in the file, so the model quoted code that does not exist. unchecked: there is no usable quote.
export function locateSnippet(fileText: string, line: number, modelSnippet: unknown): { line: number; quote: 'near' | 'far' | 'absent' | 'unchecked' } {
  const key = quotedKey(modelSnippet);
  if (!key) return { line, quote: 'unchecked' };
  const lines = fileText.split(/\r?\n/).map(compact);
  let nearest: number | null = null;
  for (let d = 0; d <= SNIPPET_WINDOW && nearest == null; d++) {
    for (const at of d ? [line - d, line + d] : [line]) {
      if (at >= 1 && at <= lines.length && lines[at - 1]?.includes(key)) {
        nearest = at;
        break;
      }
    }
  }
  if (nearest != null) return { line: nearest, quote: 'near' };
  return { line, quote: lines.some((l) => l.includes(key)) || compact(fileText).includes(key) ? 'far' : 'absent' };
}
