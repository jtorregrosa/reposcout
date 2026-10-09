import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { jiraSprintsQuery, jiraUsersQuery } from '@/lib/queries';
import type { FieldSpec, FormValue, UserRef } from '@/lib/types';
import { AsyncCombobox, type ComboOption } from './async-combobox';

const NONE = '__none';

const userOption = (u: UserRef): ComboOption => ({ value: u.account_id, label: u.name });

interface ControlProps {
  id: string;
  spec: FieldSpec;
  project: string;
  value: FormValue | null;
  onChange: (value: FormValue | null) => void;
}

function SprintSelect({ id, spec, project, value, onChange }: ControlProps) {
  const { data = [], error } = useQuery(jiraSprintsQuery(project));
  return (
    <Select value={value == null ? NONE : String(value)} onValueChange={(v) => onChange(v === NONE ? null : Number(v))}>
      <SelectTrigger id={id} className="w-full" aria-label={spec.name}>
        <SelectValue placeholder={error ? 'Sprints could not be loaded' : 'No sprint'} />
      </SelectTrigger>
      <SelectContent>
        {spec.required ? null : <SelectItem value={NONE}>No sprint</SelectItem>}
        {data.map((s) => (
          <SelectItem key={s.id} value={String(s.id)}>
            {s.name}
            <span className="text-xs text-muted-foreground"> · {s.state}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Users chosen in this form, by account id, so a picked person keeps their name; a default shows its account id.
function useUserNames() {
  const [names, setNames] = useState<Record<string, string>>({});
  return [names, (o: ComboOption) => setNames((n) => ({ ...n, [o.value]: o.label }))] as const;
}

function UserPicker({ id, spec, project, value, onChange }: ControlProps) {
  const [names, remember] = useUserNames();
  const many = spec.kind === 'users';
  const chosen = many ? ((value as string[] | null) ?? []) : value ? [String(value)] : [];
  return (
    <div className="space-y-1.5">
      {many && chosen.length ? (
        <ul className="flex flex-wrap gap-1">
          {chosen.map((a) => (
            <li key={a}>
              <Badge variant="secondary" className="gap-1 pr-0.5">
                {names[a] ?? a}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="size-4 rounded-full"
                  aria-label={`Remove ${names[a] ?? a}`}
                  onClick={() => onChange(chosen.filter((x) => x !== a))}
                >
                  <X />
                </Button>
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
      <AsyncCombobox
        id={id}
        label={spec.name}
        placeholder={many ? 'Add a person' : 'Choose a person'}
        selected={!many && chosen[0] ? { value: chosen[0], label: names[chosen[0]] ?? chosen[0] } : null}
        query={(q) => jiraUsersQuery(project, q)}
        toOption={userOption}
        onSelect={(o) => {
          remember(o);
          onChange(many ? [...new Set([...chosen, o.value])] : o.value);
        }}
        onClear={many ? undefined : () => onChange(null)}
      />
    </div>
  );
}

function Control(props: ControlProps) {
  const { id, spec, value, onChange } = props;
  switch (spec.kind) {
    case 'select':
      return (
        <Select value={value == null ? NONE : String(value)} onValueChange={(v) => onChange(v === NONE ? null : v)}>
          <SelectTrigger id={id} className="w-full" aria-label={spec.name}>
            <SelectValue placeholder="Choose…" />
          </SelectTrigger>
          <SelectContent>
            {spec.required ? null : <SelectItem value={NONE}>None</SelectItem>}
            {(spec.options ?? []).map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case 'multiselect': {
      const chosen = (value as string[] | null) ?? [];
      return (
        <fieldset id={id} aria-label={spec.name} className="grid grid-cols-2 gap-1.5">
          {(spec.options ?? []).map((o) => (
            <div key={o.id} className="flex items-center gap-2">
              <Checkbox
                id={`${id}-${o.id}`}
                checked={chosen.includes(o.id)}
                onCheckedChange={(on) => onChange(on ? [...chosen, o.id] : chosen.filter((x) => x !== o.id))}
              />
              <Label htmlFor={`${id}-${o.id}`} className="font-normal">
                {o.label}
              </Label>
            </div>
          ))}
        </fieldset>
      );
    }
    case 'user':
    case 'users':
      return <UserPicker {...props} />;
    case 'sprint':
      return <SprintSelect {...props} />;
    case 'date':
      return <Input id={id} type="date" value={(value as string | null) ?? ''} onChange={(e) => onChange(e.target.value || null)} />;
    case 'number':
      return (
        <Input
          id={id}
          type="number"
          value={value == null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      );
    case 'textarea':
      return <Textarea id={id} rows={3} value={(value as string | null) ?? ''} onChange={(e) => onChange(e.target.value || null)} />;
    case 'text':
      return <Input id={id} value={(value as string | null) ?? ''} onChange={(e) => onChange(e.target.value || null)} />;
    default:
      return <p className="text-sm text-muted-foreground">Set this field in Jira after the issue is created.</p>;
  }
}

export function FieldControl({ error, ...props }: ControlProps & { error?: string }) {
  const { id, spec } = props;
  const message = error ?? spec.error;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {spec.name}
        {spec.required ? <span className="text-destructive"> *</span> : null}
        {spec.required ? <span className="sr-only"> (required)</span> : null}
      </Label>
      <Control {...props} />
      {message ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {message}
        </p>
      ) : null}
    </div>
  );
}
