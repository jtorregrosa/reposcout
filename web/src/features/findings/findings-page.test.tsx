import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { finding, overview, triageFixture } from '@/test/fixtures';
import { renderApp, searchOf, stubServer } from '@/test/render';

const queue = (name: RegExp) => screen.findByRole('tab', { name });
const listed = () =>
  within(screen.getByRole('list', { name: 'Findings' }))
    .getAllByRole('link')
    .map((a) => a.textContent ?? '');

describe('the Findings page', () => {
  it('opens on Triage, listing speculative candidates and detected open findings, with every queue counted', async () => {
    const ov = triageFixture();
    stubServer(ov);
    renderApp('/findings', { overview: ov });
    expect(await queue(/Triage/)).toHaveAttribute('aria-selected', 'true');
    expect(await queue(/Triage/)).toHaveTextContent('2');
    expect(await queue(/To report/)).toHaveTextContent('1');
    expect(await queue(/Closed/)).toHaveTextContent('2');
    const rows = listed();
    expect(rows.some((t) => t.includes('Speculative candidate'))).toBe(true);
    expect(rows.some((t) => t.includes('Detected finding'))).toBe(true);
    expect(rows.some((t) => t.includes('Validated finding'))).toBe(false);
  });

  it('counts the queues within the repository filter', async () => {
    const ov = triageFixture();
    stubServer(ov);
    renderApp('/findings?repo=web', { overview: ov });
    expect(await queue(/Triage/)).toHaveTextContent('0');
    expect(await queue(/To report/)).toHaveTextContent('1');
  });

  it('opens a link from before the queues on All with the status filter', async () => {
    const ov = triageFixture();
    stubServer(ov);
    renderApp('/findings?status=resolved&repo=web', { overview: ov });
    expect(await queue(/All/)).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Status: resolved')).toBeInTheDocument();
    expect(listed()).toHaveLength(1);
    expect(listed()[0]).toContain('Resolved finding');
  });

  it('opens the old New tab as All with New in the last run on', async () => {
    const ov = triageFixture();
    stubServer(ov);
    renderApp('/findings?status=new', { overview: ov });
    expect(await queue(/All/)).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('New in the last run')).toBeInTheDocument();
    expect(listed()).toHaveLength(1);
    expect(listed()[0]).toContain('Detected finding');
  });

  it('removes a filter from its chip and widens the list', async () => {
    const ov = triageFixture();
    stubServer(ov);
    const { user, router } = renderApp('/findings?queue=all&category=security', { overview: ov });
    expect(await screen.findByText('Category: security')).toBeInTheDocument();
    expect(listed()).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Remove Category: security' }));
    expect(listed()).toHaveLength(5);
    expect(searchOf(router).get('category')).toBeNull();
  });

  it('keeps the detail tab while moving through the list', async () => {
    const ov = triageFixture();
    stubServer(ov);
    const { user, router } = renderApp(`/findings?id=${ov.findings[1]?.fingerprint}`, { overview: ov });
    await user.click(await screen.findByRole('tab', { name: 'Evidence' }));
    expect(searchOf(router).get('tab')).toBe('evidence');
    await user.keyboard('j');
    await waitFor(() => expect(searchOf(router).get('id')).not.toBe(ov.findings[1]?.fingerprint));
    expect(screen.getByRole('tab', { name: 'Evidence' })).toHaveAttribute('aria-selected', 'true');
  });

  it('lets the Discarded by verifier link list the discarded candidates', async () => {
    const ov = overview({
      discarded: [
        {
          repo: 'api',
          date: '2026-10-08',
          run: null,
          commit: 'c',
          title: 'Not real',
          file: 'a.ts',
          reason: 'guarded upstream',
          specialists: ['logic'],
        } as never,
      ],
    });
    stubServer(ov);
    const { user } = renderApp('/findings', { overview: ov });
    await user.click(await screen.findByRole('link', { name: /Discarded by verifier/ }));
    expect(await screen.findByText('Not real')).toBeInTheDocument();
    expect(screen.getByText('guarded upstream')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Triage/ })).toHaveAttribute('aria-selected', 'false');
  });
});

