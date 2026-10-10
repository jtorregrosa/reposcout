import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { configView, triageFixture } from '@/test/fixtures';
import { renderApp, reply, stubServer } from '@/test/render';

const config = () => ({ '/api/config': () => configView() });

const row = async (key: string, scope = 'repo') => within(await screen.findByTestId(`field-${scope}-${key}`));

describe('the repository Configuration tab', () => {
  it('shows each value with its origin and the lists that add up split by origin', async () => {
    const ov = triageFixture();
    stubServer(ov, {}, config());
    renderApp('/repositories/api?tab=configuration', { overview: ov });
    expect((await row('claude.models.verifier')).getByText('From defaults')).toBeInTheDocument();
    expect((await row('claude.models.specialists')).getByText('This repository')).toBeInTheDocument();
    const excluded = await row('excluded_paths');
    expect(excluded.getByText('Inherited from defaults, changed there')).toBeInTheDocument();
    expect(excluded.getByText('docs/**')).toBeInTheDocument();
    expect(excluded.getByText('scripts/**')).toBeInTheDocument();
    const test = await row('test_command');
    expect(test.getByText(/Decides what runs on this machine/)).toBeInTheDocument();
    expect(test.queryByRole('button', { name: /Edit/ })).toBeNull();
  });

  it('shows the server’s error on the field it refused', async () => {
    const ov = triageFixture();
    const calls = stubServer(ov, { 'config-set': () => reply(400, { error: 'Files per run max_files_per_run must be an integer from 1 to 150' }) }, config());
    const { user } = renderApp('/repositories/api?tab=configuration', { overview: ov });
    const files = await row('max_files_per_run');
    await user.click(files.getByRole('button', { name: 'Edit Files per run' }));
    const input = files.getByRole('spinbutton', { name: 'Files per run' });
    await user.clear(input);
    await user.type(input, '500');
    await user.click(files.getByRole('button', { name: 'Save' }));
    expect(await files.findByRole('alert')).toHaveTextContent('must be an integer from 1 to 150');
    expect(calls).toEqual([{ action: 'config-set', body: { scope: 'repo', name: 'api', key: 'max_files_per_run', value: 500 } }]);
  });

  it('resets a key the repository sets', async () => {
    const ov = triageFixture();
    const calls = stubServer(ov, { 'config-unset': (b) => b }, config());
    const { user } = renderApp('/repositories/api?tab=configuration', { overview: ov });
    await user.click((await row('claude.max_turns')).getByRole('button', { name: 'Reset Orchestrator turns to default' }));
    await waitFor(() => expect(calls).toEqual([{ action: 'config-unset', body: { scope: 'repo', name: 'api', key: 'claude.max_turns' } }]));
    expect((await row('claude.models.verifier')).queryByRole('button', { name: /Reset/ })).toBeNull();
  });

  it('asks before removing an analyzer and writes nothing until confirmed', async () => {
    const ov = triageFixture();
    const calls = stubServer(ov, { 'config-set': (b) => b }, config());
    const { user } = renderApp('/repositories/api?tab=configuration', { overview: ov });
    const analyzers = await row('analyzers');
    await user.click(analyzers.getByRole('button', { name: 'Edit Analyzers' }));
    await user.click(analyzers.getByRole('checkbox', { name: 'performance' }));
    await user.click(analyzers.getByRole('button', { name: 'Save' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove an analyzer?' });
    expect(within(dialog).getByText(/stay open until a run includes that analyzer again/)).toBeInTheDocument();
    expect(calls).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls[0]?.body).toEqual({ scope: 'repo', name: 'api', key: 'analyzers', value: ['security', 'concurrency', 'error-handling', 'logic'] }),
    );
  });
});

describe('Add repository', () => {
  const open = async (outcome: { result: string; detail: string }) => {
    const ov = triageFixture();
    const calls = stubServer(ov, { 'repo-test': () => outcome, 'repo-add': () => ({ added: 'lib' }) }, config());
    const { user, router } = renderApp('/repositories', { overview: ov });
    await user.click(await screen.findByRole('button', { name: 'Add repository' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a repository' });
    const d = within(dialog);
    await user.type(d.getByLabelText('Organization'), 'org');
    await user.type(d.getByLabelText('Project'), 'p');
    await user.type(d.getByLabelText('Repository'), 'lib');
    await user.click(d.getByRole('button', { name: 'Test connection' }));
    return { calls, user, router, d };
  };

  it('tests the connection with the form and shows a reachable branch', async () => {
    const { calls, d } = await open({ result: 'reachable', detail: 'branch main found' });
    expect(await d.findByText('Reachable')).toBeInTheDocument();
    expect(calls[0]).toEqual({ action: 'repo-test', body: { entry: { provider: 'azure-devops', organization: 'org', project: 'p', repo: 'lib' } } });
  });

  for (const [result, title] of [
    ['branch-missing', 'Branch missing'],
    ['no-access', 'Not found or no access'],
    ['token-missing', 'Token missing'],
    ['failed', 'Connection failed'],
  ] as const) {
    it(`shows ${result} and still lets the repository be added`, async () => {
      const { calls, user, router, d } = await open({ result, detail: 'details' });
      expect(await d.findByText(title)).toBeInTheDocument();
      await user.click(d.getByRole('button', { name: 'Add repository' }));
      await waitFor(() => expect(router.state.location.pathname).toBe('/repositories/lib'));
      expect(calls.map((c) => c.action)).toEqual(['repo-test', 'repo-add']);
    });
  }
});

describe('the Settings page', () => {
  it('opens from the sidebar on Defaults with how many repositories inherit each value', async () => {
    const ov = triageFixture();
    stubServer(ov, {}, config());
    const { user, router } = renderApp('/', { overview: ov });
    await user.click(await screen.findByRole('link', { name: 'Settings' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
    expect(await screen.findByRole('tab', { name: 'Defaults' })).toHaveAttribute('aria-selected', 'true');
    expect((await row('claude.max_turns', 'defaults')).getByText('inherited by 1 · overridden by 1')).toBeInTheDocument();
  });

  it('shows a failing credential check with its detail and the restart note', async () => {
    const ov = triageFixture();
    stubServer(
      ov,
      {},
      {
        ...config(),
        '/api/checks': () => ({
          env_loaded_at: '2026-10-10T08:00:00.000Z',
          checks: [
            { name: 'claude CLI', ok: true, detail: '2.1.0' },
            { name: 'PAT in REPOSCOUT_ADO_PAT', ok: false, detail: 'Environment variable REPOSCOUT_ADO_PAT (read-only PAT) is not set.' },
          ],
        }),
      },
    );
    renderApp('/settings?section=credentials', { overview: ov });
    expect(await screen.findByText('PAT in REPOSCOUT_ADO_PAT')).toBeInTheDocument();
    expect(screen.getByLabelText('Failed')).toBeInTheDocument();
    expect(screen.getByText(/REPOSCOUT_ADO_PAT \(read-only PAT\) is not set/)).toBeInTheDocument();
    expect(screen.getByText(/restart it after editing .env/)).toBeInTheDocument();
  });
});
