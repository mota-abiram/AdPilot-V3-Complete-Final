import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AnalysisData } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";

// ─── Cadence-aware metric recalculation ─────────────────────────────
// The Python agent stores the same aggregate totals across all cadence files.
// We recalculate totals from the per-day arrays so metrics actually reflect
// the selected time window (1D / 7D / 14D / 30D / MTD).
function recalcMetricsFromDailyArrays(data: any): any {
  if (!data?.account_pulse) return data;
  const ap = data.account_pulse;

  // Support both flat arrays (Meta) and daily_trends objects (Google)
  let dailySpends: number[] = ap.daily_spends || [];
  let dailyLeads: number[] = ap.daily_leads || [];
  let dailyCtrs: number[] = ap.daily_ctrs || [];

  // Fallback: extract from daily_trends array (Google format)
  if (dailySpends.length === 0 && (ap.daily_trends?.length > 0 || data.daily_trends?.length > 0)) {
    const trends = ap.daily_trends || data.daily_trends || [];
    dailySpends = trends.map((d: any) => d.spend || d.cost || 0);
    dailyLeads = trends.map((d: any) => d.leads || d.conversions || 0);
    dailyCtrs = trends.map((d: any) => d.ctr || 0);
  }

  if (dailySpends.length === 0) return data;

  const totalSpend = dailySpends.reduce((s, v) => s + v, 0);
  const totalLeads = dailyLeads.reduce((s, v) => s + v, 0);
  const avgCtr = dailyCtrs.length > 0
    ? dailyCtrs.reduce((s, v) => s + v, 0) / dailyCtrs.length
    : ap.overall_ctr || 0;
  const cpl = totalLeads > 0 ? totalSpend / totalLeads : 0;

  // Build updated account_pulse with recalculated totals
  const updatedAp = {
    ...ap,
    total_spend_30d: totalSpend,
    total_spend: totalSpend,
    total_leads_30d: Math.round(totalLeads),
    total_leads: Math.round(totalLeads),
    overall_cpl: Math.round(cpl),
    overall_ctr: avgCtr,
    daily_avg_spend: dailySpends.length > 0 ? totalSpend / dailySpends.length : 0,
    avg_daily_leads: dailyLeads.length > 0 ? totalLeads / dailyLeads.length : 0,
    latest_daily_spend: dailySpends.length > 0 ? dailySpends[dailySpends.length - 1] : 0,
    latest_daily_leads: dailyLeads.length > 0 ? dailyLeads[dailyLeads.length - 1] : 0,
    zero_lead_days: dailyLeads.filter((d) => d === 0).length,
  };

  // Also recalculate summary
  const updatedSummary = data.summary ? {
    ...data.summary,
    total_spend: totalSpend,
    total_leads: Math.round(totalLeads),
    avg_cpl: Math.round(cpl),
    overall_ctr: avgCtr,
  } : data.summary;

  return {
    ...data,
    account_pulse: updatedAp,
    summary: updatedSummary,
  };
}

// ─── Types ──────────────────────────────────────────────────────────

export interface PlatformInfo {
  id: string;
  label: string;
  enabled: boolean;
  hasData: boolean;
}

export interface ClientInfo {
  id: string;
  name: string;
  shortName: string;
  project: string;
  location: string;
  platforms: PlatformInfo[];
  targets: Record<string, {
    budget: number;
    leads: number;
    cpl: number;
    svs: { low: number; high: number };
    cpsv: { low: number; high: number };
  }>;
}

interface ClientContextValue {
  // Registry
  clients: ClientInfo[];
  isLoadingClients: boolean;

  // Current selection
  activeClientId: string;
  activePlatform: string;
  activeCadence: string;
  activeClient: ClientInfo | undefined;
  activePlatformInfo: PlatformInfo | undefined;

  // Setters
  setActiveClientId: (id: string) => void;
  setActivePlatform: (platform: string) => void;
  setActiveCadence: (cadence: string) => void;

  // Data
  analysisData: AnalysisData | undefined;
  isLoadingAnalysis: boolean;
  analysisError: Error | null;

  // Helpers
  apiBase: string; // e.g. "/api/clients/amara/meta"
}

const ClientContext = createContext<ClientContextValue | null>(null);

// ─── Provider ───────────────────────────────────────────────────────

export function ClientProvider({ children }: { children: ReactNode }) {
  const [activeClientId, setActiveClientId] = useState("amara");
  const [activePlatform, setActivePlatform] = useState("meta");
  const [activeCadence, setActiveCadence] = useState("twice_weekly");

  // Fetch client registry
  const { data: clients = [], isLoading: isLoadingClients } = useQuery<ClientInfo[]>({
    queryKey: ["/api/clients"],
  });

  const activeClient = clients.find((c) => c.id === activeClientId);
  const activePlatformInfo = activeClient?.platforms.find((p) => p.id === activePlatform);

  const apiBase = `/api/clients/${activeClientId}/${activePlatform}`;

  // Fetch analysis data for active client/platform/cadence
  const {
    data: rawAnalysisData,
    isLoading: isLoadingAnalysis,
    error: analysisError,
  } = useQuery<AnalysisData>({
    queryKey: [apiBase, "analysis", activeCadence],
    queryFn: async () => {
      const res = await apiRequest("GET", `${apiBase}/analysis?cadence=${activeCadence}`);
      return res.json();
    },
    enabled: !!activePlatformInfo?.enabled && !!activePlatformInfo?.hasData,
    retry: false,
  });

  // Recalculate aggregate metrics from daily arrays so they reflect the cadence window
  const analysisData = useMemo(() => {
    if (!rawAnalysisData) return undefined;
    return recalcMetricsFromDailyArrays(rawAnalysisData) as AnalysisData;
  }, [rawAnalysisData]);

  // When switching clients, auto-select the first enabled platform
  const handleSetActiveClient = useCallback((id: string) => {
    setActiveClientId(id);
    const client = clients.find((c) => c.id === id);
    if (client) {
      const firstEnabled = client.platforms.find((p) => p.enabled && p.hasData);
      if (firstEnabled) {
        setActivePlatform(firstEnabled.id);
      } else {
        // Default to first platform even if not enabled
        setActivePlatform(client.platforms[0]?.id || "meta");
      }
    }
  }, [clients]);

  return (
    <ClientContext.Provider
      value={{
        clients,
        isLoadingClients,
        activeClientId,
        activePlatform,
        activeCadence,
        activeClient,
        activePlatformInfo,
        setActiveClientId: handleSetActiveClient,
        setActivePlatform,
        setActiveCadence,
        analysisData,
        isLoadingAnalysis,
        analysisError: analysisError as Error | null,
        apiBase,
      }}
    >
      {children}
    </ClientContext.Provider>
  );
}

// ─── Hook ───────────────────────────────────────────────────────────

export function useClient() {
  const ctx = useContext(ClientContext);
  if (!ctx) {
    throw new Error("useClient must be used within a ClientProvider");
  }
  return ctx;
}