describe('the Not a bug dialog', () => {
  const open = async (status: Parameters<typeof finding>[0]) => {
    const f = finding({ title: 'Under review', ...status });
    const ov = overview({ findings: [f] });
    stubServer(ov);
    const r = renderApp(`/findings?queue=all&id=${f.fingerprint}`, { overview: ov });
    await r.user.click(await screen.findByRole('button', { name: /Not a bug/ }));
    return { ...r, dialog: await screen.findByRole('dialog') };
  };

  it('offers Refute and Suppress on an undecided open finding, with Refute selected', async () => {
    const { dialog } = await open({ status: 'open', stage: 'detected' });
    expect(within(dialog).getByRole('radio', { name: /Refute/ })).toBeChecked();
    expect(within(dialog).getByRole('radio', { name: /Suppress/ })).toBeInTheDocument();
  });

  it('offers only Refute on a speculative candidate', async () => {
    const { dialog } = await open({ status: 'speculative' });
    expect(within(dialog).getByRole('radio', { name: /Refute/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole('radio', { name: /Suppress/ })).toBeNull();
  });

  it('offers only Suppress on a finding an auditor confirmed', async () => {
    const { dialog } = await open({
      status: 'open',
      stage: 'validated',
      decision: { verdict: 'confirmed', reason: 'Checked', decided_by: 'alice', decided_at: '2026-10-08T00:00:00.000Z', decided_on: 'open' },
    });
    expect(within(dialog).queryByRole('radio', { name: /Refute/ })).toBeNull();
    expect(within(dialog).getByRole('radio', { name: /Suppress/ })).toBeInTheDocument();
  });

  it('does not submit a reason that is too short, and says why', async () => {
    const { dialog, user } = await open({ status: 'open' });
    await user.type(within(dialog).getByRole('textbox'), 'no');
    expect(within(dialog).getByText('At least 3 characters')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /^Refute/ })).toBeDisabled();
  });
});

describe('the Next step bar', () => {
  const detail = async (over: Parameters<typeof finding>[0]) => {
    const f = finding({ title: 'Under review', ...over });
    const ov = overview({ findings: [f] });
    stubServer(ov);
    renderApp(`/findings?queue=all&id=${f.fingerprint}`, { overview: ov });
    await screen.findByRole('heading', { name: 'Under review' });
  };

  it('offers Confirm and Not a bug on a speculative candidate', async () => {
    await detail({ status: 'speculative' });
    const step = screen.getByRole('group', { name: 'Next step' });
    expect(within(step).getByRole('button', { name: /Confirm/ })).toBeInTheDocument();
    expect(within(step).getByRole('button', { name: /Not a bug/ })).toBeInTheDocument();
  });

  it('offers Copy for a ticket and Not a bug on a validated finding, never Confirm', async () => {
    await detail({ status: 'open', stage: 'validated' });
    const step = screen.getByRole('group', { name: 'Next step' });
    expect(within(step).getByRole('button', { name: /Copy for a ticket/ })).toBeInTheDocument();
    expect(within(step).getByRole('button', { name: /Not a bug/ })).toBeInTheDocument();
    expect(within(step).queryByRole('button', { name: /Confirm/ })).toBeNull();
  });

  it('offers nothing on a resolved finding but still opens it in VS Code', async () => {
    await detail({ status: 'resolved', stage: 'fixed' });
    expect(screen.queryByRole('group', { name: 'Next step' })).toBeNull();
    expect(screen.getByRole('button', { name: /Open in VS Code/ })).toBeInTheDocument();
  });
});

