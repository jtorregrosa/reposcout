import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAction } from '@/hooks/use-actions';
import type { FindingView } from '@/lib/types';

const MIN = 3;
const MAX = 300;

export function SuppressDialog({ finding, open, onOpenChange }: { finding: FindingView; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [reason, setReason] = useState('');
  const suppress = useAction('suppress');
  const id = useId();
  const length = reason.trim().length;
  const valid = length >= MIN && length <= MAX;

  const submit = () => {
    if (!valid) return;
    suppress.mutate(
      { repo: finding.repo, fingerprint: finding.fingerprint, reason: reason.trim() },
      {
        onSuccess: () => {
          setReason('');
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Suppress as a false positive</DialogTitle>
          <DialogDescription>
            The fingerprint and your reason are written to <code className="font-mono">repos.yaml</code>, so the finding is never reported again while its code
            stays the same. Other auditors see the reason. You can undo it at any time.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Label htmlFor={id}>Why is this not a bug?</Label>
          <Textarea
            id={id}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={MAX}
            rows={4}
            placeholder="For example: the value comes from trusted configuration, never from a request."
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
            <Button type="submit" disabled={!valid || suppress.isPending}>
              {suppress.isPending ? 'Suppressing…' : 'Suppress finding'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
