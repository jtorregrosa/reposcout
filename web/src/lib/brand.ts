// The RepoScout mark: a scout's campaign hat over a pair of braces, one eyebrow raised at the code. One drawing serves
// the dashboard and the downloaded report; each paints it through the --mark-* custom properties of its own stylesheet,
// so the mark follows the light, dark and print themes. docs/brand/ holds the exported files and the brand guide.

export type MarkPaint = 'hat' | 'dents' | 'band' | 'face';

export interface MarkLayer {
  d: string;
  paint: MarkPaint;
  // A stroked layer gives its width; a filled one leaves it out.
  stroke?: number;
}

// Drawn on a 120 grid; the view box crops it to the square the mark fills.
export const MARK_VIEWBOX = '6 9 108 108';

export const MARK_LAYERS: MarkLayer[] = [
  {
    d: 'M29.6 55 C30 46 30.5 38 32.5 33 C34 30 36 29 38.5 27.5 C42 25 47 21 50.5 17.5 C54 13.5 57 12.5 60 12.5 C63 12.5 66 13.5 69.5 17.5 C73 21 78 25 81.5 27.5 C84 29 86 30 87.5 33 C89.5 38 90 46 90.4 55 Z',
    paint: 'hat',
  },
  { d: 'M30.05 47 H89.95 L90.4 55 H29.6 Z', paint: 'band' },
  { d: 'M53.6 21.5 Q53.6 33 41 34.5 M66.4 21.5 Q66.4 33 79 34.5', paint: 'dents', stroke: 3 },
  { d: 'M11.5 54 H108.5 A3.5 3.5 0 0 1 108.5 61 H11.5 A3.5 3.5 0 0 1 11.5 54 Z', paint: 'hat' },
  {
    d: 'M41 68 C34 68 33 71 33 76 L33 82 C33 87 31 89 26 89 C31 89 33 91 33 96 L33 102 C33 107 34 110 41 110 M79 68 C86 68 87 71 87 76 L87 82 C87 87 89 89 94 89 C89 89 87 91 87 96 L87 102 C87 107 86 110 79 110',
    paint: 'face',
    stroke: 7,
  },
  { d: 'M64 81 Q70 74 77 78', paint: 'face', stroke: 4.5 },
  { d: 'M45.5 90 A4.5 4.5 0 1 0 54.5 90 A4.5 4.5 0 1 0 45.5 90 Z M65.5 90 A4.5 4.5 0 1 0 74.5 90 A4.5 4.5 0 1 0 65.5 90 Z', paint: 'face' },
];

// The mark as markup, for HTML built as strings. It carries no ids, so any number of copies can share a page, and no
// xmlns, which inline SVG does not need and the self-contained report must not carry as a URL.
export function markSvg(): string {
  const layers = MARK_LAYERS.map(({ d, paint, stroke }) =>
    stroke
      ? `<path d="${d}" style="fill:none;stroke:var(--mark-${paint});stroke-width:${stroke};stroke-linecap:round;stroke-linejoin:round"/>`
      : `<path d="${d}" style="fill:var(--mark-${paint})"/>`,
  ).join('');
  return `<svg viewBox="${MARK_VIEWBOX}" aria-hidden="true">${layers}</svg>`;
}
