import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { validReason } from '@/lib/actions';
import type { FindingView } from '@/lib/types';
import { ReasonField } from './reason-field';
import { useVerdict } from './use-verdict';

const COPY = {
  candidate: {
    title: 'Confirm this candidate',
    description:
      'It becomes an open finding. Use it when you know the fact the verifier could not check, such as how the service is deployed or how much data it handles. The decision holds across runs, and a later audit that still sees it as speculative keeps it open.',
    placeholder: 'For example: contact lists reach 300,000 rows in production, so the whole list is loaded per page.',
    submit: 'Confirm as a finding',
  },
  finding: {
    title: 'Confirm this finding',
    description:
      'It stays open, moves to the validated stage and leaves Triage for To report. Use it when you have checked the bug yourself, by following the code path or reproducing it by hand. The decision is recorded with your reason and can be undone.',
    placeholder: 'For example: posting an empty list to /orders returns 500 on the staging environment.',
    submit: 'Confirm finding',
  },
};

export function ConfirmDialog({ finding, open, onOpenChange }: { finding: FindingView; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [reason, setReason] = useState('');
  const { apply, pending } = useVerdict(() => {
    setReason('');
    onOpenChange(false);
  });
  const copy = COPY[finding.status === 'open' ? 'finding' : 'candidate'];
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
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
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (validReason(reason)) apply({ verdict: 'confirm', findings: [finding], reason: reason.trim() });
          }}
        >
          <ReasonField label="What confirms it?" placeholder={copy.placeholder} value={reason} onChange={setReason} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!validReason(reason) || pending}>
              {pending ? 'Saving…' : copy.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
