import { OctagonX, Square } from 'lucide-react';
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useAction } from '@/hooks/use-actions';
import { useNow } from '@/hooks/use-now';

// A run that has not stopped this long after a cancel can be killed outright.
const FORCE_AFTER_MS = 15_000;

export function CancelRun({ runId }: { runId: string | null }) {
  const cancel = useAction('cancel');
  const force = useAction('forceStop');
  // Remembered with the run it was for, so a cancel never carries over to the next run.
  const [request, setRequest] = useState<{ runId: string | null; at: number } | null>(null);
  const requestedAt = request?.runId === runId ? request.at : null;
  const now = useNow(requestedAt != null);

  return (
    <div className="flex items-center gap-2">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline" disabled={requestedAt != null}>
            <Square />
            {requestedAt != null ? 'Cancelling…' : 'Cancel run'}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel the run in progress?</AlertDialogTitle>
            <AlertDialogDescription>
              Nothing is written to state for the repository being audited; it keeps its previous state and is audited again next time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep running</AlertDialogCancel>
            <AlertDialogAction onClick={() => cancel.mutate(undefined, { onSuccess: () => setRequest({ runId, at: Date.now() }) })}>
              Cancel run
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {requestedAt != null && now - requestedAt > FORCE_AFTER_MS ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive">
              <OctagonX />
              Force stop
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Kill the run's processes?</AlertDialogTitle>
              <AlertDialogDescription>
                The run has not stopped by itself. Killing it is safe: state is only written after a repository succeeds.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Wait</AlertDialogCancel>
              <AlertDialogAction onClick={() => force.mutate(undefined)}>Force stop</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  );
}
