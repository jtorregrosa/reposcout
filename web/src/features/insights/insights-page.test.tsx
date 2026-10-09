import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { UsageRow } from '@/lib/types';
import { overview, repo } from '@/test/fixtures';
import { renderApp, stubServer } from '@/test/render';

const at = new Date(Date.now() - 3_600_000).toISOString();

const usage = (repoName: string, cost: number): UsageRow => ({
  date: at.slice(0, 10),
  at,
  repo: repoName,
  mode: 'incremental',
  analyzers: [],
  files: 3,
  ok: true,
  terminal_reason: null,
  rate_limit: null,
  wall_ms: 60_000,
  cost_usd_equivalent: cost,
  run_id: `run-${repoName}`,
});

describe('the Insights page', () => {
  it('narrows the rows, totals and headline to one repository', async () => {
    const ov = overview({
      repos: [repo({ name: 'api' }), repo({ name: 'web' })],
      usage: [usage('api', 4), usage('web', 9)],
      run_results: [
        { run_id: 'run-api', repo: 'api', generated_at: at, new_findings: 2, new_speculative: 0 },
        { run_id: 'run-web', repo: 'web', generated_at: at, new_findings: 3, new_speculative: 0 },
      ],
    });
    stubServer(ov);
    const { user } = renderApp('/insights', { overview: ov });
    const perConfirmed = async () => (await screen.findByText('per confirmed finding')).previousElementSibling?.textContent;
    expect(await perConfirmed()).toBe('$2.60');
    await user.click(screen.getByRole('combobox', { name: 'Repository' }));
    await user.click(await screen.findByRole('option', { name: 'api' }));
    await waitFor(async () => expect(await perConfirmed()).toBe('$2.00'));
    const rows = screen.getAllByRole('row').filter((r) => within(r).queryByText('web'));
    expect(rows).toHaveLength(0);
  });
});
