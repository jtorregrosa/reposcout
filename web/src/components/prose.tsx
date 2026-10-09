import { paragraphs } from '@/lib/report/model';

interface Piece {
  at: number;
  text: string;
  code: boolean;
}

// Splits a paragraph into text and backtick code spans, each keyed by where it starts in the paragraph.
function pieces(paragraph: string): Piece[] {
  const out: Piece[] = [];
  let at = 0;
  for (const part of paragraph.split(/(`[^`]+`)/)) {
    if (part) out.push({ at, text: part, code: part.length > 2 && part.startsWith('`') && part.endsWith('`') });
    at += part.length;
  }
  return out;
}

// The auditors' prose: long single paragraphs split at sentence ends, and backtick spans shown as code. React
// renders every piece as text, so nothing in a finding can become markup.
export function Prose({ text }: { text: string | null | undefined }) {
  let offset = 0;
  const blocks = paragraphs(text).map((p) => {
    const block = { at: offset, pieces: pieces(p) };
    offset += p.length + 1;
    return block;
  });
  return (
    <>
      {blocks.map((b) => (
        <p key={b.at} className="mb-2 last:mb-0 wrap-anywhere">
          {b.pieces.map((piece) =>
            piece.code ? (
              <code key={piece.at} className="rounded border bg-muted px-1 py-0.5 font-mono text-xs">
                {piece.text.slice(1, -1)}
              </code>
            ) : (
              <span key={piece.at}>{piece.text}</span>
            ),
          )}
        </p>
      ))}
    </>
  );
}
