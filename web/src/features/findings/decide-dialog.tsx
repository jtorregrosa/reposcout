import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAction } from '@/hooks/use-actions';
import type { FindingView } from '@/lib/types';

const MIN = 3;
const MAX = 300;

export type Verdict = 'confirmed' | 'refuted';

const COPY: Record<Verdict, { title: string; description: string; label: string; placeholder: string; submit: string }> = {
  confirmed: {
    title: 'Confirm this candidate',
    description:
      'It becomes an open finding. Use it when you know the fact the verifier could not check, such as how the service is deployed or how much data it handles. The decision holds across runs, and a later audit that still sees it as speculative keeps it open.',
    label: 'What confirms it?',
    placeholder: 'For example: contact lists reach 300,000 rows in production, so the whole list is loaded per page.',
    submit: 'Confirm as a finding',
  },
  refuted: {
    title: 'Refute this candidate',
    description:
      'It leaves the speculative queue and is not raised again while its code stays the same. Use it when the fact the verifier could not check rules it out.',
    label: 'What rules it out?',
    placeholder: 'For example: the ingress caps request bodies at 30 MB, whatever Kestrel allows.',
    submit: 'Refute candidate',
  },
};

export function DecideDialog({ finding, verdict, onOpenChange }: { finding: FindingView; verdict: Verdict | null; onOpenChange: (open: boolean) => void }) {
  const [reason, setReason] = useState('');
  const decide = useAction('decide');
  const id = useId();
  const length = reason.trim().length;
  const valid = length >= MIN && length <= MAX;
  const copy = COPY[verdict ?? 'confirmed'];

  const submit = () => {
    if (!valid || !verdict) return;
    decide.mutate(
      { repo: finding.repo, fingerprint: finding.fingerprint, decision: verdict, reason: reason.trim() },
      {
        onSuccess: () => {
          setReason('');
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={verdict != null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        {finding.unconfirmed ? (
          <p className="rounded-md bg-muted p-3 text-sm">
            <span className="font-medium">The verifier could not check: </span>
            {finding.review_note ?? finding.unconfirmed}
          </p>
        ) : null}
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Label htmlFor={id}>{copy.label}</Label>
          <Textarea
            id={id}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={MAX}
            rows={4}
            placeholder={copy.placeholder}
            aria-describedby={`${id}-count`}
            autoFocus
          />
          <p id={`${id}-count`} className="text-right text-xs text-muted-foreground tabular-nums">
            {length < MIN ? `At least ${MIN} characters` : `${length} / ${MAX}`}
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant={verdict === 'refuted' ? 'destructive' : 'default'} disabled={!valid || decide.isPending}>
              {decide.isPending ? 'Saving…' : copy.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
