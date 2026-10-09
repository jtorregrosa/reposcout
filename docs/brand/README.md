# RepoScout brand

<p>
  <img src="mark.svg" width="120" alt="RepoScout mark">
</p>

> **Leave the code better than you found it.**

RepoScout is a scout for code. It walks through a repository, looks at every change with a critical eye, reports what it can prove, and in time will fix it. The tagline is the Boy Scout Rule of programming, and it says what the tool is for.

## The mark

A scout's campaign hat sits over a pair of code braces. The braces form a face: two eyes, one eyebrow raised.

| Element | Meaning |
| --- | --- |
| Campaign hat, with its four-dent pinch | The scout: someone who explores ground and comes back with an accurate report. |
| `{ }` braces | The terrain is code. |
| Raised eyebrow | The critical eye. RepoScout keeps only what it can confirm, and is sceptical of everything else. |
| Khaki band | The one warm, outdoor note in an otherwise technical palette. |

The geometry lives in one place, [`web/src/lib/brand.ts`](../../web/src/lib/brand.ts), on a 120-unit grid cropped to a 108-unit square. The dashboard and the downloaded HTML report both draw from it. The files in this folder are exports of the same drawing.

## Files

| File | Use |
| --- | --- |
| [`mark.svg`](mark.svg) | Full-colour mark on light backgrounds. The default. |
| [`mark-dark.svg`](mark-dark.svg) | Full-colour mark on dark backgrounds. |
| [`mark-mono.svg`](mark-mono.svg) | One colour, ink. For print, stamps, or any background where colour fights. The dents are cut out, so the background shows through. |
| [`mark-mono-white.svg`](mark-mono-white.svg) | One colour, white, for dark or photographic backgrounds. |
| [`wordmark.svg`](wordmark.svg) | Mark and name, full colour, on light backgrounds. Use it wherever the name is not already written next to the mark. |
| [`wordmark-dark.svg`](wordmark-dark.svg) | Mark and name, full colour, on dark backgrounds. |
| [`wordmark-mono.svg`](wordmark-mono.svg) | Mark and name in ink, with the dents cut out. |
| [`wordmark-mono-white.svg`](wordmark-mono-white.svg) | Mark and name in white, with the dents cut out. |
| [`web/public/favicon.svg`](../../web/public/favicon.svg) | The 16 px redraw: hat and braces, no eyes or dents. It switches to the dark colours when the browser is dark. |

## Colour

The primary blue is RepoScout's official colour. It was already the accent of the HTML report and now defines the brand.

| Role | Light | Dark | Notes |
| --- | --- | --- | --- |
| **Primary blue**: hat, "Scout" in the wordmark | `#2F5BD3` | `#5B7FE6` | The dark value keeps the blue saturated on dark surfaces. |
| Hat dents | `#2448AE` | `#3F64CF` | A shade of the hat, never a separate colour. |
| Khaki: hat band | `#B8A06A` | `#C9B37E` | Secondary colour. Use it sparingly, as an accent, never as a background behind text. |
| Ink: face, "Repo" in the wordmark | `#1A1D24` | `#E6E8ED` | |
| Paper: page background | `#F5F6F8` | `#0F1115` | |
| Text accent: links and labels | `#2F5BD3` | `#8AA6FF` | On dark backgrounds, text needs the lighter blue to stay readable. The mark keeps `#5B7FE6`. |
| Print accent | `#2447B0` | | Darker, so it holds up on paper. |

The severity colours (critical, high, medium, low) are functional, not brand colours. Keep them out of the mark and out of marketing material.

In code, the mark is painted through four custom properties, `--mark-hat`, `--mark-dents`, `--mark-band` and `--mark-face`. They are defined in [`web/src/index.css`](../../web/src/index.css) for the dashboard and in [`web/src/lib/report/style.ts`](../../web/src/lib/report/style.ts) for the report. Change a brand colour in both places, then in this table.

## Wordmark

<p>
  <img src="wordmark.svg" width="380" alt="RepoScout wordmark">
</p>

The wordmark is the mark followed by **Repo**, in ink, and **Scout**, in primary blue. It is one word in [Geist](https://vercel.com/font), Bold, with tracking at -20. The text in the files is outlined, so they do not depend on installed fonts.

Its proportions are measured against the cap height of the text (`H`):

- **Height:** the caps span the face exactly. The cap line sits level with the top of the braces and the baseline with their bottom, and the hat rises above. The whole mark is 2.1 `H` tall.
- **Gap:** from the tip of the brim to the first letter is half of `H`.
- **Spelling and colour:** never set it as two words ("Repo Scout"), and never swap the colours. If one colour is needed, use the one-colour files rather than recolouring the full-colour ones.

The dashboard sidebar sets the name as live text in Geist next to the mark. That is an interface lockup sized for the sidebar, not the wordmark.

## Typography

| Use | Typeface |
| --- | --- |
| Wordmark, headings, interface | Geist (variable), as the dashboard uses it |
| Code, paths, fingerprints | Geist Mono |
| Standalone HTML report | The system UI font. The report is self-contained and loads nothing, so it does not embed Geist. |

## Size and space

- **Clear space:** keep at least a quarter of the mark's width empty on every side.
- **Minimum size:** use the full mark from 24 px upwards. Below that, use the favicon redraw, because the eyes and dents disappear.
- **Shape:** the mark is square. Do not crop the brim, stretch it, or fit it into a circle that cuts the hat.

## Do and don't

**Do**
- Use the light mark on light backgrounds and the dark mark on dark ones.
- Use the one-colour mark when the full-colour mark cannot keep its contrast.
- Keep the raised eyebrow. It is the character of the mark.

**Don't**
- Recolour the hat outside the palette, or use the severity colours on it.
- Add gradients, shadows, outlines or 3D effects.
- Rotate the mark, or make the eyebrow symmetrical.
- Use a fleur-de-lis, or any emblem of a real scouting organisation. RepoScout borrows the idea of a scout, not their marks.
- Put the light mark on a dark background. Its ink face disappears.

## Voice

Write the way the rest of the project is written: plain, specific, and only as confident as the evidence allows. A scout reports what they saw, where, and how sure they are. They do not dramatise it. Name the file, the line and the failure. Skip superlatives.

## Where the brand appears

| Place | Source |
| --- | --- |
| Dashboard sidebar: the mark and the wordmark | [`web/src/app/layout.tsx`](../../web/src/app/layout.tsx) with [`web/src/components/logo.tsx`](../../web/src/components/logo.tsx) |
| Browser tab | [`web/public/favicon.svg`](../../web/public/favicon.svg), linked from [`web/index.html`](../../web/index.html) |
| HTML findings report: the mark on the cover | [`web/src/lib/report/html.ts`](../../web/src/lib/report/html.ts) |
| Project README | [`README.md`](../../README.md) |
