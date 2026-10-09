import { QueryClient } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { triageFixture } from '@/test/fixtures';
import { renderApp, searchOf, stubServer } from '@/test/render';

describe('the app shell', () => {
  it('marks Findings in the sidebar with the Triage count', async () => {
    const ov = triageFixture();
    stubServer(ov);
    renderApp('/', { overview: ov });
    expect(await screen.findByTitle('2 in Triage')).toHaveTextContent('2');
  });

  it('shows breadcrumbs on a repository page, linking back to the list', async () => {
    const ov = triageFixture();
    stubServer(ov);
    const { user, router } = renderApp('/repositories/api', { overview: ov });
    const crumbs = await screen.findByRole('navigation', { name: 'breadcrumb' });
    expect(within(crumbs).getByText('api')).toBeInTheDocument();
    await user.click(within(crumbs).getByRole('link', { name: 'Repositories' }));
    expect(router.state.location.pathname).toBe('/repositories');
  });

  it('shows a page that fails inside the shell, with the sidebar still working', async () => {
    const ov = triageFixture();
    stubServer(ov);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 500 })),
    );
    const { router, user, queryClient } = renderApp('/insights', { overview: ov });
    queryClient.removeQueries();
    await router.navigate('/runs');
    expect(await screen.findByText('This page could not be shown')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Insights' }));
    expect(router.state.location.pathname).toBe('/insights');
    expect(queryClient).toBeInstanceOf(QueryClient);
  });

  it('jumps to a finding by fingerprint from the command palette', async () => {
    const ov = triageFixture();
    stubServer(ov);
    const { user, router } = renderApp('/', { overview: ov });
    await screen.findByRole('heading', { name: 'Overview' });
    await user.keyboard('{Control>}k{/Control}');
    const palette = await screen.findByRole('dialog', { name: 'Command palette' });
    const target = ov.findings[3];
    await user.type(within(palette).getByRole('combobox'), target?.fingerprint.slice(0, 8) ?? '');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/findings'));
    expect(searchOf(router).get('queue')).toBe('all');
    expect(searchOf(router).get('id')).toBe(target?.fingerprint);
  });

  it('opens the command palette from inside a text field', async () => {
    const ov = triageFixture();
    stubServer(ov);
    const { user } = renderApp('/findings', { overview: ov });
    await user.click(await screen.findByRole('searchbox', { name: 'Search findings' }));
    await user.keyboard('{Control>}k{/Control}');
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
  });

  it('lists every keyboard shortcut on ?', async () => {
    const ov = triageFixture();
    stubServer(ov);
    const { user } = renderApp('/findings', { overview: ov });
    await screen.findByRole('heading', { name: 'Findings' });
    await user.keyboard('?');
    const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    for (const group of ['Anywhere', 'Findings list', 'Finding']) expect(within(dialog).getByRole('heading', { name: group })).toBeInTheDocument();
  });

  it('redirects the old Usage page to Insights', async () => {
    const ov = triageFixture();
    stubServer(ov);
    const { router } = renderApp('/usage', { overview: ov });
    await waitFor(() => expect(router.state.location.pathname).toBe('/insights'));
    expect(await screen.findByRole('heading', { name: 'Insights' })).toBeInTheDocument();
  });
});
