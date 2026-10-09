import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { emptyLive } from '@/lib/live';
import { overview } from '@/test/fixtures';
import { renderApp, stubServer } from '@/test/render';

const LATEST = 'run-2026-10-09T08-00-00-000Z';
const OLDER = 'run-2026-10-08T08-00-00-000Z';

const runs = () =>
  overview({
    runs: [
      { run_id: LATEST, date: '2026-10-09', bytes: 1 },
      { run_id: OLDER, date: '2026-10-08', bytes: 1 },
    ],
  });

describe('the Runs page', () => {
  it('replays a past run picked from the list and names it in the URL', async () => {
    const ov = runs();
    stubServer(ov);
    const fetchJson = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input).includes(`/api/runs/${OLDER}/events`)
          ? new Response(
              JSON.stringify([
                { ts: '2026-10-08T08:00:00.000Z', type: 'run_started', repos: ['billing'], mode: 'full' },
                { ts: '2026-10-08T08:05:00.000Z', type: 'repo_finished', repo: 'billing', status: 'ok', new: 1, resolved: 0 },
              ]),
              { status: 200 },
            )
          : fetchJson(input, init),
      ),
    );
    const { user, router } = renderApp('/runs', { overview: ov });
    const list = await screen.findByRole('navigation', { name: 'Runs' });
    const links = within(list).getAllByRole('link');
    await user.click(links[1] as HTMLElement);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/runs/${OLDER}`));
    expect(await screen.findByText('billing')).toBeInTheDocument();
    expect(links[1]).toHaveAttribute('aria-current', 'page');
  });

  it('lists the run in progress first, marked live', async () => {
    const ov = runs();
    stubServer(ov);
    renderApp('/runs', { overview: ov, live: emptyLive(LATEST, true) });
    const list = await screen.findByRole('navigation', { name: 'Runs' });
    const first = within(list).getAllByRole('link')[0] as HTMLElement;
    expect(within(first).getByText('Live')).toBeInTheDocument();
  });
});
