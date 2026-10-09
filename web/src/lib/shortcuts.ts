// Every keyboard shortcut, as the shortcut list shows it. Handlers bind by id, so the list cannot drift from them.
export const SHORTCUTS = {
  palette: { keys: ['Ctrl', 'K'], group: 'Anywhere', label: 'Open the command palette' },
  help: { keys: ['?'], group: 'Anywhere', label: 'Show keyboard shortcuts' },
  next: { keys: ['J'], group: 'Findings list', label: 'Next finding (or Down arrow)' },
  previous: { keys: ['K'], group: 'Findings list', label: 'Previous finding (or Up arrow)' },
  select: { keys: ['Space'], group: 'Findings list', label: 'Add or remove the finding from the selection' },
  search: { keys: ['/'], group: 'Findings list', label: 'Search findings' },
  close: { keys: ['Esc'], group: 'Findings list', label: 'Close the finding' },
  confirm: { keys: ['C'], group: 'Finding', label: 'Confirm…' },
  notABug: { keys: ['X'], group: 'Finding', label: 'Not a bug…' },
  open: { keys: ['O'], group: 'Finding', label: 'Open in VS Code' },
} as const;

export type ShortcutId = keyof typeof SHORTCUTS;

// The key values each shortcut answers to, as KeyboardEvent.key reports them.
export const KEYS: Record<ShortcutId, string[]> = {
  palette: ['k'],
  help: ['?'],
  next: ['j', 'J', 'ArrowDown'],
  previous: ['k', 'K', 'ArrowUp'],
  select: [' '],
  search: ['/'],
  close: ['Escape'],
  confirm: ['c', 'C'],
  notABug: ['x', 'X'],
  open: ['o', 'O'],
};
