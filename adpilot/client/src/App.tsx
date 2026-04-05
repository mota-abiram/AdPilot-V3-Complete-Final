import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { ClientProvider, useClient } from "@/lib/client-context";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { ErrorBoundary } from "@/components/error-boundary";
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
import AnalyticsAdsPage from "@/pages/analytics-ads";
import KeywordsPage from "@/pages/keywords.tsx";
import AudiencesPage from "@/pages/audiences.tsx";
import { timeAgo } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import { useLiveUpdates } from "@/hooks/use-live-updates";
import { useNow } from "@/hooks/use-now";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={DashboardPage} />
      <Route path="/campaigns" component={CampaignsPage} />
      <Route path="/adsets" component={AdsetsPage} />
      <Route path="/ads" component={CreativesPage} />
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
      <Route path="/analytics/ads" component={AnalyticsAdsPage} />
      <Route path="/keywords" component={KeywordsPage} />
      <Route path="/audiences" component={AudiencesPage} />
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
    "--sidebar-width": "17rem",
    "--sidebar-width-icon": "3rem",
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setTerminalOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <SidebarProvider style={sidebarStyle as React.CSSProperties}>
      <div className="flex h-screen w-full overflow-hidden bg-background">
        <aside aria-label="Primary sidebar">
          <AppSidebar syncState={syncState} lastSynced={lastSynced} />
        </aside>
        <div className="flex flex-col flex-1 min-w-0 bg-[linear-gradient(180deg,hsl(var(--background)),hsl(var(--muted)/0.55))]">
          <header className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border/60 shrink-0 bg-background/88 backdrop-blur-xl z-10">
            <nav className="flex items-center gap-3" aria-label="Workspace controls">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
              <div className="hidden md:grid leading-none gap-1">
                <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                  {activeClient?.name || "No client selected"}
                </span>
                <span className="text-sm font-medium text-foreground/90">
                  {activePlatformInfo?.enabled ? activePlatformInfo.label : "Platform unavailable"}
                  {analysisData?.period?.primary_7d
                    ? ` · ${analysisData.period.primary_7d.start} — ${analysisData.period.primary_7d.end}`
                    : ""}
                </span>
              </div>
              {analysisData?.cadence && (
                <Badge variant="warning" className="hidden md:inline-flex">
                  {analysisData.cadence.replace(/_/g, " ")}
                </Badge>
              )}
              {analysisData?.agent_version && (
                <span className="text-[11px] font-medium text-muted-foreground hidden md:inline">
                  {analysisData.agent_version}
                </span>
              )}
            </nav>
            <div className="flex items-center gap-2.5" aria-label="User actions">
              <span className="hidden lg:grid text-right leading-none gap-1">
                <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Operator</span>
                <span className="text-sm font-medium text-foreground/90">
                  {user?.name} · {user?.role}
                </span>
              </span>
              <Button size="icon" variant="outline" onClick={logout} aria-label="Log out" data-testid="button-logout">
                <LogOut className="w-4 h-4" />
              </Button>
              <CommandTerminalToggle onClick={() => setTerminalOpen((o) => !o)} isOpen={terminalOpen} />
            </div>
          </header>
          <main className="flex-1 overflow-y-auto overflow-x-hidden" style={{ overscrollBehavior: "contain" }}>
            <section aria-label="Workspace content">
              <ErrorBoundary>
                <AppRouter />
              </ErrorBoundary>
            </section>
            <aside className="px-6 py-4 border-t border-border/40 bg-background/72 backdrop-blur-sm" aria-label="Attribution">
              <PerplexityAttribution />
            </aside>
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
    <ErrorBoundary>
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
    </ErrorBoundary>
  );
}

export default App;
