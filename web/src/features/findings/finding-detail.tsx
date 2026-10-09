import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useState } from 'react';
import { CategoryLabel } from '@/components/category';
import { CopyButton } from '@/components/copy-button';
import { IssueBadge } from '@/components/issue-badge';
import { KindBadge, PersonalDataBadge } from '@/components/kind';
import { SeverityBadge, severityBorder } from '@/components/severity';
import { StageProgress } from '@/components/stage';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAction } from '@/hooks/use-actions';
import { useHotkeys } from '@/hooks/use-hotkeys';
import { useJiraReadiness } from '@/hooks/use-jira';
import { availableActions } from '@/lib/actions';
import { DETAIL_TABS, type DetailTab } from '@/lib/findings-view';
import type { FindingView } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from './confirm-dialog';
import { FindingNotices } from './finding-notices';
import { EvidenceTab, HistoryTab, OverviewTab } from './finding-tabs';
import { LabelsEditor } from './labels-editor';
import { NextStepBar } from './next-step-bar';
import { NotABugDialog } from './not-a-bug-dialog';
import { ReportDialog } from './report/report-dialog';

const TAB_LABEL: Record<DetailTab, string> = { overview: 'Overview', evidence: 'Evidence', history: 'History' };

function Pager({ position, onPrevious, onNext, onClose }: Pick<Props, 'position' | 'onPrevious' | 'onNext' | 'onClose'>) {
  return (
    <div className="flex items-center gap-1 border-b px-4 py-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" onClick={onPrevious} disabled={!position || position.index === 0} aria-label="Previous finding">
            <ChevronUp />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Previous <Kbd>K</Kbd>
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" onClick={onNext} disabled={!position || position.index >= position.total - 1} aria-label="Next finding">
            <ChevronDown />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Next <Kbd>J</Kbd>
        </TooltipContent>
      </Tooltip>
      <span className="text-xs text-muted-foreground tabular-nums">{position ? `${position.index + 1} of ${position.total}` : 'Not in the current view'}</span>
      <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={onClose} aria-label="Close finding">
        <X />
      </Button>
    </div>
  );
}

function FindingHeader({ finding: f }: { finding: FindingView }) {
  return (
    <header className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={f.severity} />
        <StatusBadge finding={f} />
        {f.issue ? <IssueBadge issue={f.issue} /> : null}
        <KindBadge kind={f.kind} />
        {f.personal_data ? <PersonalDataBadge /> : null}
        <CategoryLabel category={f.category} className="text-sm" />
        <StageProgress stage={f.stage} className="ml-auto" />
      </div>
      <h2 id="finding-title" className="font-heading text-xl leading-snug font-semibold">
        {f.title}
      </h2>
      <div className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
        <span className="truncate">
          {f.repo} · {f.file}:{f.line}
        </span>
        <CopyButton value={`${f.file}:${f.line}`} label="Copy file and line" what="Location copied" />
      </div>
    </header>
  );
}

interface Props {
  finding: FindingView;
  position: { index: number; total: number } | null;
  tab: DetailTab;
  onTab: (tab: DetailTab) => void;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}

export function FindingDetail({ finding: f, position, tab, onTab, onPrevious, onNext, onClose }: Props) {
  const [dialog, setDialog] = useState<'confirm' | 'not-a-bug' | 'report' | null>(null);
  const jira = useJiraReadiness(f.repo);
  const editor = useAction('openInEditor');
  const actions = availableActions(f);
  const openInEditor = () => editor.mutate({ repo: f.repo, file: f.file, line: f.line });

  useHotkeys({
    ...(actions.confirm ? { confirm: () => setDialog('confirm') } : {}),
    ...(actions.refute || actions.suppress ? { notABug: () => setDialog('not-a-bug') } : {}),
    open: openInEditor,
  });

  return (
    <article aria-labelledby="finding-title" className={cn('flex h-full min-w-0 flex-col border-l-4', severityBorder(f.severity))}>
      <Pager position={position} onPrevious={onPrevious} onNext={onNext} onClose={onClose} />
      <div className="min-w-0 flex-1 space-y-5 overflow-x-hidden overflow-y-auto p-5">
        <FindingHeader finding={f} />
        <NextStepBar
          finding={f}
          actions={actions}
          jira={jira}
          onConfirm={() => setDialog('confirm')}
          onNotABug={() => setDialog('not-a-bug')}
          onReport={() => setDialog('report')}
          onOpen={openInEditor}
        />
        <LabelsEditor finding={f} />
        <FindingNotices finding={f} />
        <Tabs value={tab} onValueChange={(v) => onTab(v as DetailTab)}>
          <TabsList>
            {DETAIL_TABS.map((t) => (
              <TabsTrigger key={t} value={t}>
                {TAB_LABEL[t]}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="overview" className="pt-4">
            <OverviewTab finding={f} />
          </TabsContent>
          <TabsContent value="evidence" className="pt-4">
            <EvidenceTab finding={f} />
          </TabsContent>
          <TabsContent value="history" className="pt-4">
            <HistoryTab finding={f} />
          </TabsContent>
        </Tabs>
      </div>
      {actions.confirm ? <ConfirmDialog finding={f} open={dialog === 'confirm'} onOpenChange={(o) => setDialog(o ? 'confirm' : null)} /> : null}
      <NotABugDialog findings={[f]} open={dialog === 'not-a-bug'} onOpenChange={(o) => setDialog(o ? 'not-a-bug' : null)} />
      {actions.report && jira.ready ? (
        <ReportDialog repo={f.repo} findings={[f]} open={dialog === 'report'} onOpenChange={(o) => setDialog(o ? 'report' : null)} />
      ) : null}
    </article>
  );
}
