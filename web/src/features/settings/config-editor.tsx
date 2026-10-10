import { Lock, Pencil, RotateCcw } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAction, useInvalidateAfterAction } from '@/hooks/use-actions';
import type { ConfigView, FieldView, KeySpec, Origin, Scope } from '@/lib/types';

export interface FieldGroup {
  title: string;
  keys: string[];
}

export const REPO_GROUPS: FieldGroup[] = [
  { title: 'Repository', keys: ['name', 'provider', 'organization', 'project', 'repo', 'path', 'branch', 'pat_env'] },
  {
    title: 'What is audited',
    keys: ['mode', 'analyzers', 'max_files_per_run', 'max_files_full_run', 'max_file_bytes', 'focus_paths', 'focus_areas', 'excluded_paths', 'facts'],
  },
  {
    title: 'Claude',
    keys: [
      'claude.models.orchestrator',
      'claude.models.specialists',
      'claude.models.verifier',
      'claude.fallback_model',
      'claude.max_turns',
      'claude.subagent_max_turns.specialists',
      'claude.subagent_max_turns.verifier',
      'claude.timeout_minutes',
      'claude.auth',
    ],
  },
  { title: 'Verification', keys: ['test_command', 'test_command_unsandboxed'] },
  { title: 'Jira target', keys: ['jira.project', 'jira.issue_type', 'jira.parent', 'jira.labels', 'jira.fields'] },
];

const ORIGIN_LABEL: Record<Origin, string> = {
  repo: 'This repository',
  defaults: 'From defaults',
  derived: 'Derived',
  'built-in': 'Built-in default',
  unset: 'Not set',
};

const WARNING = {
  analyzers:
    'Open findings of an analyzer you remove stay open until a run includes that analyzer again, because only a run that includes it can resolve them.',
  facts: 'The auditors trust owner facts without checking them against the code, so a wrong fact silences real findings. Save only what you know holds.',
};

function originLabel(origin: Origin, scope: Scope): string {
  if (scope === 'defaults' && origin === 'defaults') return 'Set in defaults';
  if (scope === 'webhook' && origin === 'repo') return 'Set';
  return ORIGIN_LABEL[origin];
}

function Value({ value }: { value: unknown }) {
  if (value === undefined || value === null) return <span className="text-muted-foreground">not set</span>;
  if (typeof value === 'boolean') return <span>{value ? 'yes' : 'no'}</span>;
  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-muted-foreground">none</span>;
    return (
      <ul className="flex flex-wrap gap-1">
        {value.map((v) => (
          <li key={String(v)}>
            <Badge variant="secondary" className="font-mono font-normal">
              {String(v)}
            </Badge>
          </li>
        ))}
      </ul>
    );
  }
  if (typeof value === 'object') return <code className="text-xs">{JSON.stringify(value)}</code>;
  return <span className="font-mono text-sm">{String(value)}</span>;
}

type Draft = string | string[] | boolean;

function toDraft(spec: KeySpec, field: FieldView): Draft {
  const value = spec.appends ? (field.own ?? []) : field.value;
  if (spec.kind === 'boolean') return value === true;
  if (spec.kind === 'multi') return Array.isArray(value) ? value.map(String) : [];
  if (spec.kind === 'list') return Array.isArray(value) ? value.map(String).join('\n') : '';
  return value === undefined || value === null ? '' : String(value);
}

function fromDraft(spec: KeySpec, draft: Draft): unknown {
  if (spec.kind === 'int' || spec.kind === 'number') return draft === '' ? null : Number(draft);
  if (spec.kind === 'list')
    return String(draft)
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  return draft;
}

