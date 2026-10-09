import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router';
import { CategoryLabel } from '@/components/category';
import { KindBadge, PersonalDataBadge } from '@/components/kind';
import { SeverityBadge, severityBorder } from '@/components/severity';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import type { FindingView } from '@/lib/types';
import { cn } from '@/lib/utils';

function hrefFor(search: string, id: string) {
  const params = new URLSearchParams(search);
  params.set('id', id);
  return `?${params.toString()}`;
}

// showStatus is off when the list is already one status, where a badge on every row repeats the tab.
export function FindingList({
  findings,
  selected,
  showRepo,
  showStatus,
}: {
  findings: FindingView[];
  selected: string | null;
  showRepo: boolean;
  showStatus: boolean;
}) {
  const { search } = useLocation();
  const selectedRef = useRef<HTMLAnchorElement>(null);

  // Keyboard navigation moves the selection; keep the selected row in view without stealing focus.
  useEffect(() => {
    if (selected) selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  return (
    <ul aria-label="Findings" className="divide-y">
      {findings.map((f) => {
        const active = f.fingerprint === selected;
        return (
          <li key={`${f.repo}:${f.fingerprint}`}>
            <Link
              ref={active ? selectedRef : undefined}
              to={hrefFor(search, f.fingerprint)}
              replace
              aria-current={active ? 'true' : undefined}
              className={cn(
                'block border-l-4 px-4 py-3 outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted',
                severityBorder(f.severity),
                active && 'bg-muted',
              )}
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
      })}
    </ul>
  );
}