describe('keyboard shortcuts on a finding', () => {
  it('opens Not a bug with X', async () => {
    const f = finding({ status: 'open' });
    const ov = overview({ findings: [f] });
    stubServer(ov);
    const { user } = renderApp(`/findings?queue=all&id=${f.fingerprint}`, { overview: ov });
    await screen.findByRole('heading', { name: f.title });
    await user.keyboard('x');
    expect(await screen.findByRole('dialog', { name: 'Not a bug' })).toBeInTheDocument();
  });

  it('does nothing with C on a resolved finding', async () => {
    const f = finding({ status: 'resolved', stage: 'fixed' });
    const ov = overview({ findings: [f] });
    stubServer(ov);
    const { user } = renderApp(`/findings?queue=all&id=${f.fingerprint}`, { overview: ov });
    await screen.findByRole('heading', { name: f.title });
    await user.keyboard('c');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('leaves letters typed in the search box alone', async () => {
    const ov = triageFixture();
    stubServer(ov);
    const { user, router } = renderApp('/findings', { overview: ov });
    const search = await screen.findByRole('searchbox', { name: 'Search findings' });
    await user.click(search);
    await user.keyboard('j');
    expect(search).toHaveValue('j');
    expect(searchOf(router).get('id')).toBeNull();
  });
});

describe('bulk actions', () => {
  const candidates = () => [
    finding({ title: 'Cand A', status: 'speculative' }),
    finding({ title: 'Cand B', status: 'speculative' }),
    finding({ title: 'Cand C', status: 'speculative' }),
  ];

  it('refutes three selected candidates with one reason, one call each', async () => {
    const ov = overview({ findings: candidates() });
    const calls = stubServer(ov);
    const { user } = renderApp('/findings', { overview: ov });
    for (const name of ['Cand A', 'Cand B', 'Cand C']) await user.click(await screen.findByRole('checkbox', { name: `Select ${name}` }));
    expect(screen.getByText('3 findings selected')).toBeInTheDocument();
    await user.click(within(screen.getByRole('toolbar', { name: 'Selected findings' })).getByRole('button', { name: /Not a bug/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox'), 'Guarded by the caller');
    await user.click(within(dialog).getByRole('button', { name: 'Refute 3' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('3 findings refuted.'));
    expect(calls.map((c) => [c.action, c.body.decision, c.body.reason])).toEqual([
      ['decide', 'refuted', 'Guarded by the caller'],
      ['decide', 'refuted', 'Guarded by the caller'],
      ['decide', 'refuted', 'Guarded by the caller'],
    ]);
  });

  it('offers no verdict for a selection with nothing in common', async () => {
    const ov = overview({
      findings: [
        finding({ title: 'Cand A', status: 'speculative' }),
        finding({
          title: 'Confirmed one',
          status: 'open',
          stage: 'detected',
          decision: { verdict: 'confirmed', reason: 'r', decided_by: 'a', decided_at: '2026-10-08T00:00:00.000Z', decided_on: 'speculative' },
        }),
      ],
    });
    stubServer(ov);
    const { user } = renderApp('/findings', { overview: ov });
    await user.click(await screen.findByRole('checkbox', { name: 'Select Cand A' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Confirmed one' }));
    await user.click(within(screen.getByRole('toolbar', { name: 'Selected findings' })).getByRole('button', { name: /Not a bug/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('radio')).toBeNull();
    expect(within(dialog).getByText(/no verdict in common/)).toBeInTheDocument();
  });

  it('reports the findings a partial failure refused', async () => {
    const findings = ['One', 'Two', 'Three', 'Four'].map((t) => finding({ title: t, status: 'open', stage: 'validated' }));
    const ov = overview({ findings });
    const refused = findings[1]?.fingerprint;
    stubServer(ov, { suppress: (body) => (body.fingerprint === refused ? 'already suppressed' : { suppressed: body.fingerprint as string }) });
    const { user } = renderApp('/findings?queue=report', { overview: ov });
    for (const name of ['One', 'Two', 'Three', 'Four']) await user.click(await screen.findByRole('checkbox', { name: `Select ${name}` }));
    await user.click(within(screen.getByRole('toolbar', { name: 'Selected findings' })).getByRole('button', { name: /Not a bug/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: /Suppress/ }));
    await user.type(within(dialog).getByRole('textbox'), 'Trusted input only');
    await user.click(within(dialog).getByRole('button', { name: 'Suppress 4' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('3 findings suppressed; 1 refused: Two (already suppressed).'));
  });

  it('drops findings that leave the list from the selection', async () => {
    const ov = overview({
      findings: [finding({ title: 'Cand A', status: 'speculative', repo: 'api' }), finding({ title: 'Cand B', status: 'speculative', repo: 'web' })],
    });
    stubServer(ov);
    const { user, router } = renderApp('/findings', { overview: ov });
    await user.click(await screen.findByRole('checkbox', { name: 'Select Cand A' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Cand B' }));
    expect(screen.getByText('2 findings selected')).toBeInTheDocument();
    await router.navigate('/findings?repo=web');
    expect(await screen.findByText('1 finding selected')).toBeInTheDocument();
  });
});
