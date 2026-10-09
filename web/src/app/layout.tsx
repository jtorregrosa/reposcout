import { Activity, ChartColumn, FolderGit2, LayoutDashboard, ListChecks } from 'lucide-react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { Logo } from '@/components/logo';
import { Badge } from '@/components/ui/badge';
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
import { useOverview } from '@/hooks/use-overview';
import { cn } from '@/lib/utils';
import { type Connection, useLive } from './live';
import { ThemeSwitch } from './theme-switch';

interface NavItem {
  to: string;
  label: string;
  icon: typeof Activity;
  end?: boolean;
}

const AUDIT: NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/findings', label: 'Findings', icon: ListChecks },
  { to: '/repositories', label: 'Repositories', icon: FolderGit2 },
];

const OPERATE: NavItem[] = [
  { to: '/runs', label: 'Runs', icon: Activity },
  { to: '/usage', label: 'Usage', icon: ChartColumn },
];

const TITLES: [RegExp, string][] = [
  [/^\/findings/, 'Findings'],
  [/^\/repositories/, 'Repositories'],
  [/^\/runs/, 'Runs'],
  [/^\/usage/, 'Usage'],
  [/^\/$/, 'Overview'],
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

function AppSidebar() {
  const { data } = useOverview();
  const { connection, live } = useLive();
  const open = data?.findings.filter((f) => f.status === 'open').length;
  const [connectionText, connectionDot] = CONNECTION[connection];
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
        <NavGroup label="Audit" items={AUDIT} badges={{ '/findings': open || null }} />
        <NavGroup label="Operate" items={OPERATE} badges={{ '/runs': live.active ? <span className="size-2 animate-pulse rounded-full bg-info" /> : null }} />
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground group-data-[collapsible=icon]:justify-center">
          <span aria-hidden className={cn('size-2 shrink-0 rounded-full', connectionDot)} />
          <span className="truncate group-data-[collapsible=icon]:hidden">{connectionText}</span>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function RunIndicator() {
  const { live } = useLive();
  if (!live.active) return null;
  return (
    <Badge asChild variant="outline" className="gap-1.5 border-info/40 text-info">
      <Link to="/runs">
        <span className="size-1.5 animate-pulse rounded-full bg-info" />
        Audit running{live.current ? ` · ${live.current}` : ''}
      </Link>
    </Badge>
  );
}

export function AppLayout() {
  const { pathname } = useLocation();
  const title = TITLES.find(([re]) => re.test(pathname))?.[1] ?? 'RepoScout';
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="h-svh overflow-hidden">
        <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
          <span className="text-sm font-medium">{title}</span>
          <div className="ml-auto flex items-center gap-2">
            <RunIndicator />
            <ThemeSwitch />
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
