import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Megaphone,
  ClipboardCheck,
  Lightbulb,
  Settings,
  ChevronDown,
  Check,
  Zap,
  MapPin,
  Layers,
  Clock,
  BarChart3,
  SlidersHorizontal,
  Search,
  Target,
  IndianRupee,
  Users,
  GitBranch,
  CalendarClock,
  FileBarChart,
  Sparkles,
  Clapperboard,
  Brain,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useClient } from "@/lib/client-context";
import { useAuth } from "@/lib/auth-context";
import type { PlatformSyncState } from "@/lib/sync-state";
import { cn } from "@/lib/utils";
import logo from "../assets/logo.png";


// ─── Navigation groups — grouped by workflow, not alphabetically ───────────────

const coreNavItems = [
  { title: "Dashboard", url: "/",          icon: LayoutDashboard },
  { title: "Campaigns", url: "/campaigns", icon: Megaphone },
  { title: "Ads Panel", url: "/analytics/ads", icon: Clapperboard },
];

const metaNavItems = [
  { title: "Adsets",    url: "/adsets",    icon: Layers },
  { title: "Ads",       url: "/ads",       icon: Sparkles },
];

const googleNavItems = [
  { title: "Bidding Intel",  url: "/google/bidding",       icon: Brain },
  { title: "Ad Groups",     url: "/adsets",               icon: Layers },
  { title: "Ads",           url: "/ads",                  icon: Sparkles },
  { title: "Quality Score", url: "/google/quality-score", icon: Search },
  { title: "Search Terms",  url: "/google/search-terms",  icon: Target },
  { title: "Demand Gen",    url: "/google/demand-gen",    icon: Users },
  { title: "Restructuring", url: "/google/restructuring", icon: GitBranch },
];

const planningNavItems = [
  { title: "Breakdowns",        url: "/breakdowns",        icon: BarChart3 },
  { title: "Creative Calendar", url: "/creative-calendar", icon: CalendarClock },
  { title: "MTD Deliverables",  url: "/mtd-deliverables",  icon: FileBarChart },
];

const opsNavItems = [
  { title: "Audit Panels",    url: "/audit",           icon: ClipboardCheck },
  { title: "Recommendations", url: "/recommendations", icon: Lightbulb },
  { title: "Execution Log",   url: "/execution-log",   icon: Clock },
];

const adminNavItems = [
  { title: "Manage Clients", url: "/manage-clients", icon: Users },
  { title: "Benchmarks",     url: "/benchmarks",     icon: SlidersHorizontal },
  { title: "Settings",       url: "/settings",       icon: Settings },
];

const cadenceOptions = [
  { label: "1D",    value: "daily" },
  { label: "2×/wk", value: "twice_weekly" },
  { label: "Wkly",  value: "weekly" },
  { label: "Bi-wk", value: "biweekly" },
  { label: "Mo",    value: "monthly" },
];

interface AppSidebarProps {
  syncState?: PlatformSyncState;
  lastSynced?: string;
}

// ─── Reusable grouped nav section ─────────────────────────────────────────────

