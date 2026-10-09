import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { OVERVIEW_KEY } from './use-overview';

type Action = Exclude<keyof typeof api, 'overview' | 'runEvents' | 'findingHistory' | 'stageHistory'>;
type Input<A extends Action> = Parameters<(typeof api)[A]>[0];
type Output<A extends Action> = Awaited<ReturnType<(typeof api)[A]>>;

const SUCCESS: Record<Action, string> = {
  startRun: 'Audit started. It keeps running if you close this page.',
  cancel: 'Cancel requested. The run stops within a few seconds.',
  forceStop: 'Run process killed.',
  suppress: 'Suppressed in repos.yaml. State catches up on the next run.',
  unsuppress: 'Suppression removed from repos.yaml. The finding is reported again from the next run.',
  openInEditor: 'Opened in VS Code.',
  decide: 'Decision recorded. It holds across runs.',
  undecide: 'Decision withdrawn. The candidate is speculative again.',
  label: 'Labels saved. They hold across runs.',
};

// Every dashboard action reports its outcome the same way and refreshes the overview it may have changed.
export function useAction<A extends Action>(action: A) {
  const queryClient = useQueryClient();
  const fn = api[action] as (arg: Input<A>) => Promise<Output<A>>;
  return useMutation<Output<A>, Error, Input<A>>({
    mutationFn: (arg) => fn(arg),
    onSuccess: () => {
      toast.success(SUCCESS[action]);
      void queryClient.invalidateQueries({ queryKey: OVERVIEW_KEY });
      void queryClient.invalidateQueries({ queryKey: ['finding-history'] });
      void queryClient.invalidateQueries({ queryKey: ['finding-stages'] });
    },
    onError: (e) => toast.error(e.message),
  });
}
