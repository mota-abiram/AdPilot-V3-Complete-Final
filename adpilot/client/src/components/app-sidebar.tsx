import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Megaphone,
  Palette,
  ClipboardCheck,
  Lightbulb,
  Terminal,
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
  DollarSign,
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

const commonNavItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Campaigns", url: "/campaigns", icon: Megaphone },
];

const metaNavItems = [
  { title: "Adsets", url: "/adsets", icon: Layers },
  { title: "Creatives", url: "/creatives", icon: Palette },
];

const googleNavItems = [
  { title: "Bidding", url: "/google/bidding", icon: DollarSign },
  { title: "Ad Groups", url: "/adsets", icon: Layers },
  { title: "Ad Copy", url: "/creatives", icon: Palette },
  { title: "Quality Score", url: "/google/quality-score", icon: Search },
  { title: "Search Terms", url: "/google/search-terms", icon: Target },
  { title: "Demand Gen", url: "/google/demand-gen", icon: Users },
  { title: "Restructuring", url: "/google/restructuring", icon: GitBranch },
];

const trailingNavItems = [
  { title: "Creative Calendar", url: "/creative-calendar", icon: CalendarClock },
  { title: "MTD Deliverables", url: "/mtd-deliverables", icon: FileBarChart },
  { title: "Breakdowns", url: "/breakdowns", icon: BarChart3 },
  { title: "Audit Panels", url: "/audit", icon: ClipboardCheck },
  { title: "Recommendations", url: "/recommendations", icon: Lightbulb },
  { title: "Command Center", url: "/command-center", icon: Terminal },
  { title: "Exec Log", url: "/execution-log", icon: Clock },
  { title: "Settings", url: "/settings", icon: Settings },
  { title: "Benchmarks", url: "/benchmarks", icon: SlidersHorizontal },
];

function getNavItems(platform: string) {
  const platformItems = platform === "google" ? googleNavItems : metaNavItems;
  return [...commonNavItems, ...platformItems, ...trailingNavItems];
}

const cadenceOptions = [
  { label: "Daily", value: "daily" },
  { label: "Twice Weekly", value: "twice_weekly" },
  { label: "Weekly", value: "weekly" },
  { label: "Bi-Weekly", value: "biweekly" },
  { label: "Monthly", value: "monthly" },
];

interface AppSidebarProps {
  lastSynced?: string;
}

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

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        {/* Logo */}
        <div className="flex items-center gap-2 mb-4">
          <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary">
            <Zap className="w-4 h-4 text-primary-foreground" />
          </div>
          <div className="flex flex-col">
            <span className="text-base font-bold tracking-tight text-foreground leading-tight">
              Mojo
            </span>
            <span className="text-[10px] text-muted-foreground leading-tight">
              Performance Agent
            </span>
          </div>
        </div>

        {/* Client Selector — real dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center justify-between w-full px-3 py-2.5 text-xs rounded-md bg-muted/50 border border-border/50 text-foreground hover:bg-muted/80 transition-colors"
              data-testid="button-client-selector"
            >
              <div className="flex flex-col items-start gap-0.5 min-w-0">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Client
                </span>
                <span className="font-medium truncate max-w-[140px]">
                  {activeClient?.shortName || activeClient?.name || "Select client"}
                </span>
                {activeClient?.location && (
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <MapPin className="w-2.5 h-2.5" />
                    {activeClient.location}
                  </span>
                )}
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {clients.map((client) => (
              <DropdownMenuItem
                key={client.id}
                onClick={() => setActiveClientId(client.id)}
                className="flex items-center justify-between"
                data-testid={`menu-item-client-${client.id}`}
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">{client.name}</span>
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <MapPin className="w-2.5 h-2.5" />
                    {client.location}
                    <span className="ml-1">
                      · {client.platforms.filter((p) => p.enabled).length} platform{client.platforms.filter((p) => p.enabled).length !== 1 ? "s" : ""}
                    </span>
                  </span>
                </div>
                {client.id === activeClientId && (
                  <Check className="w-4 h-4 text-primary" />
                )}
              </DropdownMenuItem>
            ))}
            {clients.length === 0 && (
              <DropdownMenuItem disabled>
                <span className="text-muted-foreground">No clients configured</span>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Platform Toggle — dynamic from client's platforms */}
        <div className="flex items-center gap-1 mt-3">
          {activeClient?.platforms.map((platform) => {
            const isActive = platform.id === activePlatform;
            const isEnabled = platform.enabled && platform.hasData;
            return (
              <Tooltip key={platform.id}>
                <TooltipTrigger asChild>
                  <button
                    className={cn(
                      "flex-1 px-3 py-1.5 text-xs font-medium rounded-md relative transition-colors",
                      isActive && isEnabled
                        ? "bg-primary/15 text-primary border border-primary/30"
                        : isEnabled
                          ? "text-foreground border border-border/50 hover:bg-muted/50"
                          : "text-muted-foreground border border-border/30 opacity-50 cursor-not-allowed"
                    )}
                    onClick={() => {
                      if (isEnabled) setActivePlatform(platform.id);
                    }}
                    disabled={!isEnabled}
                    data-testid={`button-platform-${platform.id}`}
                  >
                    {platform.id === "meta" ? "Meta" : platform.id === "google" ? "Google" : platform.label}
                    {!isEnabled && (
                      <Badge variant="secondary" className="absolute -top-2 -right-2 text-[9px] px-1 py-0">
                        Soon
                      </Badge>
                    )}
                  </button>
                </TooltipTrigger>
                {!isEnabled && (
                  <TooltipContent side="bottom">
                    <p className="text-xs">
                      {!platform.enabled ? "Not yet enabled" : "No data available"}
                    </p>
                  </TooltipContent>
                )}
              </Tooltip>
            );
          })}
        </div>

        {/* Cadence Selector */}
        <div className="flex items-center gap-1 mt-3">
          {cadenceOptions.map((opt) => {
            const isActive = opt.value === activeCadence;
            return (
              <button
                key={opt.value}
                className={cn(
                  "flex-1 px-1.5 py-1 text-[10px] font-medium rounded-md transition-colors",
                  isActive
                    ? "bg-primary/15 text-primary border border-primary/30"
                    : "text-muted-foreground border border-border/30 hover:bg-muted/50"
                )}
                onClick={() => setActiveCadence(opt.value)}
                data-testid={`button-cadence-${opt.value}`}
              >
                {opt.value === "daily" ? "1D" : opt.value === "twice_weekly" ? "2×/wk" : opt.value === "weekly" ? "Wkly" : opt.value === "biweekly" ? "Bi-wk" : "Mo"}
              </button>
            );
          })}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Navigation
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {getNavItems(activePlatform).map((item) => {
                const isActive =
                  item.url === "/"
                    ? location === "/" || location === ""
                    : location.startsWith(item.url);
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                    >
                      <Link href={item.url} data-testid={`link-nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}>
                        <item.icon className="w-4 h-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4">
        <div className="text-[10px] text-muted-foreground">
          {lastSynced ? `Last synced: ${lastSynced}` : "Syncing…"}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
