import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { useInvalidateAfterAction } from '@/hooks/use-actions';
import { api } from '@/lib/api';
import { plural } from '@/lib/format';
import type { FindingView } from '@/lib/types';

export type Verdict = 'confirm' | 'refute' | 'suppress';

export interface VerdictOutcome {
  verdict: Verdict;
  done: FindingView[];
  failed: { finding: FindingView; error: string }[];
}

const PAST: Record<Verdict, string> = { confirm: 'confirmed', refute: 'refuted', suppress: 'suppressed' };

export function describeOutcome(o: VerdictOutcome): string {
  const done = `${plural(o.done.length, 'finding')} ${PAST[o.verdict]}`;
  if (!o.failed.length) return `${done}.`;
  return `${done}; ${o.failed.length} refused: ${o.failed.map((f) => `${f.finding.title} (${f.error})`).join('; ')}.`;
}

const call = (verdict: Verdict, f: FindingView, reason: string) => {
  const ref = { repo: f.repo, fingerprint: f.fingerprint };
  if (verdict === 'suppress') return api.suppress({ ...ref, reason });
  return api.decide({ ...ref, decision: verdict === 'confirm' ? 'confirmed' : 'refuted', reason });
};

// Applies one verdict to one or many findings through the existing actions, one at a time: every suppression rewrites
// repos.yaml, so parallel calls would only race. A refusal stops nothing; each outcome is reported.
export function useVerdict(onSettled?: (outcome: VerdictOutcome) => void) {
  const invalidate = useInvalidateAfterAction();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const mutation = useMutation({
    mutationFn: async ({ verdict, findings, reason }: { verdict: Verdict; findings: FindingView[]; reason: string }): Promise<VerdictOutcome> => {
      const outcome: VerdictOutcome = { verdict, done: [], failed: [] };
      setProgress({ done: 0, total: findings.length });
      for (const f of findings) {
        try {
          await call(verdict, f, reason);
          outcome.done.push(f);
        } catch (e) {
          outcome.failed.push({ finding: f, error: e instanceof Error ? e.message : String(e) });
        }
        setProgress({ done: outcome.done.length + outcome.failed.length, total: findings.length });
      }
      return outcome;
    },
    onSuccess: (outcome) => {
      if (outcome.done.length) invalidate();
      const text = describeOutcome(outcome);
      if (outcome.failed.length) toast.error(text);
      else toast.success(text);
      onSettled?.(outcome);
    },
    onSettled: () => setProgress(null),
  });
  return { apply: mutation.mutate, pending: mutation.isPending, progress };
}
