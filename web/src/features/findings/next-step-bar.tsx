import { CircleCheck, CircleX, ClipboardCopy, CodeXml, Copy, Eye, Fingerprint, MoreHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import { copyText } from '@/components/copy-button';
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Kbd } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAction } from '@/hooks/use-actions';
import type { AvailableActions } from '@/lib/actions';
import { queueOf } from '@/lib/queues';
import { findingMarkdown } from '@/lib/report/markdown';
import type { FindingView } from '@/lib/types';

function WithKey({ shortcut, children }: { shortcut: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>
        Shortcut <Kbd>{shortcut}</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}

function UnsuppressButton({ finding }: { finding: FindingView }) {
  const unsuppress = useAction('unsuppress');
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm">
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

const copyTicket = (f: FindingView) => copyText(findingMarkdown(f), 'Finding copied as Markdown');

// What moves the finding on from its queue comes first; the rest waits in More.
export function NextStepBar({
  finding: f,
  actions,
  onConfirm,
  onNotABug,
  onOpen,
}: {
  finding: FindingView;
  actions: AvailableActions;
  onConfirm: () => void;
  onNotABug: () => void;
  onOpen: () => void;
}) {
  const queue = queueOf(f);
  const reporting = queue === 'report' || queue === 'reported';
  const notABug = actions.refute || actions.suppress;
  const steps: ReactNode[] = [];
  if (queue === 'triage' && actions.confirm)
    steps.push(
      <WithKey key="confirm" shortcut="C">
        <Button size="sm" onClick={onConfirm}>
          <CircleCheck />
          Confirm…
        </Button>
      </WithKey>,
    );
  if (reporting)
    steps.push(
      <Button key="ticket" size="sm" onClick={() => copyTicket(f)}>
        <ClipboardCopy />
        Copy for a ticket
      </Button>,
    );
  if (notABug)
    steps.push(
      <WithKey key="not-a-bug" shortcut="X">
        <Button size="sm" variant="outline" onClick={onNotABug}>
          <CircleX />
          Not a bug…
        </Button>
      </WithKey>,
    );
  if (actions.unsuppress) steps.push(<UnsuppressButton key="unsuppress" finding={f} />);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-2">
      {steps.length ? (
        <fieldset className="flex min-w-0 flex-wrap items-center gap-2">
          <legend className="float-left px-1 text-xs font-medium text-muted-foreground">Next step</legend>
          {steps}
        </fieldset>
      ) : (
        <span className="px-1 text-xs text-muted-foreground">Nothing is asked of you here.</span>
      )}
      <div className="ml-auto flex items-center gap-1">
        <WithKey shortcut="O">
          <Button size="sm" variant="ghost" onClick={onOpen}>
            <CodeXml />
            Open in VS Code
          </Button>
        </WithKey>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label="More actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {reporting ? null : (
              <DropdownMenuItem onSelect={() => copyTicket(f)}>
                <ClipboardCopy />
                Copy for a ticket
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => copyText(`${f.file}:${f.line}`, 'Location copied')}>
              <Copy />
              Copy file and line
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => copyText(f.fingerprint, 'Fingerprint copied')}>
              <Fingerprint />
              Copy fingerprint
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
