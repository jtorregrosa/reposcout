import { Meter } from '@/components/meter';
import { paceNote, paceOf, type RepoCoverageCounts, runsFor } from '@/lib/coverage';
import { ANALYZERS, CATEGORY_LABEL } from '@/lib/domain';
import { plural, ratio } from '@/lib/format';
import type { RepoView } from '@/lib/types';

export function runsLeftText(done: number, repo: RepoView): string {
  const eligible = repo.coverage.eligible ?? 0;
  const pending = Math.max(0, eligible - done);
  if (!pending) return 'Complete. Further full runs refresh the oldest files.';
  const runs = runsFor(pending, paceOf(repo));
  return runs ? `${pending} files pending · ≈ ${plural(runs, 'full run')} left at ${paceNote(repo)}` : `${pending} files pending`;
}

// One bar for files every analyzer has opened, and one per analyzer, since a subset run moves only its own bar.
export function CoverageBars({ repo, counts }: { repo: RepoView; counts: RepoCoverageCounts }) {
  return (
    <div className="space-y-4">
      <Meter
        label={<span className="font-medium">Every analyzer</span>}
        detail={`${ratio(counts.every, counts.eligible)}% · ${counts.every} / ${counts.eligible}`}
        value={ratio(counts.every, counts.eligible)}
        tone={counts.every >= counts.eligible ? 'success' : 'default'}
        hint={`${repo.coverage.counted_only ? 'Counted without a full run yet. ' : ''}${runsLeftText(counts.every, repo)}`}
      />
      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {ANALYZERS.map((a) => {
          const n = counts.byAnalyzer[a] ?? 0;
          return (
            <Meter
              key={a}
              size="sm"
              label={<span className="text-muted-foreground">{CATEGORY_LABEL[a]}</span>}
              detail={`${n} / ${counts.eligible}`}
              value={ratio(n, counts.eligible)}
              tone={n >= counts.eligible ? 'success' : 'default'}
            />
          );
        })}
      </div>
    </div>
  );
}
