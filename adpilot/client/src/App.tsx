import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider, useTheme } from "@/components/theme-provider";
import { ClientProvider, useClient } from "@/lib/client-context";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { LogOut, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { CommandTerminal, CommandTerminalToggle } from "@/components/command-terminal";
import LoginPage from "@/pages/login";
import NotFound from "@/pages/not-found";
import DashboardPage from "@/pages/dashboard";
import CampaignsPage from "@/pages/campaigns";
import CreativesPage from "@/pages/creatives";
import AuditPage from "@/pages/audit";
import RecommendationsPage from "@/pages/recommendations";
import SettingsPage from "@/pages/settings";
import CommandCenterPage from "@/pages/command-center";
import AdsetsPage from "@/pages/adsets";
import ExecutionLogPage from "@/pages/execution-log";
import ManageClientsPage from "@/pages/manage-clients";
import BenchmarksPage from "@/pages/benchmarks";
import BreakdownsPage from "@/pages/breakdowns";
import GoogleQualityScorePage from "@/pages/google/quality-score";
import GoogleSearchTermsPage from "@/pages/google/search-terms";
import GoogleBiddingPage from "@/pages/google/bidding";
import GoogleDemandGenPage from "@/pages/google/demand-gen";
import GoogleRestructuringPage from "@/pages/google/restructuring";
import CreativeCalendarPage from "@/pages/creative-calendar";
import MtdDeliverablesPage from "@/pages/mtd-deliverables";
import { timeAgo } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import { useLiveUpdates } from "@/hooks/use-live-updates";
import { useNow } from "@/hooks/use-now";

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <Button
      size="icon"
      variant="ghost"
      onClick={toggleTheme}
      data-testid="button-theme-toggle"
    >
      {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </Button>
  );
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={DashboardPage} />
      <Route path="/campaigns" component={CampaignsPage} />
      <Route path="/adsets" component={AdsetsPage} />
      <Route path="/creatives" component={CreativesPage} />
      <Route path="/audit" component={AuditPage} />
      <Route path="/recommendations" component={RecommendationsPage} />
      <Route path="/command-center" component={CommandCenterPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/execution-log" component={ExecutionLogPage} />
      <Route path="/manage-clients" component={ManageClientsPage} />
      <Route path="/benchmarks" component={BenchmarksPage} />
      <Route path="/breakdowns" component={BreakdownsPage} />
      <Route path="/google/quality-score" component={GoogleQualityScorePage} />
      <Route path="/google/search-terms" component={GoogleSearchTermsPage} />
      <Route path="/google/bidding" component={GoogleBiddingPage} />
      <Route path="/google/demand-gen" component={GoogleDemandGenPage} />
      <Route path="/google/restructuring" component={GoogleRestructuringPage} />
      <Route path="/creative-calendar" component={CreativeCalendarPage} />
      <Route path="/mtd-deliverables" component={MtdDeliverablesPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppLayout() {
  useLiveUpdates();
  const { analysisData, activeClient, activePlatformInfo, syncState } = useClient();
  const { user, logout } = useAuth();
  const [terminalOpen, setTerminalOpen] = useState(false);
  useNow();

  const lastSynced = syncState?.last_synced_at ? timeAgo(syncState.last_synced_at) : undefined;

  const sidebarStyle = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={sidebarStyle as React.CSSProperties}>
      <div className="flex h-screen w-full overflow-hidden">
        <AppSidebar syncState={syncState} lastSynced={lastSynced} />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border/50 shrink-0 bg-background/80 backdrop-blur-sm z-10">
            <div className="flex items-center gap-2">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
              <span className="text-xs text-muted-foreground hidden md:inline">
                {activeClient?.name || ""}
                {activePlatformInfo?.enabled
                  ? ` · ${activePlatformInfo.label}`
                  : ""}
                {analysisData?.period?.primary_7d
                  ? ` · ${analysisData.period.primary_7d.start} — ${analysisData.period.primary_7d.end}`
                  : ""}
              </span>
              {analysisData?.cadence && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 hidden md:inline-flex">
                  {analysisData.cadence.replace(/_/g, " ")}
                </Badge>
              )}
              {analysisData?.agent_version && (
                <span className="text-[10px] text-muted-foreground hidden md:inline">
                  {analysisData.agent_version}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground hidden lg:inline">
                {user?.name} · {user?.role}
              </span>
              <Button size="icon" variant="ghost" onClick={logout} data-testid="button-logout">
                <LogOut className="w-4 h-4" />
              </Button>
              <CommandTerminalToggle onClick={() => setTerminalOpen((o) => !o)} isOpen={terminalOpen} />
              <ThemeToggle />
            </div>
          </header>
          <main className="flex-1 overflow-y-auto overflow-x-hidden" style={{ overscrollBehavior: "contain" }}>
            <AppRouter />
            <div className="px-6 py-3 border-t border-border/30">
              <PerplexityAttribution />
            </div>
          </main>
        </div>
      </div>
      <CommandTerminal isOpen={terminalOpen} onClose={() => setTerminalOpen(false)} />
    </SidebarProvider>
  );
}

function AuthGate() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        Checking access...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <ClientProvider>
      <AppLayout />
    </ClientProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <Router hook={useHashLocation}>
            <AuthProvider>
              <AuthGate />
            </AuthProvider>
          </Router>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
