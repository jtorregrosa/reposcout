import { useEffect, useLayoutEffect, useRef } from 'react';
import { KEYS, type ShortcutId } from '@/lib/shortcuts';

export type HotkeyMap = Partial<Record<ShortcutId, (e: KeyboardEvent) => void>>;

const typingIn = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

// Space already presses a focused control.
const pressable = (e: KeyboardEvent) =>
  e.key === ' ' && e.target instanceof HTMLElement && !!e.target.closest('button, [role="checkbox"], [role="tab"], [role="switch"]');

const dialogOpen = () => !!document.querySelector('[role="dialog"], [role="alertdialog"]');

// Plain keys act only outside fields and dialogs and without a modifier. A `chord` shortcut needs Ctrl or ⌘ and
// works everywhere, including in a field.
export function useHotkeys(map: HotkeyMap, { enabled = true, chord = [] as ShortcutId[] } = {}) {
  const latest = useRef(map);
  const chords = useRef(chord);
  useLayoutEffect(() => {
    latest.current = map;
    chords.current = chord;
  });

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const modified = e.ctrlKey || e.metaKey;
      for (const [id, handler] of Object.entries(latest.current) as [ShortcutId, (e: KeyboardEvent) => void][]) {
        if (!KEYS[id].includes(e.key)) continue;
        if (chords.current.includes(id)) {
          if (!modified || e.altKey) continue;
        } else if (modified || e.altKey || typingIn(e.target) || pressable(e) || dialogOpen()) continue;
        e.preventDefault();
        handler(e);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
