import { Play, TriangleAlert } from 'lucide-react';
import { useId, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { useAction } from '@/hooks/use-actions';
import { ANALYZERS, CATEGORY_LABEL, MODE_HELP, MODE_LABEL, VERIFICATION_OFF } from '@/lib/domain';
import type { Analyzer, RepoView, StartRunBody } from '@/lib/types';

type Mode = StartRunBody['mode'];
const MAX_FILES = 150;

function CheckList<T extends string>({
  items,
  selected,
  onChange,
  label,
  unavailable = () => null,
}: {
  items: readonly T[];
  selected: T[];
  onChange: (v: T[]) => void;
  label: (v: T) => string;
  // Why an item cannot be ticked, or null when it can.
  unavailable?: (v: T) => string | null;
}) {
  const id = useId();
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map((item) => (
        <div key={item} className="flex items-center gap-2">
          <Checkbox
            id={`${id}-${item}`}
            checked={selected.includes(item)}
            disabled={!!unavailable(item)}
            onCheckedChange={(on) => onChange(on ? [...selected, item] : selected.filter((x) => x !== item))}
          />
          <Label htmlFor={`${id}-${item}`} className="truncate font-normal">
            {label(item)}
            {unavailable(item) ? <span className="text-xs text-muted-foreground"> · {unavailable(item)}</span> : null}
          </Label>
        </div>
      ))}
    </div>
  );
}

export function StartAuditDialog({ repos, disabled }: { repos: Pick<RepoView, 'name' | 'verification'>[]; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [selectedRepos, setRepos] = useState<string[]>([]);
  const [analyzers, setAnalyzers] = useState<Analyzer[]>([]);
  const [mode, setMode] = useState<Mode>('incremental');
  const [maxFiles, setMaxFiles] = useState('');
  const [untilCovered, setUntilCovered] = useState(false);
  const [sessionLimit, setSessionLimit] = useState('90');
  const start = useAction('startRun');
  const id = useId();

  const maxFilesValue = maxFiles === '' ? null : Number(maxFiles);
  const maxFilesValid = maxFilesValue == null || (Number.isInteger(maxFilesValue) && maxFilesValue >= 1 && maxFilesValue <= MAX_FILES);
  const sweep = mode === 'full' && untilCovered;
  const limit = Number(sessionLimit);
  const limitValid = !sweep || (Number.isInteger(limit) && limit >= 10 && limit <= 99);
  const validating = mode === 'validate';
  const verificationOf = new Map(repos.map((r) => [r.name, r.verification]));
  const unavailable = (name: string) => {
    const v = verificationOf.get(name);
    return validating && v && v !== 'on' ? VERIFICATION_OFF[v] : null;
  };
  const canValidate = repos.some((r) => r.verification === 'on');
  const scope = selectedRepos.length ? selectedRepos.join(', ') : validating ? 'every repository with verification on' : 'every repository';
  const which = analyzers.length ? analyzers.map((a) => CATEGORY_LABEL[a]).join(', ') : 'the analyzers configured per repository';

  const submit = () =>
    start.mutate(
      {
        repos: selectedRepos,
        mode,
        max_files: maxFilesValue,
        analyzers: validating ? [] : analyzers,
        until_covered: sweep,
        session_limit: sweep ? limit : null,
      },
      { onSuccess: () => setOpen(false) },
    );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={disabled}>
          <Play />
          New audit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-svh overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Start an audit</DialogTitle>
          <DialogDescription>It runs in the background and keeps going if you close the dashboard.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (maxFilesValid && limitValid) submit();
          }}
        >
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Mode</legend>
            <RadioGroup
              value={mode}
              onValueChange={(v) => {
                setMode(v as Mode);
                if (v === 'validate') setRepos((rs) => rs.filter((r) => verificationOf.get(r) === 'on'));
              }}
            >
              {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
                <div key={m} className="flex items-start gap-2">
                  <RadioGroupItem id={`${id}-${m}`} value={m} className="mt-0.5" disabled={m === 'validate' && !canValidate} />
                  <Label htmlFor={`${id}-${m}`} className="flex flex-col items-start gap-0.5 font-normal">
                    <span className="font-medium">{MODE_LABEL[m]}</span>
                    <span className="text-xs text-muted-foreground">{MODE_HELP[m]}</span>
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              Repositories <span className="font-normal text-muted-foreground">· none ticked means all</span>
            </legend>
            <CheckList items={repos.map((r) => r.name)} selected={selectedRepos} onChange={setRepos} label={(r) => r} unavailable={unavailable} />
          </fieldset>

          {mode !== 'speculative' && !validating ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">
                Analyzers <span className="font-normal text-muted-foreground">· none ticked means as configured; the verifier always runs</span>
              </legend>
              <CheckList items={ANALYZERS} selected={analyzers} onChange={setAnalyzers} label={(a) => CATEGORY_LABEL[a]} />
            </fieldset>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-max`}>
                {mode === 'speculative' ? 'Candidates to review' : validating ? 'Findings per repository' : 'Files per repository'}
              </Label>
              <Input
                id={`${id}-max`}
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_FILES}
                placeholder={mode === 'speculative' ? '30' : validating ? '10' : 'From repos.yaml'}
                value={maxFiles}
                onChange={(e) => setMaxFiles(e.target.value)}
                aria-invalid={!maxFilesValid}
              />
              <p className="text-xs text-muted-foreground">Up to {MAX_FILES}. Larger runs risk hitting the subscription limit mid-run.</p>
            </div>
            {mode === 'full' ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Switch id={`${id}-sweep`} checked={untilCovered} onCheckedChange={setUntilCovered} />
                  <Label htmlFor={`${id}-sweep`}>Repeat until every file is covered</Label>
                </div>
                {untilCovered ? (
                  <div className="space-y-1.5">
                    <Label htmlFor={`${id}-limit`} className="text-xs font-normal text-muted-foreground">
                      Stop before the 5-hour window passes (%)
                    </Label>
                    <Input
                      id={`${id}-limit`}
                      type="number"
                      min={10}
                      max={99}
                      value={sessionLimit}
                      onChange={(e) => setSessionLimit(e.target.value)}
                      aria-invalid={!limitValid}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {mode === 'full' ? (
            <Alert className="border-warning/40">
              <TriangleAlert className="text-warning" />
              <AlertDescription>A full audit uses noticeably more of the subscription than an incremental one.</AlertDescription>
            </Alert>
          ) : null}

          <p className="rounded-md bg-muted p-3 text-sm">
            {validating ? 'Validation' : `${MODE_LABEL[mode]} audit`} of <strong>{scope}</strong>
            {mode === 'speculative' ? '.' : validating ? '. Repositories with verification off are skipped.' : <> with {which}.</>}
            {sweep ? ` Repeats full passes, stopping before the 5-hour window passes ${sessionLimit}%.` : ''}
          </p>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!maxFilesValid || !limitValid || start.isPending}>
              {start.isPending ? 'Starting…' : 'Start audit'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
