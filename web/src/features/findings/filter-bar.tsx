import { ListFilter, RotateCcw, Search, X } from 'lucide-react';
import type { Ref } from 'react';
import { KIND_ICON } from '@/components/kind';
import { SeverityDot } from '@/components/severity';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  CATEGORIES,
  CATEGORY_LABEL,
  KIND_LABEL,
  PERSONAL_DATA_HELP,
  SEVERITIES,
  STAGE_HELP,
  STAGE_LABEL,
  STAGES,
  STATUS_HELP,
  STATUS_LABEL,
} from '@/lib/domain';
import { type FindingsView, filterChips, isFiltered, KIND_FILTERS, SORT_KEYS, SORT_LABEL, type SortKey, STATUSES } from '@/lib/findings-view';
import type { FacetCounts } from '@/lib/selectors';

const ALL = '__all';

type ListFacet = 'kinds' | 'categories' | 'stages' | 'statuses';

function FacetItems<T extends string>({
  facet,
  label,
  options,
  view,
  counts,
  name,
  help,
  onChange,
}: {
  facet: ListFacet;
  label: string;
  options: readonly T[];
  view: FindingsView;
  counts: Partial<Record<T, number>>;
  name: (v: T) => string;
  help?: (v: T) => string;
  onChange: (patch: Partial<FindingsView>) => void;
}) {
  const current = view[facet] as T[];
  return (
    <>
      <DropdownMenuLabel>{label}</DropdownMenuLabel>
      {options.map((o) => (
        <DropdownMenuCheckboxItem
          key={o}
          checked={current.includes(o)}
          title={help?.(o)}
          onSelect={(e) => e.preventDefault()}
          onCheckedChange={(on) => onChange({ [facet]: on ? options.filter((x) => x === o || current.includes(x)) : current.filter((x) => x !== o) })}
        >
          <span className="flex-1">{name(o)}</span>
          <span className="tabular-nums text-muted-foreground">{counts[o] ?? 0}</span>
        </DropdownMenuCheckboxItem>
      ))}
      <DropdownMenuSeparator />
    </>
  );
}

interface Props {
  searchRef?: Ref<HTMLInputElement>;
  view: FindingsView;
  repos: string[];
  counts: FacetCounts;
  onChange: (patch: Partial<FindingsView>) => void;
  onReset: () => void;
}

// What is used on every visit stays visible; the rest folds into one Filters menu and shows as chips once set.
export function FilterBar({ searchRef, view, repos, counts, onChange, onReset }: Props) {
  const chips = filterChips(view);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full min-w-64 lg:w-auto lg:flex-1">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            type="search"
            value={view.q}
            onChange={(e) => onChange({ q: e.target.value })}
            placeholder="Search title, file, description or fingerprint"
            aria-label="Search findings"
            className="pr-10 pl-8"
          />
          <Kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">/</Kbd>
        </div>

        <Select value={view.repo ?? ALL} onValueChange={(v) => onChange({ repo: v === ALL ? null : v })}>
          <SelectTrigger className="w-48" aria-label="Repository">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All repositories</SelectItem>
            {repos.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <ToggleGroup
          type="multiple"
          variant="outline"
          size="sm"
          value={view.severities}
          onValueChange={(v) => onChange({ severities: SEVERITIES.filter((s) => v.includes(s)) })}
          aria-label="Severity"
        >
          {SEVERITIES.map((s) => (
            <ToggleGroupItem key={s} value={s} aria-label={`${s} severity`} className="gap-1.5 capitalize">
              <SeverityDot severity={s} />
              {s}
              <span className="tabular-nums text-muted-foreground">{counts.severities[s] ?? 0}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <ListFilter />
              Filters
              {chips.length ? <Badge variant="secondary">{chips.length}</Badge> : null}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-(--radix-dropdown-menu-content-available-height) w-64 overflow-y-auto">
            <FacetItems
              facet="kinds"
              label="Type: what it asks of you"
              options={KIND_FILTERS}
              view={view}
              counts={counts.kinds}
              name={(k) => (k === 'unset' ? 'Not classified' : KIND_LABEL[k])}
              onChange={onChange}
            />
            <FacetItems
              facet="categories"
              label="Category: the analyzer that found it"
              options={CATEGORIES}
              view={view}
              counts={counts.categories}
              name={(c) => CATEGORY_LABEL[c]}
              onChange={onChange}
            />
            <FacetItems
              facet="stages"
              label="Stage: how far it has progressed"
              options={STAGES}
              view={view}
              counts={counts.stages}
              name={(s) => STAGE_LABEL[s]}
              help={(s) => STAGE_HELP[s]}
              onChange={onChange}
            />
            <FacetItems
              facet="statuses"
              label="Status"
              options={STATUSES}
              view={view}
              counts={counts.statuses}
              name={(s) => STATUS_LABEL[s]}
              help={(s) => STATUS_HELP[s]}
              onChange={onChange}
            />
            <DropdownMenuLabel>Other</DropdownMenuLabel>
            <DropdownMenuCheckboxItem checked={view.newOnly} onSelect={(e) => e.preventDefault()} onCheckedChange={(on) => onChange({ newOnly: on })}>
              <span className="flex-1">New in the last run</span>
              <span className="tabular-nums text-muted-foreground">{counts.newOnly}</span>
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={view.personalData}
              title={PERSONAL_DATA_HELP}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(on) => onChange({ personalData: on })}
            >
              <span className="flex-1">Involves personal data</span>
              <span className="tabular-nums text-muted-foreground">{counts.personalData}</span>
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Select value={view.sort} onValueChange={(v) => onChange({ sort: v as SortKey })}>
          <SelectTrigger size="sm" className="w-40" aria-label="Sort by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_KEYS.map((k) => (
              <SelectItem key={k} value={k}>
                {SORT_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {isFiltered(view) ? (
          <Button variant="ghost" size="sm" onClick={onReset}>
            <RotateCcw />
            Reset
          </Button>
        ) : null}
      </div>

      {chips.length ? (
        <ul aria-label="Active filters" className="flex flex-wrap gap-1.5">
          {chips.map((c) => {
            const Icon = c.key.startsWith('kinds:') && c.key !== 'kinds:unset' ? KIND_ICON[c.key.slice(6) as keyof typeof KIND_ICON] : null;
            return (
              <li key={c.key}>
                <Badge variant="secondary" className="gap-1 pr-0.5">
                  {Icon ? <Icon aria-hidden /> : null}
                  {c.label}
                  <Button variant="ghost" size="icon-xs" className="size-4 rounded-full" aria-label={`Remove ${c.label}`} onClick={() => onChange(c.patch)}>
                    <X />
                  </Button>
                </Badge>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
