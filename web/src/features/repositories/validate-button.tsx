import { FlaskConical } from 'lucide-react';
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
import { plural } from '@/lib/format';

// The CLI's default cap on the findings one validation pass tries per repository.
const VALIDATION_LIMIT = 10;

export function ValidateButton({ repo, toValidate, disabled }: { repo: string; toValidate: number; disabled: boolean }) {
  const start = useAction('startRun');
  const tries = Math.min(toValidate, VALIDATION_LIMIT);
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" disabled={disabled || start.isPending}>
          <FlaskConical />
          Validate detected findings
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Try to reproduce detected findings with a test?</AlertDialogTitle>
          <AlertDialogDescription>
            The verifier writes one test for each of {plural(tries, 'open finding')} still at detected
            {toValidate > tries ? ` (of ${toValidate})` : ''} and runs test_command in a throwaway worktree. A reproduced finding becomes validated; the rest
            stay as they are. It spends subscription usage and stops before the 5-hour window passes 90%.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Not now</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => start.mutate({ repos: [repo], mode: 'validate', max_files: null, analyzers: [], until_covered: false, session_limit: null })}
          >
            Validate
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
