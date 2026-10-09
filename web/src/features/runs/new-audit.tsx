import { useQuery } from '@tanstack/react-query';
import { Play, TriangleAlert } from 'lucide-react';
import { createContext, type ReactNode, useCallback, useContext, useId, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { useAction } from '@/hooks/use-actions';
import { useRunInProgress } from '@/hooks/use-run-in-progress';
import { ANALYZERS, CATEGORY_LABEL, MODE_HELP, MODE_LABEL, VERIFICATION_OFF } from '@/lib/domain';
import { overviewQuery } from '@/lib/queries';
import type { Analyzer, RepoView, StartRunBody } from '@/lib/types';

type Mode = StartRunBody['mode'];
const MODES = Object.keys(MODE_LABEL) as Mode[];
const MAX_FILES = 150;

export interface AuditPreset {
  repos?: string[];
  mode?: Mode;
}

const OpenContext = createContext<((preset?: AuditPreset) => void) | null>(null);

// One New audit dialog for the whole app, opened from any page or the command palette with its context preset.
export function NewAuditProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<{ preset: AuditPreset; seq: number } | null>(null);
  const open = useCallback((preset: AuditPreset = {}) => setRequest((r) => ({ preset, seq: (r?.seq ?? 0) + 1 })), []);
  return (
    <OpenContext.Provider value={open}>
      {children}
      {request ? <NewAuditDialog key={request.seq} preset={request.preset} onClose={() => setRequest(null)} /> : null}
    </OpenContext.Provider>
  );
}

export function useNewAudit() {
  const ctx = useContext(OpenContext);
  if (!ctx) throw new Error('useNewAudit outside NewAuditProvider');
  return ctx;
}

export function NewAuditButton({
  preset,
  label = 'New audit',
  variant = 'default',
  size = 'default',
}: {
  preset?: AuditPreset;
  label?: string;
  variant?: 'default' | 'outline';
  size?: 'default' | 'sm';
}) {
  const open = useNewAudit();
  const running = useRunInProgress();
  return (
    <Button variant={variant} size={size} disabled={running} title={running ? 'A run is in progress' : undefined} onClick={() => open(preset)}>
      <Play />
      {label}
    </Button>
  );
}

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
      {items.map((item) => {
        const why = unavailable(item);
        return (
          <div key={item} className="flex items-center gap-2">
            <Checkbox
              id={`${id}-${item}`}
              checked={selected.includes(item)}
              disabled={!!why}
              onCheckedChange={(on) => onChange(on ? [...selected, item] : selected.filter((x) => x !== item))}
            />
            <Label htmlFor={`${id}-${item}`} className="truncate font-normal">
              {label(item)}
              {why ? <span className="text-xs text-muted-foreground"> · {why}</span> : null}
            </Label>
          </div>
        );
      })}
    </div>
  );
}

const CAP_LABEL: Record<Mode, string> = {
  incremental: 'Files per repository',
  full: 'Files per repository',
  speculative: 'Candidates per repository',
  validate: 'Findings per repository',
};

const CAP_PLACEHOLDER: Record<Mode, string> = { incremental: 'From repos.yaml', full: 'From repos.yaml', speculative: '30', validate: '10' };

function NewAuditForm({ repos, preset, onDone, onCancel }: { repos: RepoView[]; preset: AuditPreset; onDone: () => void; onCancel: () => void }) {
  const verificationOf = new Map(repos.map((r) => [r.name, r.verification]));
  const [mode, setMode] = useState<Mode>(preset.mode ?? 'incremental');
  const [selectedRepos, setRepos] = useState<string[]>(preset.repos ?? []);
  const [analyzers, setAnalyzers] = useState<Analyzer[]>([]);
  const [maxFiles, setMaxFiles] = useState('');
  const [untilCovered, setUntilCovered] = useState(false);
  const [sessionLimit, setSessionLimit] = useState('90');
  const running = useRunInProgress();
  const start = useAction('startRun');
  const id = useId();

  const maxFilesValue = maxFiles === '' ? null : Number(maxFiles);
  const maxFilesValid = maxFilesValue == null || (Number.isInteger(maxFilesValue) && maxFilesValue >= 1 && maxFilesValue <= MAX_FILES);
  const sweep = mode === 'full' && untilCovered;
  const limit = Number(sessionLimit);
  const limitValid = !sweep || (Number.isInteger(limit) && limit >= 10 && limit <= 99);
  const validating = mode === 'validate';
  const unavailable = (name: string) => {
    const v = verificationOf.get(name);
    return validating && v && v !== 'on' ? VERIFICATION_OFF[v] : null;
  };
  const canValidate = repos.some((r) => r.verification === 'on');
  const scope = selectedRepos.length ? selectedRepos.join(', ') : validating ? 'every repository with verification on' : 'every repository';
  const which = analyzers.length ? analyzers.map((a) => CATEGORY_LABEL[a]).join(', ') : 'the analyzers configured per repository';
  const canSubmit = maxFilesValid && limitValid && !start.isPending && !running;

  const submit = () =>
    start.mutate(
      {
        repos: selectedRepos,
        mode,
        max_files: maxFilesValue,
        analyzers: validating || mode === 'speculative' ? [] : analyzers,
        until_covered: sweep,
        session_limit: sweep ? limit : null,
      },
      { onSuccess: onDone },
    );

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) submit();
      }}
    >
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">What to run</legend>
        <RadioGroup
          value={mode}
          onValueChange={(v) => {
            setMode(v as Mode);
            if (v === 'validate') setRepos((rs) => rs.filter((r) => verificationOf.get(r) === 'on'));
          }}
        >
          {MODES.map((m) => (
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
          <Label htmlFor={`${id}-max`}>{CAP_LABEL[mode]}</Label>
          <Input
            id={`${id}-max`}
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_FILES}
            placeholder={CAP_PLACEHOLDER[mode]}
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
          <AlertDescription>A whole-repository audit uses noticeably more of the subscription than one of the changes.</AlertDescription>
        </Alert>
      ) : null}

      <p className="rounded-md bg-muted p-3 text-sm">
        {MODE_LABEL[mode]} for <strong>{scope}</strong>
        {mode === 'speculative' ? '.' : validating ? '. Repositories with verification off are skipped.' : <> with {which}.</>}
        {sweep ? ` Repeats full passes, stopping before the 5-hour window passes ${sessionLimit}%.` : ''} It spends subscription usage.
      </p>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          {start.isPending ? 'Starting…' : running ? 'A run is in progress' : 'Start'}
        </Button>
      </DialogFooter>
    </form>
  );
}

function NewAuditDialog({ preset, onClose }: { preset: AuditPreset; onClose: () => void }) {
  const { data: ov } = useQuery(overviewQuery);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-svh overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New audit</DialogTitle>
          <DialogDescription>It runs in the background and keeps going if you close the dashboard.</DialogDescription>
        </DialogHeader>
        {ov ? <NewAuditForm repos={ov.repos} preset={preset} onDone={onClose} onCancel={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}
