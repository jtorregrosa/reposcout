import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { finding, overview, triageFixture } from '@/test/fixtures';
import { renderApp, searchOf, stubServer } from '@/test/render';

const stage = (name: string) => screen.getByRole('link', { name: new RegExp(`^${name}:`) });

describe('the Overview', () => {
  it('leads with the four stages and their counts', async () => {
    const ov = triageFixture();
    stubServer(ov);
    renderApp('/', { overview: ov });
    const stages = await screen.findByRole('region', { name: 'Stages' });
    expect(within(stages).getByText('Detect')).toBeInTheDocument();
    expect(stage('Detect')).toHaveTextContent('2');
    expect(stage('Validate')).toHaveTextContent('2');
    expect(stage('Report')).toHaveTextContent('1');
  });

  it('opens the Triage queue from the Validate stage', async () => {
    const ov = triageFixture();
    stubServer(ov);
    const { user, router } = renderApp('/', { overview: ov });
    await screen.findByRole('region', { name: 'Stages' });
    await user.click(stage('Validate'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/findings'));
    expect(searchOf(router).get('queue')).toBeNull();
    expect(await screen.findByRole('tab', { name: /Triage/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows Fix as not available yet, with no link', async () => {
    const ov = triageFixture();
    stubServer(ov);
    renderApp('/', { overview: ov });
    const stages = await screen.findByRole('region', { name: 'Stages' });
    expect(within(stages).getByText('Not available yet')).toBeInTheDocument();
    expect(within(stages).queryByRole('link', { name: /^Fix/ })).toBeNull();
  });

  it('keeps the matrix totals when switching it to categories', async () => {
    const ov = overview({
      findings: [finding({ severity: 'high', category: 'security' }), finding({ severity: 'low', category: 'logic' }), finding({ status: 'resolved' })],
    });
    stubServer(ov);
    const { user } = renderApp('/', { overview: ov });
    await user.click(await screen.findByRole('radio', { name: 'Category' }));
    const table = screen.getByRole('table');
    expect(within(table).getByRole('link', { name: /Security/ })).toBeInTheDocument();
    const footer = within(table).getAllByRole('row').at(-1);
    expect(footer?.lastElementChild).toHaveTextContent('2');
  });

  it('says when nothing critical or high is open', async () => {
    const ov = overview({ findings: [finding({ severity: 'low' })] });
    stubServer(ov);
    renderApp('/', { overview: ov });
    expect(await screen.findByText('Nothing critical or high is open')).toBeInTheDocument();
  });
});

describe('launching runs from their context', () => {
  it('posts a validation pass for the repositories that can verify', async () => {
    const ov = triageFixture();
    const calls = stubServer(ov);
    const { user } = renderApp('/findings', { overview: ov });
    await user.click(await screen.findByRole('button', { name: /Validate detected findings/ }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('It runs in api.');
    await user.click(within(dialog).getByRole('button', { name: 'Validate' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({
      action: 'run',
      body: { repos: ['api'], mode: 'validate', max_files: null, analyzers: [], until_covered: false, session_limit: null },
    });
  });

  it('posts a speculative review for the repositories holding candidates', async () => {
    const ov = triageFixture();
    const calls = stubServer(ov);
    const { user } = renderApp('/findings', { overview: ov });
    await user.click(await screen.findByRole('button', { name: /Review speculative candidates/ }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Review' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.body).toMatchObject({ repos: ['api'], mode: 'speculative' });
  });

  it('disables every launch while a run holds the lock', async () => {
    const ov = { ...triageFixture(), active: { pid: 1, started_at: '2026-10-09T08:00:00.000Z' } };
    stubServer(ov);
    renderApp('/', { overview: ov });
    await screen.findByRole('region', { name: 'Stages' });
    expect(screen.getByRole('button', { name: /Validate detected findings/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Review speculative candidates/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'New audit' })).toBeDisabled();
  });
});
