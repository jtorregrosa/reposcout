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

// An answer with its own status and body, for an action or a lookup that fails the way the server would.
export const reply = (status: number, body: object) => ({ $status: status, $body: body });

type Answer = string | object;

const answer = (a: Answer) => {
  if (typeof a === 'string') return { status: 409, body: { error: a } };
  if ('$status' in a) {
    const r = a as unknown as { $status: number; $body: object };
    return { status: r.$status, body: r.$body };
  }
  return { status: 200, body: a };
};

// Answers the dashboard's requests from the fixture. An action answers with `actions[name]` (an error status and
// message when it is a string) and is recorded in order; a GET to a path in `gets` answers with what it returns.
export function stubServer(
  overview: Overview,
  actions: Record<string, (body: Record<string, unknown>) => Answer> = {},
  gets: Record<string, (query: URLSearchParams) => Answer> = {},
) {
  const calls: ActionCall[] = [];
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const [path = '', qs = ''] = url.split('?');
      const get = gets[path];
      if (get) {
        const a = answer(get(new URLSearchParams(qs)));
        return json(a.status, a.body);
      }
      if (url === '/api/overview') return json(200, overview);
      if (url === '/api/session') return json(200, { token: 't' });
      const action = /^\/api\/actions\/(.+)$/.exec(url)?.[1];
      if (action) {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        calls.push({ action, body });
        const a = answer(actions[action]?.(body) ?? {});
        return json(a.status, a.body);
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
