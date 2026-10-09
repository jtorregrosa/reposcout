import { useMutation, useQuery } from '@tanstack/react-query';
import { CircleAlert, Send } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useInvalidateAfterAction } from '@/hooks/use-actions';
import { ApiError, api } from '@/lib/api';
import { plural } from '@/lib/format';
import { jiraFormQuery, jiraParentsQuery } from '@/lib/queries';
import type { FindingView, FormValue, ParentRef, ReportForm, ReportOutcome } from '@/lib/types';
import { AsyncCombobox, type ComboOption } from './async-combobox';
import { FieldControl } from './field-control';

const isEmpty = (v: FormValue | null | undefined) => v == null || v === '' || (Array.isArray(v) && v.length === 0);

const parentOption = (p: ParentRef): ComboOption => ({ value: p.key, label: `${p.key} · ${p.summary}`, hint: p.type });

interface Target {
  project?: string;
  issueType?: string;
}

function ReportFormBody({
  repo,
  form,
  findings,
  onTarget,
  onCancel,
  onDone,
}: {
  repo: string;
  form: ReportForm;
  findings: FindingView[];
  onTarget: (t: Target) => void;
  onCancel: () => void;
  onDone: (outcomes: ReportOutcome[]) => void;
}) {
  const id = useId();
  const [project, setProject] = useState(form.project);
  const [parent, setParent] = useState<ComboOption | null>(form.parent ? parentOption(form.parent) : null);
  const [labels, setLabels] = useState(form.labels.join(' '));
  const [values, setValues] = useState<Record<string, FormValue | null>>(() =>
    Object.fromEntries(form.fields.filter((f) => f.default !== undefined).map((f) => [f.id, f.default as FormValue])),
  );
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<{ message: string; fields: Record<string, string> } | null>(null);
  const [outcomes, setOutcomes] = useState<ReportOutcome[] | null>(null);
  const invalidate = useInvalidateAfterAction();

  const report = useMutation({
    mutationFn: () =>
      api.report({
        repo,
        fingerprints: findings.map((f) => f.fingerprint),
        project: form.project,
        issue_type: form.issue_type,
        parent: parent?.value ?? null,
        labels: labels.split(/[\s,]+/).filter(Boolean),
        fields: Object.fromEntries(Object.entries(values).filter(([, v]) => !isEmpty(v))),
        summaries: Object.fromEntries(Object.entries(summaries).filter(([fp, s]) => s.trim() && s !== findings.find((f) => f.fingerprint === fp)?.title)),
      }),
    onSuccess: (result) => {
      invalidate();
      const created = result.flatMap((o) => ('key' in o ? [o] : []));
      if (created.length === result.length) {
        toast.success(created.length === 1 ? `Reported as ${created[0]?.key}.` : `${plural(created.length, 'issue')} created in Jira.`);
        onDone(result);
      } else setOutcomes(result);
    },
    onError: (e) => setFailure({ message: e.message, fields: e instanceof ApiError ? e.fields : {} }),
  });

  const missing = form.fields.filter((f) => f.required && isEmpty(values[f.id]));
  const blocked = form.fields.some((f) => f.required && f.kind === 'unsupported');
  const ready = !missing.length && !blocked && !form.unknown_defaults.length && !report.isPending;
  const many = findings.length > 1;

  if (outcomes) {
    const done = outcomes.filter((o) => o.ok).length;
    return (
      <div className="space-y-4">
        <Alert variant={done ? 'default' : 'destructive'}>
          <CircleAlert />
          <AlertTitle>
            {plural(done, 'issue')} created, {outcomes.length - done} refused
          </AlertTitle>
          <AlertDescription>
            <ul className="mt-1 space-y-1">
              {outcomes.map((o) => (
                <li key={o.fingerprint}>
                  <span className="font-medium">{findings.find((f) => f.fingerprint === o.fingerprint)?.title}</span>
                  {': '}
                  {'error' in o ? o.error : `reported as ${o.key}${o.adopted ? ' (an earlier report)' : ''}`}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
        <DialogFooter>
          <Button onClick={() => onDone(outcomes)}>Close</Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setFailure(null);
        if (ready) report.mutate();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-project`}>Project</Label>
          <Input
            id={`${id}-project`}
            value={project}
            onChange={(e) => setProject(e.target.value.toUpperCase())}
            onBlur={() => project !== form.project && onTarget({ project })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && project !== form.project) {
                e.preventDefault();
                onTarget({ project });
              }
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-type`}>Issue type</Label>
          <Select value={form.issue_type} onValueChange={(v) => onTarget({ project: form.project, issueType: v })}>
            <SelectTrigger id={`${id}-type`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {form.issue_types.map((t) => (
                <SelectItem key={t.id} value={t.name}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {form.parent_allowed ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-parent`}>Parent</Label>
          <AsyncCombobox
            id={`${id}-parent`}
            label="Parent"
            placeholder="Search by key or title"
            selected={parent}
            query={(q) => jiraParentsQuery(form.project, form.issue_type, q)}
            toOption={parentOption}
            onSelect={setParent}
            onClear={() => setParent(null)}
          />
          {form.parent_error ? <p className="text-xs text-warning">{form.parent_error}</p> : null}
        </div>
      ) : null}

      {many ? (
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">Summaries</legend>
          {findings.map((f) => (
            <Input
              key={f.fingerprint}
              aria-label={`Summary for ${f.title}`}
              value={summaries[f.fingerprint] ?? f.title}
              maxLength={255}
              onChange={(e) => setSummaries((s) => ({ ...s, [f.fingerprint]: e.target.value }))}
            />
          ))}
        </fieldset>
      ) : findings[0] ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-summary`}>Summary</Label>
          <Input
            id={`${id}-summary`}
            value={summaries[findings[0].fingerprint] ?? findings[0].title}
            maxLength={255}
            onChange={(e) => setSummaries({ [findings[0]?.fingerprint as string]: e.target.value })}
          />
        </div>
      ) : null}

      {form.fields.map((spec) => (
        <FieldControl
          key={spec.id}
          id={`${id}-${spec.id}`}
          spec={spec}
          project={form.project}
          value={values[spec.id] ?? null}
          onChange={(v) => setValues((cur) => ({ ...cur, [spec.id]: v }))}
          error={failure?.fields[spec.id]}
        />
      ))}

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-labels`}>Labels</Label>
        <Input id={`${id}-labels`} value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="Separated by spaces" />
        <p className="text-xs text-muted-foreground">
          RepoScout adds reposcout and a label with the fingerprint, which keeps a finding from being filed twice.
        </p>
      </div>

      {form.unknown_defaults.length ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Defaults in repos.yaml that do not fit</AlertTitle>
          <AlertDescription>
            <ul>
              {form.unknown_defaults.map((u) => (
                <li key={u.key}>{u.error}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      {failure ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Jira did not create the issue</AlertTitle>
          <AlertDescription>{failure.message}</AlertDescription>
        </Alert>
      ) : null}

      <DialogFooter className="items-center">
        {missing.length ? <p className="mr-auto text-xs text-muted-foreground">Required: {missing.map((f) => f.name).join(', ')}</p> : null}
        <Button type="button" variant="outline" onClick={onCancel} disabled={report.isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={!ready}>
          <Send />
          {report.isPending ? 'Creating…' : many ? `Create ${findings.length} issues` : 'Create issue'}
        </Button>
      </DialogFooter>
    </form>
  );
}

// Reports one finding, or several of one repository, as Jira issues.
export function ReportDialog({
  repo,
  findings,
  open,
  onOpenChange,
  onDone,
}: {
  repo: string;
  findings: FindingView[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: (outcomes: ReportOutcome[]) => void;
}) {
  const [target, setTarget] = useState<Target>({});
  const form = useQuery({ ...jiraFormQuery(repo, target.project, target.issueType), enabled: open });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-svh overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Report to Jira</DialogTitle>
          <DialogDescription>
            {findings.length > 1
              ? `One issue for each of the ${findings.length} findings, with the fields below.`
              : 'The issue carries the finding: where it is, why it is a bug, how to reproduce it and how to fix it.'}
          </DialogDescription>
        </DialogHeader>
        {form.isLoading ? (
          <div className="space-y-3" role="status" aria-label="Loading the Jira form">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
            <Skeleton className="h-24" />
          </div>
        ) : form.error ? (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>Jira could not be asked for this form</AlertTitle>
            <AlertDescription>
              {form.error.message}
              {target.project || target.issueType ? (
                <Button variant="link" size="sm" className="h-auto px-0" onClick={() => setTarget({})}>
                  Back to the repository's target
                </Button>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : form.data ? (
          <ReportFormBody
            key={`${form.data.project}|${form.data.issue_type}`}
            repo={repo}
            form={form.data}
            findings={findings}
            onTarget={setTarget}
            onCancel={() => onOpenChange(false)}
            onDone={(o) => {
              onOpenChange(false);
              onDone?.(o);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
