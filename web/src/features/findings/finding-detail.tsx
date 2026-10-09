import {
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleX,
  ClipboardCopy,
  CodeXml,
  Copy,
  Eye,
  EyeOff,
  FlaskConical,
  Info,
  Lightbulb,
  ListOrdered,
  Undo2,
  X,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { CategoryLabel } from '@/components/category';
import { CopyButton, copyText } from '@/components/copy-button';
import { Prose } from '@/components/prose';
import { ReproSteps } from '@/components/repro-steps';
import { SeverityBadge, severityBorder } from '@/components/severity';
import { StatusBadge } from '@/components/status-badge';
import { RelativeTime } from '@/components/time';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAction } from '@/hooks/use-actions';
import { formatDateTime, shortSha } from '@/lib/format';
import { findingMarkdown } from '@/lib/report/markdown';
import type { FindingView } from '@/lib/types';
import { cn } from '@/lib/utils';
import { DecideDialog, type Verdict } from './decide-dialog';
import { FindingHistory } from './finding-history';
import { LabelsEditor } from './labels-editor';
import { SuppressDialog } from './suppress-dialog';

function Section({ title, icon, children, className }: { title: string; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-1.5', className)}>
      <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {icon}
        {title}
      </h3>
      <div className="text-sm leading-relaxed wrap-anywhere">{children}</div>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="col-span-2 min-w-0 break-words">{children}</dd>
    </>
  );
}

