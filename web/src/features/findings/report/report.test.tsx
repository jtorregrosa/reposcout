import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FindingView, ReportForm } from '@/lib/types';
import { finding, overview, repo } from '@/test/fixtures';
import { renderApp, reply, stubServer } from '@/test/render';

const FORM: ReportForm = {
  project: 'API',
  issue_type: 'Bug',
  issue_types: [
    { id: '1', name: 'Bug' },
    { id: '4', name: 'Task' },
  ],
  fields: [
    {
      id: 'customfield_100',
      name: 'Team',
      kind: 'select',
      required: true,
      options: [
        { id: '1', label: 'Security' },
        { id: '2', label: 'Core' },
      ],
    },
    {
      id: 'customfield_101',
      name: 'Severity',
      kind: 'select',
      required: false,
      options: [
        { id: '10', label: 'High' },
        { id: '11', label: 'Low' },
      ],
      default: '10',
    },
  ],
  labels: ['security'],
  parent: { key: 'API-1', summary: 'Checkout hardening', type: 'Epic' },
  parent_error: null,
  parent_allowed: true,
  unknown_defaults: [],
};

const validated = (over: Partial<FindingView> = {}) => finding({ status: 'open', stage: 'validated', repo: 'api', ...over });

const configured = (findings: FindingView[]) =>
  overview({
    findings,
    repos: [repo({ name: 'api', jira: { project: 'API', issue_type: 'Bug' } }), repo({ name: 'web', jira: { project: 'WEB', issue_type: 'Bug' } })],
    jira: { site: 'https://acme.atlassian.net', ready: true },
  });

const gets = { '/api/jira/meta': () => FORM };

const openReport = async (f: FindingView, actions = {}) => {
  const ov = configured([f]);
  const calls = stubServer(ov, actions, gets);
  const r = renderApp(`/findings?queue=report&id=${f.fingerprint}`, { overview: ov });
  await r.user.click(await screen.findByRole('button', { name: /Report to Jira/ }));
  return { ...r, calls, dialog: await screen.findByRole('dialog', { name: 'Report to Jira' }) };
};

describe('Report to Jira', () => {
  it('opens a form prefilled from the repository target', async () => {
    const f = validated({ title: 'SQL injection in orders' });
    const { dialog } = await openReport(f);
    expect(await within(dialog).findByLabelText('Project')).toHaveValue('API');
    expect(within(dialog).getByRole('combobox', { name: 'Parent' })).toHaveTextContent('API-1 · Checkout hardening');
    expect(within(dialog).getByLabelText('Summary')).toHaveValue('SQL injection in orders');
    expect(within(dialog).getByRole('combobox', { name: 'Severity' })).toHaveTextContent('High');
    expect(within(dialog).getByLabelText('Labels')).toHaveValue('security');
  });

  it('keeps Create issue disabled until every required field has a value', async () => {
    const { dialog, user } = await openReport(validated());
    const create = await within(dialog).findByRole('button', { name: 'Create issue' });
    expect(create).toBeDisabled();
    expect(within(dialog).getByText('Required: Team')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('combobox', { name: 'Team' }));
    await user.click(await screen.findByRole('option', { name: 'Security' }));
    expect(create).toBeEnabled();
  });

  it('sends the form and shows a field error from Jira next to its field', async () => {
    const { dialog, user, calls } = await openReport(validated(), {
      report: () => reply(400, { error: 'Team: Team is not valid for this project', fields: { customfield_100: 'Team is not valid for this project' } }),
    });
    await user.click(await within(dialog).findByRole('combobox', { name: 'Team' }));
    await user.click(await screen.findByRole('option', { name: 'Core' }));
    await user.click(within(dialog).getByRole('button', { name: 'Create issue' }));
    expect(await within(dialog).findByText('Team is not valid for this project')).toBeInTheDocument();
    expect(calls[0]?.body).toMatchObject({
      project: 'API',
      issue_type: 'Bug',
      parent: 'API-1',
      labels: ['security'],
      fields: { customfield_100: '2', customfield_101: '10' },
    });
  });

  it('is not offered without Jira configured, and says what to configure', async () => {
    const f = validated();
    const ov = overview({ findings: [f], repos: [repo({ name: 'api' })] });
    stubServer(ov);
    renderApp(`/findings?queue=report&id=${f.fingerprint}`, { overview: ov });
    expect(await screen.findByText(/Add a jira section with the site to repos.yaml/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Report to Jira/ })).toBeNull();
    expect(within(screen.getByRole('group', { name: 'Next step' })).getByRole('button', { name: /Copy for a ticket/ })).toBeInTheDocument();
  });
});

