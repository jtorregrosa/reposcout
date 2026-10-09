import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queries';

type Action = Exclude<keyof typeof api, 'overview' | 'runEvents' | 'findingHistory' | 'stageHistory' | 'validationAttempts'>;
type Input<A extends Action> = Parameters<(typeof api)[A]>[0];
type Output<A extends Action> = Awaited<ReturnType<(typeof api)[A]>>;

const SUCCESS: Record<Action, string> = {
  startRun: 'Run started. It keeps running if you close this page.',
  cancel: 'Cancel requested. The run stops within a few seconds.',
  forceStop: 'Run process killed.',
  suppress: 'Suppressed in repos.yaml. State catches up on the next run.',
  unsuppress: 'Suppression removed from repos.yaml. The finding is reported again from the next run.',
  openInEditor: 'Opened in VS Code.',
  decide: 'Decision recorded. It holds across runs.',
  undecide: 'Decision withdrawn.',
  label: 'Labels saved. They hold across runs.',
};

export function useInvalidateAfterAction() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.overview });
    void queryClient.invalidateQueries({ queryKey: queryKeys.finding.all });
  };
}

// Every dashboard action reports its outcome the same way and refreshes what it may have changed.
// `quiet` leaves the toast and the refresh to the caller, for actions run in a batch.
export function useAction<A extends Action>(action: A, { quiet = false } = {}) {
  const invalidate = useInvalidateAfterAction();
  const fn = api[action] as (arg: Input<A>) => Promise<Output<A>>;
  return useMutation<Output<A>, Error, Input<A>>({
    mutationFn: (arg) => fn(arg),
    onSuccess: () => {
      if (quiet) return;
      toast.success(SUCCESS[action]);
      invalidate();
    },
    onError: (e) => {
      if (!quiet) toast.error(e.message);
    },
  });
}
