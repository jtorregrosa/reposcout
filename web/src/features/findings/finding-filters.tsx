import { ListFilter, Milestone, RotateCcw, Search, Tag, UserRound } from 'lucide-react';
import { forwardRef } from 'react';
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
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { CATEGORIES, CATEGORY_LABEL, KIND_LABEL, KINDS, PERSONAL_DATA_HELP, SEVERITIES, STAGE_HELP, STAGE_LABEL, STAGES } from '@/lib/domain';
import type { FindingFilters, KindFilter, SortKey } from '@/lib/findings';
import type { Category, Severity, Stage } from '@/lib/types';

const ALL = '__all';

interface Props {
  filters: FindingFilters;
  repos: string[];
  severityCounts: Partial<Record<Severity, number>>;
  categoryCounts: Partial<Record<Category, number>>;
  kindCounts: Partial<Record<KindFilter, number>>;
  stageCounts: Partial<Record<Stage, number>>;
  personalDataCount: number;
  onChange: (patch: Partial<FindingFilters>) => void;
  onReset: () => void;
}

export const FindingFiltersBar = forwardRef<HTMLInputElement, Props>(function FindingFiltersBar(
  { filters, repos, severityCounts, categoryCounts, kindCounts, stageCounts, personalDataCount, onChange, onReset },
  searchRef,
) {
  const dirty =
    filters.repo ||
    filters.severities.length ||
    filters.categories.length ||
    filters.kinds.length ||
    filters.stages.length ||
    filters.personalData ||
    filters.q ||
    filters.sort !== 'severity';
  const kindOptions: KindFilter[] = [...KINDS, 'unset'];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full min-w-72 lg:w-auto lg:flex-1">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={searchRef}
          type="search"
          value={filters.q}
          onChange={(e) => onChange({ q: e.target.value })}
          placeholder="Search title, file, description or fingerprint"
          aria-label="Search findings"
          className="pr-10 pl-8"
        />
        <Kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">/</Kbd>
      </div>

      <Select value={filters.repo ?? ALL} onValueChange={(v) => onChange({ repo: v === ALL ? null : v })}>
        <SelectTrigger className="w-52" aria-label="Repository">
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
        value={filters.severities}
        onValueChange={(v) => onChange({ severities: SEVERITIES.filter((s) => v.includes(s)) })}
        aria-label="Severity"
      >
        {SEVERITIES.map((s) => (
          <ToggleGroupItem key={s} value={s} aria-label={`${s} severity`} className="gap-1.5 capitalize">
            <SeverityDot severity={s} />
            {s}
            <span className="tabular-nums text-muted-foreground">{severityCounts[s] ?? 0}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Tag />
            Type
            {filters.kinds.length ? <Badge variant="secondary">{filters.kinds.length}</Badge> : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>What it asks of you</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {kindOptions.map((k) => {
            const Icon = k === 'unset' ? null : KIND_ICON[k];
            return (
              <DropdownMenuCheckboxItem
                key={k}
                checked={filters.kinds.includes(k)}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={(on) => onChange({ kinds: on ? [...filters.kinds, k] : filters.kinds.filter((x) => x !== k) })}
              >
                {Icon ? <Icon aria-hidden /> : null}
                <span className="flex-1">{k === 'unset' ? 'Not classified' : KIND_LABEL[k]}</span>
                <span className="tabular-nums text-muted-foreground">{kindCounts[k] ?? 0}</span>
              </DropdownMenuCheckboxItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <ListFilter />
            Category
            {filters.categories.length ? <Badge variant="secondary">{filters.categories.length}</Badge> : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Analyzer that found it</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {CATEGORIES.map((c) => (
            <DropdownMenuCheckboxItem
              key={c}
              checked={filters.categories.includes(c)}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(on) => onChange({ categories: on ? [...filters.categories, c] : filters.categories.filter((x) => x !== c) })}
            >
              <span className="flex-1">{CATEGORY_LABEL[c]}</span>
              <span className="tabular-nums text-muted-foreground">{categoryCounts[c] ?? 0}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Milestone />
            Stage
            {filters.stages.length ? <Badge variant="secondary">{filters.stages.length}</Badge> : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>How far it has progressed</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {STAGES.map((s) => (
            <DropdownMenuCheckboxItem
              key={s}
              checked={filters.stages.includes(s)}
              title={STAGE_HELP[s]}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(on) => onChange({ stages: on ? [...filters.stages, s] : filters.stages.filter((x) => x !== s) })}
            >
              <span className="flex-1">{STAGE_LABEL[s]}</span>
              <span className="tabular-nums text-muted-foreground">{stageCounts[s] ?? 0}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Toggle
        variant="outline"
        size="sm"
        pressed={filters.personalData}
        onPressedChange={(on) => onChange({ personalData: on })}
        aria-label="Only findings involving personal data"
        title={PERSONAL_DATA_HELP}
      >
        <UserRound />
        Personal data
        <span className="tabular-nums text-muted-foreground">{personalDataCount}</span>
      </Toggle>

      <Select value={filters.sort} onValueChange={(v) => onChange({ sort: v as SortKey })}>
        <SelectTrigger size="sm" className="w-44" aria-label="Sort by">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="severity">Most severe first</SelectItem>
          <SelectItem value="newest">Newest first</SelectItem>
          <SelectItem value="location">By file</SelectItem>
        </SelectContent>
      </Select>

      {dirty ? (
        <Button variant="ghost" size="sm" onClick={onReset}>
          <RotateCcw />
          Reset
        </Button>
      ) : null}
    </div>
  );
});
