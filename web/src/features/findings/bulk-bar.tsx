import { CircleX, ClipboardCopy, Send, X } from 'lucide-react';
import { useState } from 'react';
import { copyText } from '@/components/copy-button';
import { Button } from '@/components/ui/button';
import { useJiraReadiness } from '@/hooks/use-jira';
import { commonActions } from '@/lib/actions';
import { plural } from '@/lib/format';
import { findingMarkdown } from '@/lib/report/markdown';
import type { FindingView, RepoView } from '@/lib/types';
import { ExportMenu } from './export-menu';
import { NotABugDialog } from './not-a-bug-dialog';
import { ReportDialog } from './report/report-dialog';
import { describeOutcome, type VerdictOutcome } from './use-verdict';

export function BulkBar({
  findings,
  repos,
  onClear,
  onOutcome,
}: {
  findings: FindingView[];
  repos: RepoView[];
  onClear: () => void;
  onOutcome: (text: string) => void;
}) {
  const [notABug, setNotABug] = useState(false);
  const [reporting, setReporting] = useState(false);
  const repoNames = [...new Set(findings.map((f) => f.repo))];
  const oneRepo = repoNames.length === 1 ? (repoNames[0] as string) : null;
  const jira = useJiraReadiness(oneRepo ?? '');
  const reportable = commonActions(findings).report;
  const selectedRepos = new Set(findings.map((f) => f.repo));
  return (
    <>
      <div
        role="toolbar"
        aria-label="Selected findings"
        className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2"
      >
        <span className="text-sm font-medium tabular-nums">{plural(findings.length, 'finding')} selected</span>
        <Button variant="ghost" size="sm" onClick={onClear}>
          <X />
          Clear
        </Button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <ExportMenu
            findings={findings}
            scope={`${plural(findings.length, 'selected finding')}`}
            repos={repos.filter((r) => selectedRepos.has(r.name))}
            repoName={selectedRepos.size === 1 ? ([...selectedRepos][0] ?? null) : null}
            label="Export selection"
            what="selected"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => copyText(findings.map(findingMarkdown).join('\n\n---\n\n'), `${plural(findings.length, 'finding')} copied as Markdown`)}
          >
            <ClipboardCopy />
            Copy for tickets
          </Button>
          {reportable && oneRepo && jira.ready ? (
            <Button size="sm" onClick={() => setReporting(true)}>
              <Send />
              Report to Jira…
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => setNotABug(true)}>
            <CircleX />
            Not a bug…
          </Button>
        </div>
      </div>
      {reportable && !oneRepo ? <p className="px-1 text-xs text-muted-foreground">Select findings of one repository to report them to Jira together.</p> : null}
      {reporting && oneRepo ? (
        <ReportDialog
          repo={oneRepo}
          findings={findings}
          open={reporting}
          onOpenChange={setReporting}
          onDone={(outcomes) => {
            const done = outcomes.filter((o) => o.ok).length;
            onOutcome(`${plural(done, 'finding')} reported${outcomes.length > done ? `; ${outcomes.length - done} refused` : ''}.`);
            onClear();
          }}
        />
      ) : null}
      {notABug ? (
        <NotABugDialog
          findings={findings}
          open={notABug}
          onOpenChange={setNotABug}
          onDone={(o: VerdictOutcome) => {
            onOutcome(describeOutcome(o));
            onClear();
          }}
        />
      ) : null}
    </>
  );
}
