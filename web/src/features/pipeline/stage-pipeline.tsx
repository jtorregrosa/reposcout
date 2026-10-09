import { ArrowRight, type LucideIcon, Radar, Send, ShieldCheck, Wrench } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { ExportMenu } from '@/features/findings/export-menu';
import { NewAuditButton } from '@/features/runs/new-audit';
import { RunLaunchButton } from '@/features/runs/run-launch-dialog';
import { DEFAULT_VIEW, describeScope, findingsHref } from '@/lib/findings-view';
import { queueOf } from '@/lib/queues';
import { pipeline, speculativeScope, validationScope } from '@/lib/selectors';
import type { FindingView, RepoView } from '@/lib/types';
import { cn } from '@/lib/utils';

function StageCard({
  icon: Icon,
  title,
  about,
  count,
  to,
  facts,
  actions,
  className,
}: {
  icon: LucideIcon;
  title: string;
  about: string;
  count: ReactNode;
  to: string | null;
  facts: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('gap-3', !to && 'bg-muted/40 shadow-none', className)}>
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          <Icon aria-hidden className="size-4" />
          {title}
        </CardDescription>
        <CardTitle className="text-3xl font-semibold tabular-nums">
          {to ? (
            <Link
              to={to}
              className="group inline-flex items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-ring"
              aria-label={`${title}: ${about}`}
            >
              {count}
              <ArrowRight aria-hidden className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>
          ) : (
            count
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-xs text-muted-foreground">
        <p>{about}</p>
        <div className="flex flex-wrap gap-x-3">{facts}</div>
      </CardContent>
      {actions ? <CardFooter className="mt-auto flex flex-wrap gap-2">{actions}</CardFooter> : null}
    </Card>
  );
}

// The four stages a finding moves through, each with what it holds now and the one thing that moves it on.
export function StagePipeline({ findings, repos, repo = null }: { findings: FindingView[]; repos: RepoView[]; repo?: string | null }) {
  const scoped = repo ? findings.filter((f) => f.repo === repo) : findings;
  const p = pipeline(scoped);
  const toReport = scoped.filter((f) => queueOf(f) === 'report');
  return (
    <section aria-label="Stages" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StageCard
        icon={Radar}
        title="Detect"
        about="Open findings the audits confirmed in the code."
        count={p.detect.open}
        to={findingsHref({ queue: 'all', statuses: ['open'], repo })}
        facts={<span>{p.detect.fresh} new in the last run</span>}
        actions={<NewAuditButton preset={repo ? { repos: [repo] } : {}} variant="outline" size="sm" label={repo ? 'Audit this repository' : 'New audit'} />}
      />
      <StageCard
        icon={ShieldCheck}
        title="Validate"
        about="Waiting for a verdict: is it real?"
        count={p.validate.total}
        to={findingsHref({ queue: 'triage', repo })}
        facts={
          <>
            <span>{p.validate.detected} detected</span>
            <span>{p.validate.speculative} speculative</span>
          </>
        }
        actions={
          <>
            <RunLaunchButton kind="validate" scope={validationScope(repos, repo)} size="sm" />
            <RunLaunchButton kind="speculative" scope={speculativeScope(findings, repo)} size="sm" />
          </>
        }
      />
      <StageCard
        icon={Send}
        title="Report"
        about="Validated and open, ready for the people who own the code."
        count={p.report.total}
        to={findingsHref({ queue: 'report', repo })}
        facts={<span>Work items are not created yet; export them.</span>}
        actions={
          <ExportMenu
            findings={toReport}
            scope={describeScope({ ...DEFAULT_VIEW, queue: 'report', repo })}
            repos={repos.filter((r) => !repo || r.name === repo)}
            repoName={repo}
            what="to report"
          />
        }
      />
      <StageCard
        icon={Wrench}
        title="Fix"
        about="Proposing or applying a fix."
        count={
          <Badge variant="outline" className="text-sm font-normal text-muted-foreground">
            Not available yet
          </Badge>
        }
        to={null}
        facts={<span>A later RepoScout stage.</span>}
      />
    </section>
  );
}
