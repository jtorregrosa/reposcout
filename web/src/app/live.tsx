import { useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { applyEvents, emptyLive, type LiveState } from '@/lib/live';
import { queryKeys } from '@/lib/queries';
import type { LiveRunInfo, RunEvent } from '@/lib/types';

export type Connection = 'connecting' | 'live' | 'down';

// Two contexts: the connection changes rarely, the run state once per animation frame during a run, and most
// readers want only one of them.
export const ConnectionContext = createContext<Connection | null>(null);
export const RunContext = createContext<LiveState | null>(null);

// One EventSource for the whole app: the run in progress (or the latest one) stays live on every page, and a
// change on disk refreshes the overview everywhere at once.
export function LiveProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [connection, setConnection] = useState<Connection>('connecting');
  const [live, setLive] = useState<LiveState>(() => emptyLive());
  const pending = useRef<RunEvent[]>([]);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const flush = () => {
      frame.current = null;
      const batch = pending.current;
      pending.current = [];
      if (batch.length) setLive((s) => applyEvents(s, batch));
    };
    const es = new EventSource('/api/live');
    // A reconnect means the server came back: whatever failed to load meanwhile is fetched again.
    es.addEventListener('open', () => {
      setConnection('live');
      void queryClient.invalidateQueries({ queryKey: queryKeys.overview });
    });
    es.addEventListener('error', () => setConnection('down'));
    es.addEventListener('run', (e) => {
      const info = JSON.parse((e as MessageEvent<string>).data) as LiveRunInfo;
      pending.current = [];
      setLive(emptyLive(info.run_id, info.active));
    });
    es.addEventListener('run_state', (e) => {
      const { active } = JSON.parse((e as MessageEvent<string>).data) as { active: boolean };
      setLive((s) => ({ ...s, active }));
    });
    es.addEventListener('events', (e) => {
      pending.current.push(...(JSON.parse((e as MessageEvent<string>).data) as RunEvent[]));
      frame.current ??= requestAnimationFrame(flush);
    });
    es.addEventListener('overview_changed', () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.overview });
      void queryClient.invalidateQueries({ queryKey: queryKeys.finding.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.config });
    });
    return () => {
      es.close();
      if (frame.current != null) cancelAnimationFrame(frame.current);
    };
  }, [queryClient]);

  return (
    <ConnectionContext.Provider value={connection}>
      <RunContext.Provider value={live}>{children}</RunContext.Provider>
    </ConnectionContext.Provider>
  );
}

export function useConnection(): Connection {
  const ctx = useContext(ConnectionContext);
  if (ctx == null) throw new Error('useConnection outside LiveProvider');
  return ctx;
}

export function useRun(): LiveState {
  const ctx = useContext(RunContext);
  if (!ctx) throw new Error('useRun outside LiveProvider');
  return ctx;
}

export function useLive() {
  return { connection: useConnection(), live: useRun() };
}