function Editor({ id, spec, draft, onChange }: { id: string; spec: KeySpec; draft: Draft; onChange: (d: Draft) => void }) {
  switch (spec.kind) {
    case 'enum':
      return (
        <Select value={String(draft)} onValueChange={onChange}>
          <SelectTrigger id={id} className="w-full sm:w-64" aria-label={spec.label}>
            <SelectValue placeholder="Choose…" />
          </SelectTrigger>
          <SelectContent>
            {(spec.options ?? []).map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case 'multi': {
      const chosen = draft as string[];
      return (
        <fieldset id={id} aria-label={spec.label} className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {(spec.options ?? []).map((o) => (
            <div key={o} className="flex items-center gap-2">
              <Checkbox
                id={`${id}-${o}`}
                checked={chosen.includes(o)}
                onCheckedChange={(on) => onChange(on ? [...chosen, o] : chosen.filter((x) => x !== o))}
              />
              <Label htmlFor={`${id}-${o}`} className="font-normal">
                {o}
              </Label>
            </div>
          ))}
        </fieldset>
      );
    }
    case 'boolean':
      return <Switch id={id} aria-label={spec.label} checked={draft === true} onCheckedChange={onChange} />;
    case 'list':
      return (
        <Textarea
          id={id}
          aria-label={spec.label}
          rows={4}
          className="font-mono text-sm"
          placeholder="One entry per line"
          value={String(draft)}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    default:
      return (
        <Input
          id={id}
          aria-label={spec.label}
          className="w-full sm:w-64"
          type={spec.kind === 'int' || spec.kind === 'number' ? 'number' : 'text'}
          placeholder={spec.kind === 'model' ? `${(spec.options ?? []).join(', ')} or a claude- model id` : undefined}
          value={String(draft)}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

function useConfigEdit() {
  const set = useAction('configSet', { quiet: true });
  const unset = useAction('configUnset', { quiet: true });
  const invalidate = useInvalidateAfterAction();
  const done = (message: string) => () => {
    toast.success(message);
    invalidate();
  };
  return { set, unset, done };
}

interface RowProps {
  field: FieldView;
  spec: KeySpec | undefined;
  label: string;
  scope: Scope;
  name?: string | undefined;
  showCounts: boolean;
}

function FieldRow({ field, spec, label, scope, name, showCounts }: RowProps) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { set, unset, done } = useConfigEdit();
  const id = `field-${scope}-${field.key}`;
  const editing = draft !== null && spec;
  const pending = set.isPending || unset.isPending;

  const save = () => {
    if (!spec || draft === null) return;
    setError(null);
    set.mutate(
      { scope, ...(name ? { name } : {}), key: field.key, value: fromDraft(spec, draft) },
      {
        onSuccess: () => {
          setDraft(null);
          done(`${label} saved to repos.yaml. The next run uses it.`)();
        },
        onError: (e) => setError(e.message),
      },
    );
  };
  const removesAnalyzer = () =>
    spec?.warn === 'analyzers' && Array.isArray(field.value) && (field.value as string[]).some((a) => !(draft as string[]).includes(a));
  const needsConfirm = () => spec?.warn === 'facts' || removesAnalyzer();

  const reset = () => {
    setError(null);
    unset.mutate(
      { scope, ...(name ? { name } : {}), key: field.key },
      { onSuccess: done(`${label} reset. The inherited value applies from the next run.`), onError: (e) => setError(e.message) },
    );
  };

  return (
    <div className="grid gap-2 py-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] sm:items-start" data-testid={id}>
      <div className="space-y-1">
        <Label htmlFor={editing ? id : undefined} className="text-sm font-medium">
          {label}
        </Label>
        <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <Badge variant={field.set_here ? 'default' : 'outline'} className="font-normal">
            {originLabel(field.origin, scope)}
          </Badge>
          {showCounts && field.inherited_by !== undefined ? (
            <span>
              inherited by {field.inherited_by} · overridden by {field.overridden_by ?? 0}
            </span>
          ) : null}
        </div>
      </div>
      <div className="min-w-0 space-y-2">
        {field.inherited?.length ? (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Inherited from defaults, changed there</p>
            <Value value={field.inherited} />
            <p className="text-xs text-muted-foreground">Added by this repository</p>
          </div>
        ) : null}
        {editing ? (
          <Editor id={id} spec={spec} draft={draft} onChange={setDraft} />
        ) : (
          <Value value={spec?.appends && scope !== 'defaults' && field.inherited?.length ? field.own : field.value} />
        )}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {!field.editable && field.reason ? (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Lock className="size-3" aria-hidden />
            {field.reason}
          </p>
        ) : null}
      </div>
      <div className="flex gap-1 sm:justify-end">
        {editing ? (
          <>
            <Button size="sm" variant="outline" onClick={() => setDraft(null)} disabled={pending}>
              Cancel
            </Button>
            <Button size="sm" disabled={pending} onClick={() => (needsConfirm() ? setConfirming(true) : save())}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
          </>
        ) : field.editable && spec ? (
          <>
            {field.set_here ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon-sm" variant="ghost" aria-label={`Reset ${label} to default`} onClick={reset} disabled={pending}>
                    <RotateCcw />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Reset to default</TooltipContent>
              </Tooltip>
            ) : null}
            <Button size="icon-sm" variant="ghost" aria-label={`Edit ${label}`} onClick={() => setDraft(toDraft(spec, field))}>
              <Pencil />
            </Button>
          </>
        ) : null}
      </div>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{spec?.warn === 'facts' ? 'Save these owner facts?' : 'Remove an analyzer?'}</AlertDialogTitle>
            <AlertDialogDescription>{spec?.warn ? WARNING[spec.warn] : null}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={save}>Save</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function ConfigFields({
  view,
  fields,
  groups,
  scope,
  name,
  showCounts = false,
  footer,
}: {
  view: ConfigView;
  fields: FieldView[];
  groups: FieldGroup[];
  scope: Scope;
  name?: string;
  showCounts?: boolean;
  footer?: ReactNode;
}) {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const specs = new Map(view.keys.map((k) => [k.key, k]));
  const labelOf = (key: string) => specs.get(key)?.label ?? view.read_only[key]?.label ?? key;
  return (
    <div className="space-y-6">
      {groups.map((group) => {
        const rows = group.keys.map((k) => byKey.get(k)).filter((f): f is FieldView => !!f);
        if (!rows.length) return null;
        return (
          <section key={group.title} aria-label={group.title}>
            <h3 className="text-sm font-semibold">{group.title}</h3>
            <div className="divide-y">
              {rows.map((f) => (
                <FieldRow key={f.key} field={f} spec={specs.get(f.key)} label={labelOf(f.key)} scope={scope} name={name} showCounts={showCounts} />
              ))}
            </div>
          </section>
        );
      })}
      {footer}
    </div>
  );
}
