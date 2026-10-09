import { Prose } from '@/components/prose';
import type { Repro } from '@/lib/types';

function Outcome({ label, text, tone }: { label: string; text: string | null; tone: 'expected' | 'actual' }) {
  if (!text) return null;
  return (
    <div
      className={tone === 'actual' ? 'rounded-md border border-destructive/30 bg-destructive/5 p-3' : 'rounded-md border border-success/30 bg-success/5 p-3'}
    >
      <div className={tone === 'actual' ? 'mb-1 text-xs font-semibold text-destructive uppercase' : 'mb-1 text-xs font-semibold text-success uppercase'}>
        {label}
      </div>
      <Prose text={text} />
    </div>
  );
}

// The steps a tester follows to see the bug: what to set up, what to do in order, and what to compare.
export function ReproSteps({ repro }: { repro: Repro }) {
  return (
    <div className="space-y-3">
      {repro.preconditions.length ? (
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">Before you start</div>
          <ul className="list-disc space-y-1 pl-5">
            {repro.preconditions.map((p) => (
              <li key={p}>
                <Prose text={p} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div>
        <div className="mb-1 text-xs font-medium text-muted-foreground">Steps</div>
        <ol className="list-decimal space-y-1.5 pl-5 marker:font-medium marker:text-muted-foreground">
          {repro.steps.map((s) => (
            <li key={s}>
              <Prose text={s} />
            </li>
          ))}
        </ol>
      </div>
      {repro.expected || repro.actual ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Outcome label="Expected" text={repro.expected} tone="expected" />
          <Outcome label="Actual" text={repro.actual} tone="actual" />
        </div>
      ) : null}
    </div>
  );
}
