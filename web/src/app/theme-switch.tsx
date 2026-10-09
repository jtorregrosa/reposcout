import { Monitor, Moon, Sun } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { type Theme, useTheme } from './theme';

const OPTIONS: { value: Theme; label: string; hint: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', hint: 'Light theme', icon: Sun },
  { value: 'dark', label: 'Dark', hint: 'Dark theme', icon: Moon },
  { value: 'system', label: 'Auto', hint: 'Follow the operating system', icon: Monitor },
];

// Always visible in the header: one click to switch, and the current choice is plain to see.
export function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={theme}
      onValueChange={(v) => {
        if (v) setTheme(v as Theme);
      }}
      aria-label="Colour theme"
    >
      {OPTIONS.map(({ value, label, hint, icon: Icon }) => (
        <Tooltip key={value}>
          <TooltipTrigger asChild>
            <ToggleGroupItem value={value} aria-label={hint} className="gap-1.5 px-2.5">
              <Icon />
              <span className="hidden sm:inline">{label}</span>
            </ToggleGroupItem>
          </TooltipTrigger>
          <TooltipContent>{hint}</TooltipContent>
        </Tooltip>
      ))}
    </ToggleGroup>
  );
}
