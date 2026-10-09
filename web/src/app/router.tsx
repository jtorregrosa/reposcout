import { createBrowserRouter, Link, useRouteError } from 'react-router';
import { Page } from '@/components/page';
import { ErrorAlert, LoadingPage } from '@/components/query-state';
import { Button } from '@/components/ui/button';
import { AppLayout } from './layout';

function RouteError() {
  const error = useRouteError();
  return (
    <Page>
      <ErrorAlert title="This page failed to render" error={error}>
        <Button asChild variant="outline" size="sm" className="mt-3">
          <Link to="/">Back to the overview</Link>
        </Button>
      </ErrorAlert>
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

// Each page is its own chunk, so the first paint loads only the shell and the page asked for.
export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    errorElement: <RouteError />,
    hydrateFallbackElement: <PageLoading />,
    children: [
      { index: true, lazy: async () => ({ Component: (await import('@/features/overview/overview-page')).OverviewPage }) },
      { path: 'findings', lazy: async () => ({ Component: (await import('@/features/findings/findings-page')).FindingsPage }) },
      { path: 'repositories', lazy: async () => ({ Component: (await import('@/features/repositories/repositories-page')).RepositoriesPage }) },
      { path: 'repositories/:name', lazy: async () => ({ Component: (await import('@/features/repositories/repository-page')).RepositoryPage }) },
      { path: 'runs/:runId?', lazy: async () => ({ Component: (await import('@/features/runs/runs-page')).RunsPage }) },
      { path: 'usage', lazy: async () => ({ Component: (await import('@/features/usage/usage-page')).UsagePage }) },
      { path: '*', Component: NotFound },
    ],
  },
]);
