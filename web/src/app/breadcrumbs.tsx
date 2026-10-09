import { Fragment } from 'react';
import { Link, useMatches } from 'react-router';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import type { RouteHandle } from './router';

const hasCrumb = (handle: unknown): handle is RouteHandle => typeof handle === 'object' && handle != null && 'crumb' in handle;

export function Breadcrumbs() {
  const crumbs = useMatches()
    .filter((m) => hasCrumb(m.handle))
    .map((m) => {
      const { crumb } = m.handle as RouteHandle;
      return { id: m.id, to: m.pathname, label: typeof crumb === 'function' ? crumb(m.params) : crumb };
    });
  if (!crumbs.length) return <span className="text-sm font-medium">RepoScout</span>;
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map((c, i) => (
          <Fragment key={c.id}>
            {i > 0 ? <BreadcrumbSeparator /> : null}
            <BreadcrumbItem>
              {i === crumbs.length - 1 ? (
                <BreadcrumbPage className="font-medium">{c.label}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink asChild>
                  <Link to={c.to}>{c.label}</Link>
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
