import { useQuery } from '@tanstack/react-query';
import { Activity, ChartColumn, FolderGit2, LayoutDashboard, ListChecks, Search } from 'lucide-react';
import { Suspense, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { Logo } from '@/components/logo';
import { Page } from '@/components/page';
import { LoadingPage } from '@/components/query-state';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Separator } from '@/components/ui/separator';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { NewAuditProvider } from '@/features/runs/new-audit';
import { useHotkeys } from '@/hooks/use-hotkeys';
import { overviewQuery } from '@/lib/queries';
import { triageCount } from '@/lib/selectors';
import { cn } from '@/lib/utils';
import { Breadcrumbs } from './breadcrumbs';
import { CommandPalette } from './command-palette';
import { type Connection, useConnection, useRun } from './live';
import { RunIndicator } from './run-indicator';
import { ShortcutsDialog } from './shortcuts-dialog';
import { ThemeSwitch } from './theme-switch';

interface NavItem {
  to: string;
  label: string;
  icon: typeof Activity;
  end?: boolean;
}

const WORK: NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/findings', label: 'Findings', icon: ListChecks },
  { to: '/repositories', label: 'Repositories', icon: FolderGit2 },
];

const OPERATE: NavItem[] = [
  { to: '/runs', label: 'Runs', icon: Activity },
  { to: '/insights', label: 'Insights', icon: ChartColumn },
];

function NavGroup({ label, items, badges }: { label: string; items: NavItem[]; badges: Record<string, React.ReactNode> }) {
  const { pathname } = useLocation();
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const active = item.end ? pathname === item.to : pathname.startsWith(item.to);
            return (
              <SidebarMenuItem key={item.to}>
                <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                  <NavLink to={item.to} end={item.end}>
                    <item.icon />
                    <span>{item.label}</span>
                  </NavLink>
                </SidebarMenuButton>
                {badges[item.to] ? <SidebarMenuBadge>{badges[item.to]}</SidebarMenuBadge> : null}
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

const CONNECTION: Record<Connection, [string, string]> = {
  connecting: ['Connecting…', 'bg-muted-foreground'],
  live: ['Connected to RepoScout', 'bg-success'],
  down: ['Reconnecting…', 'bg-destructive'],
};

function ConnectionStatus() {
  const [text, dot] = CONNECTION[useConnection()];
  return (
    <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground group-data-[collapsible=icon]:justify-center">
      <span aria-hidden className={cn('size-2 shrink-0 rounded-full', dot)} />
      <span className="truncate group-data-[collapsible=icon]:hidden">{text}</span>
    </div>
  );
}

// The sidebar never waits for the overview: its badges appear once it has loaded.
function AppSidebar() {
  const { data: triage } = useQuery({ ...overviewQuery, select: triageCount });
  const running = useRun().active;
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/">
                {/* Important: the menu button shrinks every svg inside it to icon size. */}
                <Logo className="size-8!" />
                <span className="truncate text-base font-bold tracking-tight">
                  Repo<span className="text-(--mark-hat)">Scout</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavGroup label="Work" items={WORK} badges={{ '/findings': triage ? <span title={`${triage} in Triage`}>{triage}</span> : null }} />
        <NavGroup
          label="Operate"
          items={OPERATE}
          badges={{ '/runs': running ? <span role="img" aria-label="Run in progress" className="size-2 animate-pulse rounded-full bg-info" /> : null }}
        />
      </SidebarContent>
      <SidebarFooter>
        <ConnectionStatus />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function PageLoading() {
  return (
    <Page>
      <LoadingPage />
    </Page>
  );
}

export function AppLayout() {
  const [palette, setPalette] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  useHotkeys({ palette: () => setPalette((o) => !o), help: () => setShortcuts(true) }, { chord: ['palette'] });

  return (
    <NewAuditProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="h-svh overflow-hidden">
          <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
            <Breadcrumbs />
            <div className="ml-auto flex items-center gap-2">
              <RunIndicator />
              <Button variant="outline" size="sm" className="hidden gap-2 text-muted-foreground md:inline-flex" onClick={() => setPalette(true)}>
                <Search />
                Search or jump to…
                <Kbd>Ctrl K</Kbd>
              </Button>
              <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Open the command palette" onClick={() => setPalette(true)}>
                <Search />
              </Button>
              <ThemeSwitch />
            </div>
          </header>
          <main className="min-h-0 flex-1 overflow-y-auto">
            <Suspense fallback={<PageLoading />}>
              <Outlet />
            </Suspense>
          </main>
        </SidebarInset>
      </SidebarProvider>
      <CommandPalette
        open={palette}
        onOpenChange={setPalette}
        onShowShortcuts={() => {
          setPalette(false);
          setShortcuts(true);
        }}
      />
      <ShortcutsDialog open={shortcuts} onOpenChange={setShortcuts} />
    </NewAuditProvider>
  );
}