// A duplicate names the candidate kept in its place; the link opens that one with the same filters.
function DuplicateNotice({ finding }: { finding: FindingView }) {
  const { search } = useLocation();
  const kept = /\b[0-9a-f]{32}\b/.exec(finding.resolution ?? '')?.[0];
  const href = (() => {
    const params = new URLSearchParams(search);
    params.set('id', kept ?? '');
    params.set('status', 'all');
    return `?${params.toString()}`;
  })();
  return (
    <Alert>
      <Copy />
      <AlertTitle>Duplicate</AlertTitle>
      <AlertDescription>
        <p>{finding.resolution ?? 'Same root cause as another candidate, which is tracked instead.'}</p>
        {kept ? (
          <Link to={href} className="font-medium underline-offset-4 hover:underline">
            Open the candidate that is kept
          </Link>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

// Who decided this candidate and why, with a way back if the decision was wrong.
function DecisionNotice({ finding }: { finding: FindingView }) {
  const undo = useAction('undecide');
  const d = finding.decision;
  if (!d) return null;
  const confirmed = d.verdict === 'confirmed';
  return (
    <Alert className={confirmed ? 'border-warning/40' : ''}>
      {confirmed ? <CircleCheck /> : <CircleX />}
      <AlertTitle>
        {confirmed ? 'Confirmed' : 'Refuted'} by {d.decided_by} · {formatDateTime(d.decided_at)}
      </AlertTitle>
      <AlertDescription>
        <p>{d.reason}</p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="link" size="sm" className="h-auto px-0">
              <Undo2 />
              Undo this decision
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Withdraw this decision?</AlertDialogTitle>
              <AlertDialogDescription>
                The candidate goes back to speculative, and the next speculative review looks at it again. The withdrawal is recorded in its history.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction onClick={() => undo.mutate({ repo: finding.repo, fingerprint: finding.fingerprint })}>Withdraw</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </AlertDescription>
    </Alert>
  );
}

function UnsuppressButton({ finding }: { finding: FindingView }) {
  const unsuppress = useAction('unsuppress');
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Eye />
          Unsuppress
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Report this finding again?</AlertDialogTitle>
          <AlertDialogDescription>
            The suppression is removed from repos.yaml. The finding counts as open again and is re-judged the next time its file is audited.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep suppressed</AlertDialogCancel>
          <AlertDialogAction onClick={() => unsuppress.mutate({ repo: finding.repo, fingerprint: finding.fingerprint })}>Unsuppress</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface Props {
  finding: FindingView;
  position: { index: number; total: number } | null;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}

export function FindingDetail({ finding: f, position, onPrevious, onNext, onClose }: Props) {
  const [suppressing, setSuppressing] = useState(false);
  const [deciding, setDeciding] = useState<Verdict | null>(null);
  const open = useAction('openInEditor');
  const canSuppress = f.status === 'open';
  const canDecide = f.status === 'speculative';

  return (
    <article aria-labelledby="finding-title" className={cn('flex h-full min-w-0 flex-col border-l-4', severityBorder(f.severity))}>
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
        <span className="text-xs text-muted-foreground tabular-nums">
          {position ? `${position.index + 1} of ${position.total}` : 'Not in the current filter'}
        </span>
        <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={onClose} aria-label="Close finding">
          <X />
        </Button>
      </div>

      <div className="min-w-0 flex-1 space-y-6 overflow-x-hidden overflow-y-auto p-5">
        <header className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={f.severity} />
            <CategoryLabel category={f.category} className="text-sm" />
            <StatusBadge finding={f} />
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
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => open.mutate({ repo: f.repo, file: f.file, line: f.line })} disabled={open.isPending}>
              <CodeXml />
              Open in VS Code
            </Button>
            <Button size="sm" variant="outline" onClick={() => copyText(findingMarkdown(f), 'Finding copied as Markdown')}>
              <ClipboardCopy />
              Copy for a ticket
            </Button>
            {canDecide ? (
              <>
                <Button size="sm" variant="outline" onClick={() => setDeciding('confirmed')}>
                  <CircleCheck />
                  Confirm…
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDeciding('refuted')}>
                  <CircleX />
                  Refute…
                </Button>
              </>
            ) : null}
            {canSuppress ? (
              <Button size="sm" variant="outline" onClick={() => setSuppressing(true)}>
                <EyeOff />
                Suppress…
              </Button>
            ) : null}
            {f.status === 'suppressed' ? <UnsuppressButton finding={f} /> : null}
          </div>
          <LabelsEditor finding={f} />
        </header>

        {f.decision ? <DecisionNotice finding={f} /> : null}
        {f.status === 'speculative' && f.unconfirmed ? (
          <Alert className="border-speculative/30 text-speculative">
            <Info />
            <AlertTitle>Not confirmed yet</AlertTitle>
            <AlertDescription className="text-foreground">{f.unconfirmed}</AlertDescription>
          </Alert>
        ) : null}
        {f.status === 'suppressed' && f.suppressed_reason ? (
          <Alert>
            <EyeOff />
            <AlertTitle>Suppressed as a false positive</AlertTitle>
            <AlertDescription>{f.suppressed_reason}</AlertDescription>
          </Alert>
        ) : null}
        {(f.status === 'resolved' || f.status === 'refuted') && f.resolution ? (
          <Alert className="border-success/30">
            <Info />
            <AlertTitle>{f.status === 'resolved' ? `Resolved ${f.resolved_at ? formatDateTime(f.resolved_at) : ''}` : 'Refuted'}</AlertTitle>
            <AlertDescription>{f.resolution}</AlertDescription>
          </Alert>
        ) : null}
        {f.status === 'duplicate' ? <DuplicateNotice finding={f} /> : null}

        <Section title="Scenario">
          <Prose text={f.scenario} />
        </Section>
        {f.repro ? (
          <Section title="How to reproduce" icon={<ListOrdered className="size-3.5" />}>
            <ReproSteps repro={f.repro} />
          </Section>
        ) : null}
        <Section title="Why it is a bug">
          <Prose text={f.description} />
        </Section>
        <Section title="Suggested fix" icon={<Lightbulb className="size-3.5" />} className="rounded-lg bg-muted/60 p-4">
          <Prose text={f.suggested_fix} />
        </Section>

        {f.snippet ? (
          <Section title={`Code at line ${f.line}`}>
            <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">{f.snippet}</pre>
          </Section>
        ) : null}
        {f.reproduction ? (
          <Section title="Reproduction" icon={<FlaskConical className="size-3.5" />}>
            <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">{f.reproduction}</pre>
          </Section>
        ) : null}
        {f.review_note ? <Section title="Last speculative review">{f.review_note}</Section> : null}

        <Separator />

        <dl className="grid grid-cols-3 gap-x-4 gap-y-2 text-sm">
          <Fact label="Confidence">
            <span className="capitalize">{f.confidence}</span>
            {f.verified ? (
              <Badge variant="outline" className="ml-2 border-success/30 text-success">
                reproduced by a test
              </Badge>
            ) : null}
          </Fact>
          <Fact label="Reported by">{f.specialists?.length ? f.specialists.join(', ') : '—'}</Fact>
          <Fact label="First seen">
            <RelativeTime iso={f.first_seen} />
          </Fact>
          <Fact label="Last confirmed">
            <RelativeTime iso={f.last_seen} />
          </Fact>
          <Fact label="Commit">
            <span className="font-mono text-xs">{shortSha(f.commit)}</span>
          </Fact>
          <Fact label="Fingerprint">
            <span className="inline-flex items-center gap-1 font-mono text-xs break-all">
              {f.fingerprint}
              <CopyButton value={f.fingerprint} label="Copy fingerprint" what="Fingerprint copied" />
            </span>
          </Fact>
        </dl>

        <FindingHistory repo={f.repo} fingerprint={f.fingerprint} />
      </div>

      {canSuppress ? <SuppressDialog finding={f} open={suppressing} onOpenChange={setSuppressing} /> : null}
      {canDecide ? <DecideDialog finding={f} verdict={deciding} onOpenChange={(open) => !open && setDeciding(null)} /> : null}
    </article>
  );
}
