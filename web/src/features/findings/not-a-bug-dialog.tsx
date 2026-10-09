import { useId, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { commonActions, validReason } from '@/lib/actions';
import { plural } from '@/lib/format';
import type { FindingView } from '@/lib/types';
import { ReasonField } from './reason-field';
import { useVerdict, type VerdictOutcome } from './use-verdict';

type Choice = 'refute' | 'suppress';

const OPTION: Record<Choice, { title: string; body: string }> = {
  refute: {
    title: 'Refute',
    body: 'Records your verdict in the database. Later audits keep it refuted and are told it is a false positive, until you undo it or its code changes. Undo it from the finding.',
  },
  suppress: {
    title: 'Suppress',
    body: 'Writes the fingerprint and your reason to repos.yaml, so no later run reports it while its code stays the same. Other auditors see the reason. Unsuppress it from the finding.',
  },
};

function whyNothing(findings: FindingView[]): string {
  if (findings.length > 1)
    return 'These findings have no verdict in common: refute needs every one undecided and open or speculative, suppress needs every one open.';
  const f = findings[0];
  if (f?.decision) return 'An auditor already decided this finding. Undo that decision first, or suppress it once it is open.';
  return 'Only open findings and speculative candidates can be refuted or suppressed.';
}

// "Not a bug" has two reaches: a decision recorded in the database, or a suppression written to repos.yaml. One
// dialog offers whichever the findings allow, with one reason for either.
export function NotABugDialog({
  findings,
  open,
  onOpenChange,
  onDone,
}: {
  findings: FindingView[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: (outcome: VerdictOutcome) => void;
}) {
  const allowed = commonActions(findings);
  const choices = (['refute', 'suppress'] as const).filter((c) => allowed[c]);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [reason, setReason] = useState('');
  const id = useId();
  const picked = choice && choices.includes(choice) ? choice : (choices[0] ?? null);
  const { apply, pending, progress } = useVerdict((outcome) => {
    setReason('');
    onOpenChange(false);
    onDone?.(outcome);
  });
  const many = findings.length > 1;
  const subject = many ? plural(findings.length, 'finding') : findings[0]?.status === 'speculative' ? 'this candidate' : 'this finding';

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Not a bug</DialogTitle>
          <DialogDescription>How far should the verdict on {subject} reach?</DialogDescription>
        </DialogHeader>
        {picked ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (validReason(reason)) apply({ verdict: picked, findings, reason: reason.trim() });
            }}
          >
            <RadioGroup value={picked} onValueChange={(v) => setChoice(v as Choice)} aria-label="Verdict">
              {choices.map((c) => (
                <div key={c} className="flex items-start gap-2 rounded-md border p-3 has-data-[state=checked]:border-primary/50">
                  <RadioGroupItem id={`${id}-${c}`} value={c} className="mt-0.5" />
                  <Label htmlFor={`${id}-${c}`} className="flex flex-col items-start gap-1 font-normal">
                    <span className="font-medium">{OPTION[c].title}</span>
                    <span className="text-xs text-muted-foreground">{OPTION[c].body}</span>
                  </Label>
                </div>
              ))}
            </RadioGroup>
            <ReasonField
              label="Why is it not a bug?"
              placeholder="For example: every caller validates the value before it reaches this method."
              value={reason}
              onChange={setReason}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={!validReason(reason) || pending}>
                {pending && progress ? `${progress.done} of ${progress.total}…` : `${OPTION[picked].title}${many ? ` ${findings.length}` : ''}`}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <Alert>
            <AlertDescription>{whyNothing(findings)}</AlertDescription>
          </Alert>
        )}
      </DialogContent>
    </Dialog>
  );
}
