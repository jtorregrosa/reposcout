import { CircleCheck, CircleX, Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAction } from '@/hooks/use-actions';
import type { NewRepoBody, TestResult } from '@/lib/types';

const OUTCOME: Record<TestResult['result'], string> = {
  reachable: 'Reachable',
  'branch-missing': 'Branch missing',
  'no-access': 'Not found or no access',
  'token-missing': 'Token missing',
  failed: 'Connection failed',
};

const EMPTY = { provider: 'azure-devops' as NewRepoBody['provider'], organization: '', project: '', repo: '', name: '', branch: '' };

function toBody(form: typeof EMPTY): NewRepoBody {
  const trimmed = (v: string) => v.trim() || undefined;
  const body: NewRepoBody = { provider: form.provider, organization: form.organization.trim(), repo: form.repo.trim() };
  const name = trimmed(form.name);
  const branch = trimmed(form.branch);
  const project = form.provider === 'azure-devops' ? trimmed(form.project) : undefined;
  if (name) body.name = name;
  if (branch) body.branch = branch;
  if (project) body.project = project;
  return body;
}

function TextField({
  id,
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function AddRepository() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [test, setTest] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tester = useAction('repoTest', { quiet: true });
  const add = useAction('repoAdd');
  const navigate = useNavigate();
  const update = (patch: Partial<typeof EMPTY>) => {
    setForm((f) => ({ ...f, ...patch }));
    setTest(null);
    setError(null);
  };
  const ado = form.provider === 'azure-devops';
  const complete = !!form.organization.trim() && !!form.repo.trim() && (!ado || !!form.project.trim());

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setForm(EMPTY);
          setTest(null);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <Plus />
          Add repository
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a repository</DialogTitle>
          <DialogDescription>
            It is added to repos.yaml with these keys only and takes everything else from defaults. The name and location cannot change once it has a history.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!complete) return;
            const body = toBody(form);
            add.mutate(body, {
              onSuccess: (r) => {
                setOpen(false);
                navigate(`/repositories/${encodeURIComponent(r.added)}?tab=configuration`);
              },
              onError: (err) => setError(err.message),
            });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="new-repo-provider">Provider</Label>
            <Select value={form.provider} onValueChange={(v) => update({ provider: v as NewRepoBody['provider'] })}>
              <SelectTrigger id="new-repo-provider" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="azure-devops">Azure DevOps</SelectItem>
                <SelectItem value="github">GitHub</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField id="new-repo-org" label={ado ? 'Organization' : 'Owner'} value={form.organization} onChange={(v) => update({ organization: v })} />
            {ado ? <TextField id="new-repo-project" label="Project" value={form.project} onChange={(v) => update({ project: v })} /> : null}
            <TextField id="new-repo-repo" label="Repository" value={form.repo} onChange={(v) => update({ repo: v })} />
            <TextField id="new-repo-branch" label="Branch" placeholder="main" value={form.branch} onChange={(v) => update({ branch: v })} />
            <TextField
              id="new-repo-name"
              label="Name in RepoScout"
              placeholder={form.repo || 'the repository'}
              hint="Its findings and runs are stored under this name."
              value={form.name}
              onChange={(v) => update({ name: v })}
            />
          </div>
          {test ? (
            <Alert variant={test.result === 'reachable' ? 'default' : 'destructive'}>
              {test.result === 'reachable' ? <CircleCheck /> : <CircleX />}
              <AlertTitle>{OUTCOME[test.result]}</AlertTitle>
              <AlertDescription>{test.detail}</AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={!complete || tester.isPending}
              onClick={() => tester.mutate(toBody(form), { onSuccess: setTest, onError: (err) => setError(err.message) })}
            >
              {tester.isPending ? 'Testing…' : 'Test connection'}
            </Button>
            <Button type="submit" disabled={!complete || add.isPending}>
              {add.isPending ? 'Adding…' : 'Add repository'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
