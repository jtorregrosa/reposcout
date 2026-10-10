import { useQueryClient } from '@tanstack/react-query';
import { createBrowserRouter, Link, type Params, type RouteObject, redirect, useLocation, useNavigate, useRouteError } from 'react-router';
import { Page } from '@/components/page';
import { ErrorAlert, LoadingPage } from '@/components/query-state';
import { Button } from '@/components/ui/button';
import { queryKeys } from '@/lib/queries';
import { AppLayout } from './layout';

export interface RouteHandle {
  crumb: string | ((params: Params) => string);
}

// Shown in the page area, so the sidebar and the header keep working when a page fails.
function PageError() {
  const error = useRouteError();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <Page>
      <ErrorAlert title="This page could not be shown" error={error}>
        <div className="mt-3 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await queryClient.resetQueries({ queryKey: queryKeys.overview });
              navigate(location, { replace: true });
            }}
          >
            Try again
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to="/">Back to the overview</Link>
          </Button>
        </div>
      </ErrorAlert>
    </Page>
  );
}

function ShellError() {
  const error = useRouteError();
  return (
    <Page>
      <ErrorAlert title="The dashboard failed to start" error={error} />
    </Page>
  );
}

function NotFound() {
  return (
    <Page>
      <ErrorAlert title="No such page">
        <Button asChild variant="outline" size="sm" className="mt-3">
          <Link to="/">Back to the overview</Link>
        </Button>
      </ErrorAlert>
    </Page>
  );
}

function PageLoading() {
  return (
    <Page>
      <LoadingPage />
    </Page>
  );
}

const crumb = (value: RouteHandle['crumb']): RouteHandle => ({ crumb: value });

// Each page is its own chunk, so the first paint loads only the shell and the page asked for.
export const routes: RouteObject[] = [
  {
    element: <AppLayout />,
    errorElement: <ShellError />,
    hydrateFallbackElement: <PageLoading />,
    children: [
      {
        errorElement: <PageError />,
        children: [
          { index: true, handle: crumb('Overview'), lazy: async () => ({ Component: (await import('@/features/overview/overview-page')).OverviewPage }) },
          { path: 'findings', handle: crumb('Findings'), lazy: async () => ({ Component: (await import('@/features/findings/findings-page')).FindingsPage }) },
          {
            path: 'repositories',
            handle: crumb('Repositories'),
            children: [
              { index: true, lazy: async () => ({ Component: (await import('@/features/repositories/repositories-page')).RepositoriesPage }) },
              {
                path: ':name',
                handle: crumb((params) => params.name ?? ''),
                lazy: async () => ({ Component: (await import('@/features/repositories/repository-page')).RepositoryPage }),
              },
            ],
          },
          { path: 'runs/:runId?', handle: crumb('Runs'), lazy: async () => ({ Component: (await import('@/features/runs/runs-page')).RunsPage }) },
          { path: 'insights', handle: crumb('Insights'), lazy: async () => ({ Component: (await import('@/features/insights/insights-page')).InsightsPage }) },
          { path: 'settings', handle: crumb('Settings'), lazy: async () => ({ Component: (await import('@/features/settings/settings-page')).SettingsPage }) },
          { path: 'usage', loader: ({ request }) => redirect(`/insights${new URL(request.url).search}`) },
          { path: '*', Component: NotFound },
        ],
      },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
