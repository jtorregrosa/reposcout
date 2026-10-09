import { KIND_ICON } from '@/components/kind';
import { RelativeTime } from '@/components/time';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useAction } from '@/hooks/use-actions';
import { KIND_HELP, KIND_LABEL, KINDS, PERSONAL_DATA_HELP } from '@/lib/domain';
import type { FindingView, Kind } from '@/lib/types';

// The type and the personal-data mark come from the audit; an auditor corrects them here, and the correction holds
// across runs.
export function LabelsEditor({ finding: f }: { finding: FindingView }) {
  const label = useAction('label');
  const ref = { repo: f.repo, fingerprint: f.fingerprint };
  const override = f.labels_override;
  const kindId = `kind-${f.fingerprint}`;
  const personalId = `personal-${f.fingerprint}`;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <Label htmlFor={kindId} className="text-muted-foreground">
          Type
        </Label>
        <Select value={f.kind ?? ''} onValueChange={(v) => label.mutate({ ...ref, kind: v as Kind })} disabled={label.isPending}>
          <SelectTrigger id={kindId} size="sm" className="w-40" title={f.kind ? KIND_HELP[f.kind] : undefined}>
            <SelectValue placeholder="Not classified" />
          </SelectTrigger>
          <SelectContent>
            {KINDS.map((k) => {
              const Icon = KIND_ICON[k];
              return (
                <SelectItem key={k} value={k}>
                  <Icon aria-hidden />
                  {KIND_LABEL[k]}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2" title={PERSONAL_DATA_HELP}>
        <Switch
          id={personalId}
          checked={f.personal_data === true}
          onCheckedChange={(on) => label.mutate({ ...ref, personal_data: on })}
          disabled={label.isPending}
        />
        <Label htmlFor={personalId} className="text-muted-foreground">
          Personal data
        </Label>
      </div>
      {override ? (
        <span className="text-xs text-muted-foreground">
          Corrected by {override.set_by} <RelativeTime iso={override.set_at} />
        </span>
      ) : null}
    </div>
  );
}
