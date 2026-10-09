import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { type FindingsView, parseFindingsView, serializeFindingsView } from '@/lib/findings-view';

// The Findings view lives in the URL, so it can be bookmarked, shared with another auditor and walked back with
// the browser's back button. Moving the selection or switching tabs replaces the entry instead of pushing one.
export function useFindingsView() {
  const [params, setParams] = useSearchParams();
  const view = useMemo(() => parseFindingsView(params), [params]);

  const update = useCallback(
    (patch: Partial<FindingsView>, { replace = false } = {}) =>
      setParams((prev) => serializeFindingsView({ ...parseFindingsView(prev), ...patch }), { replace }),
    [setParams],
  );

  const reset = useCallback(() => setParams(new URLSearchParams()), [setParams]);

  return { view, update, reset };
}
