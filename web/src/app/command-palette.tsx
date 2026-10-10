import { useQuery } from '@tanstack/react-query';
import { Activity, ChartColumn, FileSearch, FolderGit2, Keyboard, LayoutDashboard, ListChecks, Monitor, Moon, Play, Settings, Sun } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { SeverityDot } from '@/components/severity';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useNewAudit } from '@/features/runs/new-audit';
import { useRunInProgress } from '@/hooks/use-run-in-progress';
import { findingsHref } from '@/lib/findings-view';
import { overviewQuery } from '@/lib/queries';
import { type Theme, useTheme } from './theme';

// Findings join the list once the search could tell them apart; hundreds of rows on an empty search help no one.
const FINDING_SEARCH_MIN = 2;

const PAGES = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/findings', label: 'Findings', icon: ListChecks },
  { to: '/repositories', label: 'Repositories', icon: FolderGit2 },
  { to: '/runs', label: 'Runs', icon: Activity },
  { to: '/insights', label: 'Insights', icon: ChartColumn },
  { to: '/settings', label: 'Settings', icon: Settings },
];

const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light theme', icon: Sun },
  { value: 'dark', label: 'Dark theme', icon: Moon },
  { value: 'system', label: 'Theme from the system', icon: Monitor },
];

export function CommandPalette({ open, onOpenChange, onShowShortcuts }: { open: boolean; onOpenChange: (open: boolean) => void; onShowShortcuts: () => void }) {
  const navigate = useNavigate();
  const { setTheme } = useTheme();
  const openAudit = useNewAudit();
  const running = useRunInProgress();
  const { data: ov } = useQuery({ ...overviewQuery, enabled: open });
  const [search, setSearch] = useState('');

  const run = (action: () => void) => () => {
    onOpenChange(false);
    setSearch('');
    action();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-1/4 translate-y-0 overflow-hidden p-0 sm:max-w-xl" showCloseButton={false}>
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">Jump to a page, a repository or a finding, or run a command.</DialogDescription>
        <Command>
          <CommandInput placeholder="Search pages, repositories, findings or commands…" value={search} onValueChange={setSearch} />
          <CommandList className="max-h-96">
            <CommandEmpty>Nothing matches.</CommandEmpty>
            <CommandGroup heading="Go to">
              {PAGES.map((p) => (
                <CommandItem key={p.to} value={`page ${p.label}`} onSelect={run(() => navigate(p.to))}>
                  <p.icon />
                  {p.label}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading="Commands">
              {running ? null : (
                <CommandItem value="command new audit" onSelect={run(() => openAudit())}>
                  <Play />
                  New audit…
                </CommandItem>
              )}
              <CommandItem value="command keyboard shortcuts" onSelect={run(onShowShortcuts)}>
                <Keyboard />
                Keyboard shortcuts
              </CommandItem>
              {THEMES.map((t) => (
                <CommandItem key={t.value} value={`command ${t.label}`} onSelect={run(() => setTheme(t.value))}>
                  <t.icon />
                  {t.label}
                </CommandItem>
              ))}
            </CommandGroup>
            {ov?.repos.length ? (
              <>
                <CommandSeparator />
                <CommandGroup heading="Repositories">
                  {ov.repos.map((r) => (
                    <CommandItem key={r.name} value={`repository ${r.name}`} onSelect={run(() => navigate(`/repositories/${encodeURIComponent(r.name)}`))}>
                      <FolderGit2 />
                      {r.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            ) : null}
            {ov && search.trim().length >= FINDING_SEARCH_MIN ? (
              <>
                <CommandSeparator />
                <CommandGroup heading="Findings">
                  {ov.findings.map((f) => (
                    <CommandItem
                      key={`${f.repo}:${f.fingerprint}`}
                      value={`finding ${f.repo} ${f.fingerprint}`}
                      keywords={[f.title, f.fingerprint, f.file]}
                      onSelect={run(() => navigate(findingsHref({ queue: 'all', id: f.fingerprint })))}
                    >
                      <SeverityDot severity={f.severity} />
                      <span className="min-w-0 flex-1 truncate">{f.title}</span>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {f.repo} · {f.fingerprint.slice(0, 8)}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            ) : search.trim().length ? null : (
              <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                <FileSearch className="size-3.5" />
                Type a title or a fingerprint to find a finding.
              </p>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
