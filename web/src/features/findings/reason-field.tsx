import { useId } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { REASON_MAX, REASON_MIN } from '@/lib/actions';

export function ReasonField({ label, placeholder, value, onChange }: { label: string; placeholder: string; value: string; onChange: (v: string) => void }) {
  const id = useId();
  const length = value.trim().length;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={REASON_MAX}
        rows={4}
        placeholder={placeholder}
        aria-describedby={`${id}-count`}
        aria-invalid={length > 0 && length < REASON_MIN}
        autoFocus
      />
      <p id={`${id}-count`} className="text-right text-xs text-muted-foreground tabular-nums">
        {length < REASON_MIN ? `At least ${REASON_MIN} characters` : `${length} / ${REASON_MAX}`}
      </p>
    </div>
  );
}
