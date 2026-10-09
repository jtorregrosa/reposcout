import { useSyncExternalStore } from 'react';

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const media = window.matchMedia(query);
      media.addEventListener('change', notify);
      return () => media.removeEventListener('change', notify);
    },
    () => window.matchMedia(query).matches,
  );
}

// Tailwind's lg breakpoint: from here the findings list and the detail sit side by side.
export const useIsWide = () => useMediaQuery('(min-width: 64rem)');
