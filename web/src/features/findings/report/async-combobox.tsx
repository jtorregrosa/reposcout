import { type QueryKey, type UseQueryOptions, useQuery } from '@tanstack/react-query';
import { ChevronsUpDown, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDebounced } from '@/hooks/use-jira';

export interface ComboOption {
  value: string;
  label: string;
  hint?: string;
}

// A picker whose options come from a search on the server, such as Jira people or parent issues.
export function AsyncCombobox<T, K extends QueryKey>({
  id,
  label,
  placeholder,
  selected,
  query,
  toOption,
  onSelect,
  onClear,
}: {
  id: string;
  label: string;
  placeholder: string;
  selected: ComboOption | null;
  query: (q: string) => UseQueryOptions<T[], Error, T[], K>;
  toOption: (item: T) => ComboOption;
  onSelect: (option: ComboOption) => void;
  onClear?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const term = useDebounced(q);
  const { data = [], isFetching, error } = useQuery({ ...query(term), enabled: open });
  const options = data.map(toOption);
  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={label}
            className="min-w-0 flex-1 justify-between font-normal"
          >
            <span className="truncate">{selected ? selected.label : <span className="text-muted-foreground">{placeholder}</span>}</span>
            <ChevronsUpDown className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Search…" value={q} onValueChange={setQ} />
            <CommandList>
              <CommandEmpty>{error ? error.message : isFetching ? 'Searching…' : 'Nothing found.'}</CommandEmpty>
              <CommandGroup>
                {options.map((o) => (
                  <CommandItem
                    key={o.value}
                    value={o.value}
                    onSelect={() => {
                      onSelect(o);
                      setOpen(false);
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.hint ? <span className="shrink-0 text-xs text-muted-foreground">{o.hint}</span> : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selected && onClear ? (
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Clear ${label}`} onClick={onClear}>
          <X />
        </Button>
      ) : null}
    </div>
  );
}
