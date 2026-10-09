import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { overview, repo, triageFixture } from '@/test/fixtures';
import { renderApp, searchOf, stubServer } from '@/test/render';

describe('the Repositories page', () => {
  it('opens New audit preset to a repository from its row', async () => {
    const ov = triageFixture();
    stubServer(ov);
    const { user } = renderApp('/repositories', { overview: ov });
    await user.click(await screen.findByRole('button', { name: 'Actions for api' }));
    await user.click(await screen.findByRole('menuitem', { name: /Audit this repository/ }));
    const dialog = await screen.findByRole('dialog', { name: 'New audit' });
    expect(within(dialog).getByRole('checkbox', { name: 'api' })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'web' })).not.toBeChecked();
    expect(within(dialog).getByRole('radio', { name: /Changes since the last audit/ })).toBeChecked();
  });

  it('opens the Triage queue of a repository from its count', async () => {
    const ov = triageFixture();
    stubServer(ov);
    const { user, router } = renderApp('/repositories', { overview: ov });
    await user.click(await screen.findByRole('link', { name: '2 in Triage for api' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/findings'));
    expect(searchOf(router).get('repo')).toBe('api');
    expect(searchOf(router).get('queue')).toBeNull();
  });
});

describe('a repository page', () => {
  it('says verification is off without a test_command', async () => {
    const ov = triageFixture();
    stubServer(ov);
    renderApp('/repositories/web', { overview: ov });
    expect(await screen.findByText(/No test_command is set in repos.yaml/)).toBeInTheDocument();
  });

  it('names the opt-in when there is no sandbox', async () => {
    const ov = overview({ repos: [repo({ name: 'api', verification: 'no-sandbox' })] });
    stubServer(ov);
    renderApp('/repositories/api', { overview: ov });
    expect(await screen.findByText(/test_command_unsandboxed: true/)).toBeInTheDocument();
  });

  it('says when there is no such repository', async () => {
    const ov = triageFixture();
    stubServer(ov);
    renderApp('/repositories/nope', { overview: ov });
    expect(await screen.findByText('No repository named "nope" in repos.yaml')).toBeInTheDocument();
  });

  it('keeps the selected tab across a reload', async () => {
    const ov = triageFixture();
    stubServer(ov);
    const first = renderApp('/repositories/api', { overview: ov });
    await first.user.click(await screen.findByRole('tab', { name: 'Coverage' }));
    const url = `${first.router.state.location.pathname}${first.router.state.location.search}`;
    expect(url).toBe('/repositories/api?tab=coverage');
    first.unmount();
    renderApp(url, { overview: ov });
    expect(await screen.findByRole('tab', { name: 'Coverage' })).toHaveAttribute('aria-selected', 'true');
  });
});