describe('a reported finding', () => {
  const reported = () =>
    validated({
      title: 'Reported one',
      stage: 'reported',
      issue: { key: 'API-42', url: 'https://acme.atlassian.net/browse/API-42', project: 'API', reported_by: 'ana', reported_at: '2026-10-09T00:00:00.000Z' },
    });

  it('shows its issue key in its row, linking to Jira, and offers Open in Jira', async () => {
    const f = reported();
    const ov = configured([f]);
    stubServer(ov);
    renderApp(`/findings?queue=reported&id=${f.fingerprint}`, { overview: ov });
    const list = await screen.findByRole('list', { name: 'Findings' });
    expect(within(list).getByRole('link', { name: 'API-42, open in Jira' })).toHaveAttribute('href', 'https://acme.atlassian.net/browse/API-42');
    expect(within(screen.getByRole('group', { name: 'Next step' })).getByRole('link', { name: /Open API-42 in Jira/ })).toBeInTheDocument();
  });

  it('unlinks its issue after a confirmation that says Jira is left alone', async () => {
    const f = reported();
    const ov = configured([f]);
    const calls = stubServer(ov);
    const { user } = renderApp(`/findings?queue=reported&id=${f.fingerprint}`, { overview: ov });
    await user.click(await screen.findByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: /Unlink issue/ }));
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent('API-42 is left as it is in Jira');
    await user.click(within(confirm).getByRole('button', { name: 'Unlink' }));
    await waitFor(() => expect(calls).toEqual([{ action: 'unlink', body: { repo: 'api', fingerprint: f.fingerprint } }]));
  });
});

describe('reporting in bulk', () => {
  it('reports three findings of one repository with one form', async () => {
    const findings = ['One', 'Two', 'Three'].map((title) => validated({ title }));
    const ov = configured(findings);
    const calls = stubServer(
      ov,
      { report: (b) => (b.fingerprints as string[]).map((fp, i) => ({ fingerprint: fp, ok: true, key: `API-${i}`, url: 'x', adopted: false })) },
      gets,
    );
    const { user } = renderApp('/findings?queue=report', { overview: ov });
    for (const t of ['One', 'Two', 'Three']) await user.click(await screen.findByRole('checkbox', { name: `Select ${t}` }));
    await user.click(within(screen.getByRole('toolbar', { name: 'Selected findings' })).getByRole('button', { name: /Report to Jira/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Report to Jira' });
    expect(await within(dialog).findByLabelText('Summary for Two')).toHaveValue('Two');
    await user.click(within(dialog).getByRole('combobox', { name: 'Team' }));
    await user.click(await screen.findByRole('option', { name: 'Security' }));
    await user.click(within(dialog).getByRole('button', { name: 'Create 3 issues' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('3 findings reported.'));
    expect(calls[0]?.body.fingerprints).toHaveLength(3);
  });

  it('is not offered for findings of two repositories, and says why', async () => {
    const ov = configured([validated({ title: 'In api' }), validated({ title: 'In web', repo: 'web' })]);
    stubServer(ov, {}, gets);
    const { user } = renderApp('/findings?queue=report', { overview: ov });
    await user.click(await screen.findByRole('checkbox', { name: 'Select In api' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select In web' }));
    const bar = screen.getByRole('toolbar', { name: 'Selected findings' });
    expect(within(bar).queryByRole('button', { name: /Report to Jira/ })).toBeNull();
    expect(screen.getByText('Select findings of one repository to report them to Jira together.')).toBeInTheDocument();
  });
});
