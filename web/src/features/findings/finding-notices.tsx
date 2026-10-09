import { CircleCheck, CircleX, Copy, EyeOff, Info, Undo2 } from 'lucide-react';
import { Link, useLocation } from 'react-router';
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
import { Button } from '@/components/ui/button';
import { useAction } from '@/hooks/use-actions';
import { parseFindingsView, serializeFindingsView } from '@/lib/findings-view';
import { formatDateTime } from '@/lib/format';
import type { FindingView } from '@/lib/types';

// A duplicate names the candidate kept in its place; the link opens that one on All with the same filters.
function DuplicateNotice({ finding }: { finding: FindingView }) {
  const { search } = useLocation();
  const kept = /\b[0-9a-f]{32}\b/.exec(finding.resolution ?? '')?.[0];
  const href = `?${serializeFindingsView({ ...parseFindingsView(new URLSearchParams(search)), queue: 'all', statuses: [], id: kept ?? null }).toString()}`;
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

const WITHDRAWN: Record<'speculative' | 'open-confirmed' | 'open-refuted', string> = {
  speculative: 'The candidate goes back to speculative, and the next speculative review looks at it again.',
  'open-confirmed': 'The finding stays open and returns to the stage it had before the confirmation.',
  'open-refuted': 'The finding goes back to open, and later audits report it again while they still find it.',
};

// Who decided this finding and why, with a way back if the decision was wrong.
function DecisionNotice({ finding }: { finding: FindingView }) {
  const undo = useAction('undecide');
  const d = finding.decision;
  if (!d) return null;
  const confirmed = d.verdict === 'confirmed';
  return (
    <Alert className={confirmed ? 'border-success/30' : ''}>
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
                {WITHDRAWN[d.decided_on === 'open' ? (`open-${d.verdict}` as const) : 'speculative']} The withdrawal is recorded in its history.
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

// What was decided about the finding, or what is still open about it: always above the tabs.
export function FindingNotices({ finding: f }: { finding: FindingView }) {
  return (
    <>
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
    </>
  );
}
