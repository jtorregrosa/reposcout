import { memo, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router';
import { CategoryLabel } from '@/components/category';
import { KindBadge, PersonalDataBadge } from '@/components/kind';
import { SeverityBadge, severityBorder } from '@/components/severity';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { parseFindingsView, serializeFindingsView } from '@/lib/findings-view';
import type { FindingView } from '@/lib/types';
import { cn } from '@/lib/utils';

export const findingKey = (f: Pick<FindingView, 'repo' | 'fingerprint'>) => `${f.repo}:${f.fingerprint}`;

const hrefFor = (search: string, id: string) => `?${serializeFindingsView({ ...parseFindingsView(new URLSearchParams(search)), id }).toString()}`;

interface RowProps {
  finding: FindingView;
  active: boolean;
  checked: boolean;
  href: string;
  showRepo: boolean;
  showStatus: boolean;
  onToggle: (f: FindingView, range: boolean) => void;
}

const Row = memo(function Row({ finding: f, active, checked, href, showRepo, showStatus, onToggle }: RowProps) {
  const ref = useRef<HTMLAnchorElement>(null);
  // Keyboard navigation moves the selection; keep the selected row in view without stealing focus.
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  return (
    <li className={cn('flex border-l-4', severityBorder(f.severity), active && 'bg-muted', checked && !active && 'bg-primary/5')}>
      <div className="flex items-start py-3 pl-3">
        <Checkbox
          checked={checked}
          aria-label={`Select ${f.title}`}
          onClick={(e) => {
            e.preventDefault();
            onToggle(f, e.shiftKey);
          }}
        />
      </div>
      <Link
        ref={ref}
        to={href}
        replace
        aria-current={active ? 'true' : undefined}
        className="block min-w-0 flex-1 px-3 py-3 outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted"
        onClick={(e) => {
          if (!e.shiftKey) return;
          e.preventDefault();
          onToggle(f, true);
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <span className="line-clamp-2 text-sm font-medium">{f.title}</span>
          <SeverityBadge severity={f.severity} className="shrink-0" />
        </div>
        <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
          {showRepo ? `${f.repo} · ` : ''}
          {f.file}:{f.line}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <KindBadge kind={f.kind} />
          {f.personal_data ? <PersonalDataBadge /> : null}
          <CategoryLabel category={f.category} />
          {showStatus ? (
            <StatusBadge finding={f} />
          ) : f.new_last_run && f.status === 'open' ? (
            <Badge className="bg-info text-primary-foreground">New</Badge>
          ) : null}
          {f.verified ? <span className="text-success">reproduced</span> : null}
        </div>
      </Link>
    </li>
  );
});

// showStatus is off when every listed finding shares a status, where a badge on every row repeats the queue.
export function FindingList({
  findings,
  selected,
  checked,
  showRepo,
  showStatus,
  onToggle,
}: {
  findings: FindingView[];
  selected: string | null;
  checked: ReadonlySet<string>;
  showRepo: boolean;
  showStatus: boolean;
  onToggle: (f: FindingView, range: boolean) => void;
}) {
  const { search } = useLocation();
  return (
    <ul aria-label="Findings" className="divide-y">
      {findings.map((f) => (
        <Row
          key={findingKey(f)}
          finding={f}
          active={f.fingerprint === selected}
          checked={checked.has(findingKey(f))}
          href={hrefFor(search, f.fingerprint)}
          showRepo={showRepo}
          showStatus={showStatus}
          onToggle={onToggle}
        />
      ))}
    </ul>
  );
}