function NavSection({
  label,
  items,
  location,
}: {
  label: string;
  items: { title: string; url: string; icon: any }[];
  location: string;
}) {
  return (
    <SidebarGroup className="py-1.5">
      <SidebarGroupLabel className="px-3 mb-1">
        {label}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const isActive =
              item.url === "/"
                ? location === "/" || location === ""
                : location.startsWith(item.url);
            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton asChild isActive={isActive}>
                  <Link
                    href={item.url}
                    data-testid={`link-nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    <item.icon className="w-4 h-4 shrink-0" />
                    <span className="text-[13px]">{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

// ─── Main sidebar ──────────────────────────────────────────────────────────────

export function AppSidebar({ syncState, lastSynced }: AppSidebarProps) {
  const [location] = useLocation();
  const {
    clients,
    activeClientId,
    activePlatform,
    activeClient,
    setActiveClientId,
    setActivePlatform,
    activeCadence,
    setActiveCadence,
    apiBase,
  } = useClient();
  const { isAdmin } = useAuth();

  const platformItems = activePlatform === "google" ? googleNavItems : metaNavItems;
  const adminItems = isAdmin ? adminNavItems : adminNavItems.filter(i => i.title === "Settings");

  return (
    <Sidebar>
      {/* ── Header ─────────────────────────────────────────────────── */}
      <SidebarHeader className="shrink-0 p-4 pb-4 space-y-4 border-b border-sidebar-border/70">

        {/* Logo */}
        <div className="flex items-center gap-3">
          <img 
            src={logo} 
            alt="Mojo Logo" 
            className="w-10 h-10 rounded-[10px] shadow-sm shrink-0 object-cover" 
          />
          <div className="grid gap-1 leading-none">
            <p className="text-lg font-extrabold tracking-[-0.03em] leading-none">Mojo</p>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground leading-none">AdPilot V3</p>
          </div>
        </div>

        {/* Client selector */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "flex items-center justify-between w-full px-3 py-2.5 rounded-lg",
                "bg-card/84 border border-border/70 shadow-xs",
                "hover:bg-accent/70 hover:border-primary/30 transition-colors duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
              )}
              data-testid="button-client-selector"
            >
              <div className="flex flex-col items-start gap-0.5 min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Client</span>
                <span className="text-[15px] font-semibold truncate max-w-[150px]">
                  {activeClient?.shortName || activeClient?.name || "Select client"}
                </span>
                {activeClient?.location && (
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <MapPin className="w-2.5 h-2.5 shrink-0" />
                    {activeClient.location}
                  </span>
                )}
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0 ml-2" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            {clients.map((client) => (
              <DropdownMenuItem
                key={client.id}
                onClick={() => setActiveClientId(client.id)}
                className="flex items-center justify-between gap-2 py-2.5"
                data-testid={`menu-item-client-${client.id}`}
              >
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-sm font-medium truncate">{client.name}</span>
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <MapPin className="w-2.5 h-2.5 shrink-0" />
                    {client.location}
                    <span className="opacity-50">·</span>
                    {client.platforms.filter((p) => p.enabled).length} platform{client.platforms.filter((p) => p.enabled).length !== 1 ? "s" : ""}
                  </span>
                </div>
                {client.id === activeClientId && (
                  <Check className="w-4 h-4 text-primary shrink-0" />
                )}
              </DropdownMenuItem>
            ))}
            {clients.length === 0 && (
              <DropdownMenuItem disabled>
                <span className="text-sm text-muted-foreground">No clients configured</span>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Platform toggle */}
        <div className="grid gap-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Channels</p>
          <div className="flex items-center gap-1.5">
          {activeClient?.platforms.map((platform) => {
            const isActive  = platform.id === activePlatform;
            const isEnabled = platform.enabled && platform.hasData;
            return (
              <Tooltip key={platform.id}>
                <TooltipTrigger asChild>
                  <button
                    className={cn(
                      "flex-1 px-3 py-2 text-[12px] font-semibold rounded-lg relative border transition-colors duration-150",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isActive && isEnabled
                        ? "bg-primary/16 text-foreground border-primary/35 shadow-xs"
                        : isEnabled
                          ? "text-muted-foreground border-border/60 bg-card/70 hover:bg-accent/75 hover:text-foreground"
                          : "text-muted-foreground/40 border-border/30 bg-muted/30 cursor-not-allowed"
                    )}
                    onClick={() => { if (isEnabled) setActivePlatform(platform.id); }}
                    disabled={!isEnabled}
                    data-testid={`button-platform-${platform.id}`}
                  >
                    {platform.id === "meta" ? "Meta" : platform.id === "google" ? "Google" : platform.label}
                    {!isEnabled && (
                      <Badge variant="secondary" className="absolute -top-2 -right-1.5 text-[9px] px-1 py-0 leading-none">
                        Soon
                      </Badge>
                    )}
                  </button>
                </TooltipTrigger>
                {!isEnabled && (
                  <TooltipContent side="bottom" className="text-xs">
                    {!platform.enabled ? "Not yet enabled" : "No data available"}
                  </TooltipContent>
                )}
              </Tooltip>
            );
          })}
          </div>
        </div>

        {/* Cadence selector */}
        <div className="grid gap-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Time Window</p>
          <div className="grid grid-cols-5 gap-1.5">
            {cadenceOptions.map((opt) => {
              const isActive = opt.value === activeCadence;
              return (
                <button
                  key={opt.value}
                  className={cn(
                    "py-1.5 text-[11px] font-semibold rounded-md border transition-colors duration-150",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    isActive
                      ? "bg-primary/16 text-foreground border-primary/35 shadow-xs"
                      : "text-muted-foreground border-border/40 bg-card/65 hover:bg-accent/70 hover:text-foreground"
                  )}
                  onClick={() => setActiveCadence(opt.value)}
                  data-testid={`button-cadence-${opt.value}`}
                  title={opt.value.replace(/_/g, " ")}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </SidebarHeader>

      {/* ── Navigation groups ───────────────────────────────────────── */}
      <nav
        aria-label="Primary navigation"
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <SidebarContent className="gap-0">
          <NavSection label="Analytics"  items={[...coreNavItems, ...platformItems]} location={location} />
          <NavSection label="Planning"   items={planningNavItems}  location={location} />
          <NavSection label="Operations" items={opsNavItems}       location={location} />
          <NavSection label="Admin"      items={adminItems}        location={location} />
        </SidebarContent>
      </nav>

      {/* ── Footer ─────────────────────────────────────────────────── */}
      <SidebarFooter className="shrink-0 px-4 py-3 border-t border-sidebar-border/70 bg-background/40">
        <div className="flex items-center justify-between rounded-lg border border-border/60 bg-card/76 px-3 py-2 shadow-xs">
          <span className="text-[11px] font-medium text-muted-foreground">
            {syncState?.sync_status === "failed"
              ? "Sync failed"
              : syncState?.sync_status === "loading"
                ? "Syncing..."
                : lastSynced
                  ? `Synced ${lastSynced}`
                  : "Syncing..."}
          </span>
          <div className={cn(
            "w-2 h-2 rounded-full shrink-0",
            syncState?.sync_status === "failed"
              ? "bg-red-500"
              : syncState?.sync_status === "loading"
                ? "bg-amber-400 animate-pulse"
                : lastSynced
                  ? "bg-emerald-500"
                  : "bg-amber-400 animate-pulse"
          )} />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
