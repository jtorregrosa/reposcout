import { MARK_LAYERS, MARK_VIEWBOX } from '@/lib/brand';

// The RepoScout mark, painted by the --mark-* properties of the current theme.
export function Logo({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={MARK_VIEWBOX} aria-hidden className={className}>
      {MARK_LAYERS.map(({ d, paint, stroke }) => (
        <path
          key={d}
          d={d}
          style={
            stroke
              ? { fill: 'none', stroke: `var(--mark-${paint})`, strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round' }
              : { fill: `var(--mark-${paint})` }
          }
        />
      ))}
    </svg>
  );
}
