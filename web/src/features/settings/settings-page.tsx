import { useQuery } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, CircleX, RefreshCw } from 'lucide-react';
import { Page, PageHeader } from '@/components/page';
import { ErrorAlert, LoadingPage } from '@/components/query-state';
import { RelativeTime } from '@/components/time';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSearchParam } from '@/hooks/use-search-param';
import { checksQuery, configQuery } from '@/lib/queries';
import type { Check, ConfigView } from '@/lib/types';
import { ConfigFields, type FieldGroup, REPO_GROUPS } from './config-editor';

const SECTIONS = ['defaults', 'jira', 'notifications', 'credentials'] as const;
type Section = (typeof SECTIONS)[number];
const SECTION_LABEL: Record<Section, string> = { defaults: 'Defaults', jira: 'Jira', notifications: 'Notifications', credentials: 'Credentials' };

const DEFAULT_GROUPS: FieldGroup[] = REPO_GROUPS.filter((g) => g.title !== 'Jira target');
const JIRA_GROUPS: FieldGroup[] = REPO_GROUPS.filter((g) => g.title === 'Jira target').map((g) => ({ ...g, title: 'Default target' }));
const WEBHOOK_GROUPS: FieldGroup[] = [{ title: 'Delivery', keys: ['name', 'url_env', 'format', 'min_severity', 'on_failure'] }];

function DefaultsSection({ view }: { view: ConfigView }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Defaults</CardTitle>
        <CardDescription>
          Every repository takes these values unless it sets its own. Excluded paths and owner facts add to each repository's own list.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ConfigFields view={view} fields={view.defaults} groups={DEFAULT_GROUPS} scope="defaults" showCounts />
      </CardContent>
    </Card>
  );
}

function JiraSection({ view }: { view: ConfigView }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Jira</CardTitle>
        <CardDescription>
          The site and credential variables decide where the Jira token is sent, so they are changed in repos.yaml and .env only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {view.jira ? (
          <dl className="grid max-w-xl grid-cols-2 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Site</dt>
            <dd className="font-mono">{view.jira.site}</dd>
            <dt className="text-muted-foreground">Email variable</dt>
            <dd className="font-mono">{view.jira.email_env}</dd>
            <dt className="text-muted-foreground">Token variable</dt>
            <dd className="font-mono">{view.jira.token_env}</dd>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">
            Reporting to Jira is not configured. Add a top-level jira section with the site to repos.yaml, and the account email and API token to .env.
          </p>
        )}
        {view.jira ? <ConfigFields view={view} fields={view.defaults} groups={JIRA_GROUPS} scope="defaults" showCounts /> : null}
      </CardContent>
    </Card>
  );
}

function NotificationsSection({ view }: { view: ConfigView }) {
  if (!view.webhooks.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
          <CardDescription>No webhook is configured. Add one under notifications.webhooks in repos.yaml, with its URL in .env.</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      {view.webhooks.map((hook) => (
        <Card key={hook.name}>
          <CardHeader>
            <CardTitle>{hook.name}</CardTitle>
            <CardDescription>Announces the end of each run. Its URL is read from {hook.url_env} and never shown.</CardDescription>
          </CardHeader>
          <CardContent>
            <ConfigFields view={view} fields={hook.fields} groups={WEBHOOK_GROUPS} scope="webhook" name={hook.name} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function CheckIcon({ check }: { check: Check }) {
  if (!check.ok) return <CircleX className="size-4 shrink-0 text-destructive" aria-label="Failed" />;
  if (check.warn) return <CircleAlert className="size-4 shrink-0 text-warning" aria-label="Warning" />;
  return <CircleCheck className="size-4 shrink-0 text-success" aria-label="Passed" />;
}

function CredentialsSection() {
  const { data, error, isFetching, refetch } = useQuery(checksQuery);
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle>Credentials</CardTitle>
          <CardDescription>
            The checks doctor makes. Values are never shown.{' '}
            {data ? (
              <>
                The environment is the one loaded when the dashboard started, <RelativeTime iso={data.env_loaded_at} />; restart it after editing .env.
              </>
            ) : null}
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
          <RefreshCw />
          {isFetching ? 'Checking…' : 'Run checks'}
        </Button>
      </CardHeader>
      <CardContent>
        {error ? (
          <ErrorAlert title="The checks could not run" error={error} />
        ) : data ? (
          <ul className="divide-y text-sm">
            {data.checks.map((c) => (
              <li key={c.name} className="flex items-start gap-2 py-2">
                <CheckIcon check={c} />
                <div className="min-w-0">
                  <p className="font-medium">{c.name}</p>
                  <p className="break-words text-muted-foreground">{c.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Checking…</p>
        )}
      </CardContent>
    </Card>
  );
}

export function SettingsPage() {
  const [section, setSection] = useSearchParam('section', SECTIONS, 'defaults');
  const { data: view, error } = useQuery(configQuery);
  return (
    <Page>
      <PageHeader title="Settings" description="Edits are written to repos.yaml, which stays the source of truth and editable by hand. Secrets stay in .env." />
      <Tabs value={section} onValueChange={(v) => setSection(v as Section)}>
        <TabsList>
          {SECTIONS.map((s) => (
            <TabsTrigger key={s} value={s}>
              {SECTION_LABEL[s]}
            </TabsTrigger>
          ))}
        </TabsList>
        {section === 'credentials' ? (
          <TabsContent value="credentials" className="pt-2">
            <CredentialsSection />
          </TabsContent>
        ) : error ? (
          <ErrorAlert title="repos.yaml does not load" error={error} />
        ) : !view ? (
          <LoadingPage />
        ) : (
          <>
            <TabsContent value="defaults" className="pt-2">
              <DefaultsSection view={view} />
            </TabsContent>
            <TabsContent value="jira" className="pt-2">
              <JiraSection view={view} />
            </TabsContent>
            <TabsContent value="notifications" className="pt-2">
              <NotificationsSection view={view} />
            </TabsContent>
          </>
        )}
      </Tabs>
    </Page>
  );
}
