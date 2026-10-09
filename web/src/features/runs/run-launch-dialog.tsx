import { CircleHelp, FlaskConical } from 'lucide-react';
import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useAction } from '@/hooks/use-actions';
import { useRunInProgress } from '@/hooks/use-run-in-progress';
import { plural } from '@/lib/format';
import type { LaunchScope } from '@/lib/selectors';

export type LaunchKind = 'validate' | 'speculative';

export const LAUNCH_LABEL: Record<LaunchKind, string> = {
  validate: 'Validate detected findings',
  speculative: 'Review speculative candidates',
};

const COPY: Record<LaunchKind, { title: string; what: (tries: string, extra: string) => string; budget: string; confirm: string; noun: string }> = {
  validate: {
    title: 'Reproduce detected findings with a test?',
    what: (tries, extra) =>
      `The verifier writes one test for each of ${tries}${extra} and runs test_command in a throwaway worktree. A reproduced finding becomes validated and moves to To report; the rest stay in Triage.`,
    budget: 'It spends subscription usage and stops before the 5-hour window passes 90%.',
    confirm: 'Validate',
    noun: 'open finding',
  },
  speculative: {
    title: 'Settle the speculative candidates?',
    what: (tries, extra) =>
      `The verifier looks again at ${tries}${extra} and confirms, refutes or marks each a duplicate. A confirmed one becomes an open finding.`,
    budget: 'It spends subscription usage: one Claude session per repository.',
    confirm: 'Review',
    noun: 'candidate',
  },
};

// Says what a validation pass or a speculative review will try and what it costs, then starts it.
export function RunLaunchDialog({
  kind,
  scope,
  open,
  onOpenChange,
}: {
  kind: LaunchKind;
  scope: LaunchScope;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const start = useAction('startRun');
  const running = useRunInProgress();
  const copy = COPY[kind];
  const extra = scope.waiting > scope.tries ? ` (of ${scope.waiting}, capped per repository)` : '';
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>
            {copy.what(plural(scope.tries, copy.noun), extra)} It runs in {scope.repos.join(', ')}. {copy.budget}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Not now</AlertDialogCancel>
          <AlertDialogAction
            disabled={running}
            onClick={() => start.mutate({ repos: scope.repos, mode: kind, max_files: null, analyzers: [], until_covered: false, session_limit: null })}
          >
            {running ? 'A run is in progress' : copy.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function RunLaunchButton({ kind, scope, size = 'default' }: { kind: LaunchKind; scope: LaunchScope; size?: 'default' | 'sm' }) {
  const [open, setOpen] = useState(false);
  const running = useRunInProgress();
  if (!scope.repos.length) return null;
  const Icon = kind === 'validate' ? FlaskConical : CircleHelp;
  return (
    <>
      <Button variant="outline" size={size} disabled={running} title={running ? 'A run is in progress' : undefined} onClick={() => setOpen(true)}>
        <Icon />
        {LAUNCH_LABEL[kind]}
        <span className="tabular-nums text-muted-foreground">{scope.tries}</span>
      </Button>
      <RunLaunchDialog kind={kind} scope={scope} open={open} onOpenChange={setOpen} />
    </>
  );
}
