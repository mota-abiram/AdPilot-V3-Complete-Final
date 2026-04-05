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
  Facebook,
  Globe,
  Plus,
  Loader2,
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
import logo from "@/assets/logo.png";


// ─── Navigation groups — grouped by workflow, not alphabetically ───────────────

const coreNavItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Campaigns", url: "/campaigns", icon: Megaphone },
  { title: "Audiences", url: "/audiences", icon: Users },
  { title: "Ads Panel", url: "/analytics/ads", icon: Clapperboard },
];

const metaNavItems = [
  { title: "Adsets", url: "/adsets", icon: Layers },
  { title: "Ads", url: "/ads", icon: Sparkles },
];

const googleNavItems = [
  { title: "Bidding Intel", url: "/google/bidding", icon: Brain },
  { title: "Ad Groups", url: "/adsets", icon: Layers },
  { title: "Keywords", url: "/keywords", icon: Search },
  { title: "Ads", url: "/ads", icon: Sparkles },
  { title: "Quality Score", url: "/google/quality-score", icon: BarChart3 },
  { title: "Search Terms", url: "/google/search-terms", icon: Target },
  { title: "Demand Gen", url: "/google/demand-gen", icon: Users },
  { title: "Restructuring", url: "/google/restructuring", icon: GitBranch },
];

const planningNavItems = [
  { title: "Breakdowns", url: "/breakdowns", icon: BarChart3 },
  { title: "Creative Calendar", url: "/creative-calendar", icon: CalendarClock },
  { title: "MTD Deliverables", url: "/mtd-deliverables", icon: FileBarChart },
];

const opsNavItems = [
  { title: "Audit Panels", url: "/audit", icon: ClipboardCheck },
  { title: "Recommendations", url: "/recommendations", icon: Lightbulb },
  { title: "Execution Log", url: "/execution-log", icon: Clock },
];

const adminNavItems = [
  { title: "Manage Clients", url: "/manage-clients", icon: Users },
  { title: "Benchmarks", url: "/benchmarks", icon: SlidersHorizontal },
  { title: "Settings", url: "/settings", icon: Settings },
];

const cadenceOptions = [
  { label: "1D", value: "daily" },
  { label: "2×/wk", value: "twice_weekly" },
  { label: "Wkly", value: "weekly" },
  { label: "Bi-wk", value: "biweekly" },
  { label: "Mo", value: "monthly" },
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
  const [location, setLocation] = useLocation();
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
            className="w-10 h-10 rounded-[10px] shadow-sm shrink-0 object-fill p-1"
          />
          <div className="grid gap-1 leading-none">
            <p className="text-lg font-extrabold tracking-[-0.03em] leading-none">Mojo AdCortex</p>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground leading-none">By Digital Mojo</p>
          </div>
        </div>

        {/* ── Unified Workspace Switcher ──────────────────────────────── */}
        <div className="grid gap-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground flex items-center justify-between px-1">
            Workspace
            {syncState?.sync_status === "loading" && <Loader2 className="w-2.5 h-2.5 animate-spin text-primary" />}
          </p>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  "flex items-center justify-between w-full px-3 py-2.5 rounded-lg",
                  "bg-card/84 border border-border/70 shadow-xs",
                  "hover:bg-accent/70 hover:border-primary/30 transition-all duration-200",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                )}
                data-testid="button-workspace-switcher"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0 transition-transform group-hover:scale-105 border border-primary/20">
                    {activePlatform === "google" ? <Globe className="size-4" /> : <Facebook className="size-4" />}
                  </div>
                  <div className="grid flex-1 text-left leading-tight">
                    <span className="truncate font-bold text-[14px] leading-none">{activeClient?.shortName || activeClient?.name || "Select Client"}</span>
                    <span className="truncate text-[10px] text-muted-foreground capitalize mt-1 flex items-center gap-1.5 leading-none">
                      {activePlatform} · <span className="opacity-70">{lastSynced || "Never synced"}</span>
                    </span>
                  </div>
                </div>
                <ChevronDown className="ml-auto size-3.5 text-muted-foreground shrink-0" />
              </button>
            </DropdownMenuTrigger>
            
            <DropdownMenuContent className="w-[260px] rounded-xl bg-background/95 backdrop-blur-xl border-border/60 shadow-2xl p-2" align="start" sideOffset={8}>
              <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                Switch Account
              </div>
              
              <div className="max-h-[350px] overflow-y-auto space-y-3 py-1">
                {clients.map((client) => (
                  <div key={client.id} className="space-y-1">
                    <div className="px-2 py-1 text-[11px] font-bold text-muted-foreground/45 flex items-center gap-2 uppercase tracking-tight">
                      {client.shortName || client.name}
                    </div>
                    {client.platforms.map((p) => {
                      const isSelected = client.id === activeClientId && p.id === activePlatform;
                      const isEnabled = p.enabled && p.hasData;
                      
                      return (
                        <DropdownMenuItem
                          key={`${client.id}-${p.id}`}
                          onClick={() => {
                            if (isEnabled) {
                              setActiveClientId(client.id);
                              setActivePlatform(p.id);
                            }
                          }}
                          disabled={!isEnabled}
                          className={cn(
                            "flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-all duration-150",
                            isSelected 
                              ? "bg-primary/16 text-primary ring-1 ring-primary/30" 
                              : "hover:bg-accent/60"
                          )}
                        >
                          <div className={cn(
                            "size-6 flex items-center justify-center rounded-md border text-[10px] font-bold",
                            isSelected ? "border-primary/30 bg-primary/20 text-primary" : "border-border/40 bg-muted/40 text-muted-foreground"
                          )}>
                            {p.id === "google" ? <Globe className="size-3.5" /> : <Facebook className="size-3.5" />}
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="text-[13px] font-medium leading-tight">{p.label}</span>
                            <span className="text-[10px] text-muted-foreground leading-none mt-0.5">
                              {p.hasData ? "Active Connected" : "Not Integrated"}
                            </span>
                          </div>
                          {isSelected && <Check className="ml-auto size-3.5 text-primary" />}
                          {!isEnabled && (
                            <Badge variant="outline" className="ml-auto text-[9px] px-1 py-0 opacity-50 border-muted-foreground/30">
                              Soon
                            </Badge>
                          )}
                        </DropdownMenuItem>
                      );
                    })}
                  </div>
                ))}
              </div>
              
              <div className="border-t border-border/40 my-2" />
              <DropdownMenuItem 
                onClick={() => setLocation("/manage-clients")} 
                className="text-primary font-semibold flex items-center gap-2 px-2.5 py-2 hover:bg-primary/5 rounded-lg"
              >
                <Plus className="size-4" /> 
                <span className="text-[13px]">Manage Client Registry</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
          <NavSection label="Analytics" items={[...coreNavItems, ...platformItems]} location={location} />
          <NavSection label="Planning" items={planningNavItems} location={location} />
          <NavSection label="Operations" items={opsNavItems} location={location} />
          <NavSection label="Admin" items={adminItems} location={location} />
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
