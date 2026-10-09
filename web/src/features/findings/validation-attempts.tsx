import { useQuery } from '@tanstack/react-query';
import { FlaskConical } from 'lucide-react';
import { useId } from 'react';
import { VALIDATION_OUTCOME_LABEL } from '@/lib/domain';
import { formatDateTime } from '@/lib/format';
import { validationsQuery } from '@/lib/queries';
import type { FindingView } from '@/lib/types';

// Matches the CLI: after this many unsuccessful tries a validation pass stops picking the finding.
const MAX_UNSUCCESSFUL_ATTEMPTS = 2;

export function ValidationAttempts({ finding: f }: { finding: FindingView }) {
  const titleId = useId();
  const { data } = useQuery(validationsQuery(f));
  if (!data?.length) return null;
  const unsuccessful = data.filter((a) => a.outcome !== 'reproduced').length;
  return (
    <section className="space-y-1.5" aria-labelledby={titleId}>
      <h3 id={titleId} className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        <FlaskConical className="size-3.5" />
        Validation attempts
      </h3>
      <ul className="space-y-1.5 text-sm">
        {data.map((a) => (
          <li key={a.run_id}>
            <span className="font-medium">{VALIDATION_OUTCOME_LABEL[a.outcome]}</span>
            <span className="text-muted-foreground"> · {formatDateTime(a.at)}</span>
            {a.reason ? <p className="wrap-anywhere text-muted-foreground">{a.reason}</p> : null}
          </li>
        ))}
      </ul>
      {f.status === 'open' && f.stage === 'detected' && unsuccessful >= MAX_UNSUCCESSFUL_ATTEMPTS ? (
        <p className="text-xs text-muted-foreground">Validation passes no longer try this finding. Confirm or refute it yourself.</p>
      ) : null}
    </section>
  );
}
