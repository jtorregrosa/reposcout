import { FlaskConical, Lightbulb, ListOrdered } from 'lucide-react';
import type { ReactNode } from 'react';
import { CopyButton } from '@/components/copy-button';
import { Prose } from '@/components/prose';
import { ReproSteps } from '@/components/repro-steps';
import { RelativeTime } from '@/components/time';
import { Badge } from '@/components/ui/badge';
import { shortSha } from '@/lib/format';
import type { FindingView } from '@/lib/types';
import { cn } from '@/lib/utils';
import { FindingHistory } from './finding-history';
import { StageTimeline } from './stage-timeline';
import { ValidationAttempts } from './validation-attempts';

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

// What is wrong, how it breaks and how to fix it.
export function OverviewTab({ finding: f }: { finding: FindingView }) {
  return (
    <div className="space-y-6">
      <Section title="Scenario">
        <Prose text={f.scenario} />
      </Section>
      {f.snippet ? (
        <Section title={`Code at line ${f.line}`}>
          <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">{f.snippet}</pre>
        </Section>
      ) : null}
      <Section title="Why it is a bug">
        <Prose text={f.description} />
      </Section>
      {f.repro ? (
        <Section title="How to reproduce" icon={<ListOrdered className="size-3.5" />}>
          <ReproSteps repro={f.repro} />
        </Section>
      ) : null}
      <Section title="Suggested fix" icon={<Lightbulb className="size-3.5" />} className="rounded-lg bg-muted/60 p-4">
        <Prose text={f.suggested_fix} />
      </Section>
    </div>
  );
}

// What backs the finding up: the verifier's confidence, the test that reproduced it, every attempt to.
export function EvidenceTab({ finding: f }: { finding: FindingView }) {
  return (
    <div className="space-y-6">
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
      </dl>
      {f.reproduction ? (
        <Section title="Reproduction test" icon={<FlaskConical className="size-3.5" />}>
          <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">{f.reproduction}</pre>
        </Section>
      ) : null}
      <ValidationAttempts finding={f} />
      {f.review_note ? <Section title="Last speculative review">{f.review_note}</Section> : null}
      {!f.reproduction && !f.review_note && !f.verified ? (
        <p className="text-sm text-muted-foreground">No test has reproduced this finding; the verifier confirmed it from the code.</p>
      ) : null}
    </div>
  );
}

// How the finding got here: its stages, every status it has had, and where it was last seen.
export function HistoryTab({ finding: f }: { finding: FindingView }) {
  return (
    <div className="space-y-6">
      <StageTimeline finding={f} />
      <dl className="grid grid-cols-3 gap-x-4 gap-y-2 text-sm">
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
  );
}
