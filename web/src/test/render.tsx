import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';
import { type Connection, ConnectionContext, RunContext } from '@/app/live';
import { routes } from '@/app/router';
import { ThemeProvider } from '@/app/theme';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { emptyLive, type LiveState } from '@/lib/live';
import { queryKeys } from '@/lib/queries';
import type { Overview } from '@/lib/types';

export interface ActionCall {
  action: string;
  body: Record<string, unknown>;
}

// Answers the dashboard's requests from the fixture; an action answers with `actions[name]` (an error status
// and message when it is a string) and is recorded in order.
export function stubServer(overview: Overview, actions: Record<string, (body: Record<string, unknown>) => string | object> = {}) {
  const calls: ActionCall[] = [];
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/overview') return json(200, overview);
      if (url === '/api/session') return json(200, { token: 't' });
      const action = /^\/api\/actions\/(.+)$/.exec(url)?.[1];
      if (action) {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        calls.push({ action, body });
        const answer = actions[action]?.(body) ?? {};
        return typeof answer === 'string' ? json(409, { error: answer }) : json(200, answer);
      }
      return json(200, []);
    }),
  );
  return calls;
}

export function renderApp(
  path: string,
  { overview, live = emptyLive(), connection = 'live' }: { overview: Overview; live?: LiveState; connection?: Connection },
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(queryKeys.overview, overview);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const user = userEvent.setup();
  const result = render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={0}>
          <ConnectionContext.Provider value={connection}>
            <RunContext.Provider value={live}>
              <RouterProvider router={router} />
            </RunContext.Provider>
          </ConnectionContext.Provider>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return { ...result, router, queryClient, user };
}

export const searchOf = (router: ReturnType<typeof createMemoryRouter>) => new URLSearchParams(router.state.location.search);
