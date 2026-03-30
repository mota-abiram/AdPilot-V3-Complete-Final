import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Megaphone,
  Palette,
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
import { cn } from "@/lib/utils";

// ─── Navigation groups — grouped by workflow, not alphabetically ───────────────

const coreNavItems = [
  { title: "Dashboard", url: "/",          icon: LayoutDashboard },
  { title: "Campaigns", url: "/campaigns", icon: Megaphone },
];

const metaNavItems = [
  { title: "Adsets",    url: "/adsets",    icon: Layers },
  { title: "Creatives", url: "/creatives", icon: Palette },
];

const googleNavItems = [
  { title: "Bidding",       url: "/google/bidding",       icon: IndianRupee },
  { title: "Ad Groups",     url: "/adsets",               icon: Layers },
  { title: "Ad Copy",       url: "/creatives",            icon: Palette },
  { title: "Quality Score", url: "/google/quality-score", icon: Search },
  { title: "Search Terms",  url: "/google/search-terms",  icon: Target },
  { title: "Demand Gen",    url: "/google/demand-gen",    icon: Users },
  { title: "Restructuring", url: "/google/restructuring", icon: GitBranch },
];

const planningNavItems = [
  { title: "Creative Calendar", url: "/creative-calendar", icon: CalendarClock },
  { title: "MTD Deliverables",  url: "/mtd-deliverables",  icon: FileBarChart },
  { title: "Breakdowns",        url: "/breakdowns",        icon: BarChart3 },
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
    <SidebarGroup className="py-1">
      <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 px-3 mb-0.5">
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

export function AppSidebar({ lastSynced }: AppSidebarProps) {
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
  } = useClient();

  const platformItems = activePlatform === "google" ? googleNavItems : metaNavItems;

  return (
    <Sidebar>
      {/* ── Header ─────────────────────────────────────────────────── */}
      <SidebarHeader className="p-4 pb-3 space-y-3">

        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary shadow-xs shrink-0">
            <Zap className="w-4 h-4 text-primary-foreground" />
          </div>
          <div>
            <p className="text-sm font-bold tracking-tight leading-none">Mojo</p>
            <p className="text-[10px] text-muted-foreground leading-none mt-0.5">Performance Agent</p>
          </div>
        </div>

        {/* Client selector */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "flex items-center justify-between w-full px-3 py-2.5 rounded-lg",
                "bg-muted/50 border border-border/50",
                "hover:bg-muted/80 transition-colors duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
              )}
              data-testid="button-client-selector"
            >
              <div className="flex flex-col items-start gap-0.5 min-w-0">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Client</span>
                <span className="text-[13px] font-semibold truncate max-w-[130px]">
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
        <div className="flex items-center gap-1.5">
          {activeClient?.platforms.map((platform) => {
            const isActive  = platform.id === activePlatform;
            const isEnabled = platform.enabled && platform.hasData;
            return (
              <Tooltip key={platform.id}>
                <TooltipTrigger asChild>
                  <button
                    className={cn(
                      "flex-1 px-3 py-1.5 text-[12px] font-semibold rounded-lg relative transition-colors duration-150",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isActive && isEnabled
                        ? "bg-primary/15 text-primary border border-primary/40"
                        : isEnabled
                          ? "text-muted-foreground border border-border/50 hover:bg-muted/60 hover:text-foreground"
                          : "text-muted-foreground/40 border border-border/30 cursor-not-allowed"
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

        {/* Cadence selector */}
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">Time window</p>
          <div className="flex items-center gap-1">
            {cadenceOptions.map((opt) => {
              const isActive = opt.value === activeCadence;
              return (
                <button
                  key={opt.value}
                  className={cn(
                    "flex-1 py-1 text-[11px] font-medium rounded-md transition-colors duration-150",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    isActive
                      ? "bg-primary/15 text-primary border border-primary/30 font-semibold"
                      : "text-muted-foreground border border-border/30 hover:bg-muted/50 hover:text-foreground"
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
      <SidebarContent className="gap-0">
        <NavSection label="Analytics"  items={[...coreNavItems, ...platformItems]} location={location} />
        <NavSection label="Planning"   items={planningNavItems}  location={location} />
        <NavSection label="Operations" items={opsNavItems}       location={location} />
        <NavSection label="Admin"      items={adminNavItems}     location={location} />
      </SidebarContent>

      {/* ── Footer ─────────────────────────────────────────────────── */}
      <SidebarFooter className="px-4 py-3 border-t border-sidebar-border">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            {lastSynced ? `Synced ${lastSynced}` : "Syncing…"}
          </span>
          <div className={cn(
            "w-1.5 h-1.5 rounded-full shrink-0",
            lastSynced ? "bg-emerald-500" : "bg-amber-400 animate-pulse"
          )} />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
