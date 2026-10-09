import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { CoverageSince, SinceMode } from '@/lib/coverage';

const KEY = 'reposcout.coverageSince';

function load(): CoverageSince {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as CoverageSince | null;
    return v && ['all', '24h', '7d', 'custom'].includes(v.mode) ? v : { mode: 'all', custom: '' };
  } catch {
    return { mode: 'all', custom: '' };
  }
}

// Remembered per browser: an auditor following a sweep keeps their window across reloads.
export function useCoverageSince() {
  const [since, setSince] = useState<CoverageSince>(load);
  const update = (patch: Partial<CoverageSince>) => {
    const next = { ...since, ...patch };
    setSince(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Storage refused (private window): the choice lasts until reload.
    }
  };
  return [since, update] as const;
}

export function CoverageSinceControl({ since, onChange }: { since: CoverageSince; onChange: (patch: Partial<CoverageSince>) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">Count audits since</span>
      <Select value={since.mode} onValueChange={(v) => onChange({ mode: v as SinceMode })}>
        <SelectTrigger size="sm" className="w-44" aria-label="Count audits since">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">all time</SelectItem>
          <SelectItem value="24h">the last 24 hours</SelectItem>
          <SelectItem value="7d">the last 7 days</SelectItem>
          <SelectItem value="custom">a date and time…</SelectItem>
        </SelectContent>
      </Select>
      {since.mode === 'custom' ? (
        <Input type="datetime-local" className="w-56" aria-label="Since" value={since.custom} onChange={(e) => onChange({ custom: e.target.value })} />
      ) : null}
    </div>
  );
}
