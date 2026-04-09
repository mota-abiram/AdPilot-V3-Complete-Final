import { createContext, useContext, useState, useCallback, useMemo, useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AnalysisData } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import type { PlatformSyncState } from "@/lib/sync-state";

// ─── Cadence-aware metric recalculation ─────────────────────────────
// The agent stores correct per-cadence totals in the DB. We only recalculate
// from daily arrays when the array fully covers the cadence window — otherwise
// we trust the agent's pre-computed totals (avoids stomping weekly/biweekly
// totals with a truncated 7-day daily array).
const CADENCE_EXPECTED_DAYS: Record<string, number> = {
  daily: 1,
  twice_weekly: 7,
  weekly: 14,
  biweekly: 30,
  monthly: 31, // upper bound; actual MTD days vary
};

function recalcMetricsFromDailyArrays(data: any, cadence?: string): any {
  if (!data?.account_pulse) return data;
  const ap = data.account_pulse;

  const hasBackendTotals =
    (typeof ap.total_spend_30d === "number" || typeof ap.total_spend === "number") &&
    (typeof ap.total_leads_30d === "number" || typeof ap.total_leads === "number") &&
    typeof ap.overall_cpl === "number" &&
    typeof ap.overall_ctr === "number";

  // Prefer backend totals and aggregate metrics whenever they are available.
  if (hasBackendTotals) return data;

  // Support both flat arrays (Meta) and daily_trends objects (Google)
  let dailySpends: number[] = ap.daily_spends || [];
  let dailyLeads: number[] = ap.daily_leads || [];
  let dailyCtrs: number[] = ap.daily_ctrs || [];
  let dailyClicks: number[] = ap.daily_clicks || [];
  let dailyImpressions: number[] = ap.daily_impressions || [];

  // Fallback: extract from daily_trends array (Google format)
  if (dailySpends.length === 0 && (ap.daily_trends?.length > 0 || data.daily_trends?.length > 0)) {
    const trends = ap.daily_trends || data.daily_trends || [];
    dailySpends = trends.map((d: any) => d.spend || d.cost || 0);
    dailyLeads = trends.map((d: any) => d.leads || d.conversions || 0);
    dailyCtrs = trends.map((d: any) => d.ctr || 0);
    dailyClicks = trends.map((d: any) => d.clicks || 0);
    dailyImpressions = trends.map((d: any) => d.impressions || 0);
  }

  if (dailySpends.length === 0) return data;

  // ── Coverage check: only override agent totals when daily array covers the window ──
  // If the array is shorter than expected (e.g. 7 rows for a 14-day weekly cadence),
  // the agent already stored correct totals — trust them and skip total recalc.
  const expectedDays = cadence ? (CADENCE_EXPECTED_DAYS[cadence] ?? 7) : 7;
  const coversWindow = dailySpends.length >= Math.floor(expectedDays * 0.9);

  if (!coversWindow) {
    // Daily arrays are truncated — only update per-day averages and latest values,
    // but keep the agent's pre-computed totals (total_spend_30d, total_leads_30d, overall_cpl).
    return {
      ...data,
      account_pulse: {
        ...ap,
        daily_avg_spend: dailySpends.length > 0 ? dailySpends.reduce((s, v) => s + v, 0) / dailySpends.length : ap.daily_avg_spend,
        latest_daily_spend: dailySpends.length > 0 ? dailySpends[dailySpends.length - 1] : ap.latest_daily_spend,
        latest_daily_leads: dailyLeads.length > 0 ? dailyLeads[dailyLeads.length - 1] : ap.latest_daily_leads,
        zero_lead_days: dailyLeads.filter((d) => d === 0).length,
      },
    };
  }

  // Daily array fully covers the window — recalculate totals from it.
  const totalSpend = dailySpends.reduce((s, v) => s + v, 0);
  const totalLeads = dailyLeads.reduce((s, v) => s + v, 0);
  const totalClicks = dailyClicks.reduce((s, v) => s + v, 0);
  const totalImpressions = dailyImpressions.reduce((s, v) => s + v, 0);

  // Weighted CTR: (Total Clicks / Total Impressions) * 100
  const weightedCtr = totalImpressions > 0
    ? (totalClicks / totalImpressions) * 100
    : (dailyCtrs.length > 0 ? dailyCtrs.reduce((s, v) => s + v, 0) / dailyCtrs.length : ap.overall_ctr || 0);

  const cpl = totalLeads > 0 ? totalSpend / totalLeads : 0;

  const updatedAp = {
    ...ap,
    total_spend_30d: totalSpend,
    total_spend: totalSpend,
    total_leads_30d: Math.round(totalLeads),
    total_leads: Math.round(totalLeads),
    overall_cpl: Math.round(cpl),
    overall_ctr: Number(weightedCtr.toFixed(2)),
    daily_avg_spend: dailySpends.length > 0 ? totalSpend / dailySpends.length : 0,
    avg_daily_leads: dailyLeads.length > 0 ? totalLeads / dailyLeads.length : 0,
    latest_daily_spend: dailySpends.length > 0 ? dailySpends[dailySpends.length - 1] : 0,
    latest_daily_leads: dailyLeads.length > 0 ? dailyLeads[dailyLeads.length - 1] : 0,
    zero_lead_days: dailyLeads.filter((d) => d === 0).length,
  };

  const updatedSummary = data.summary ? {
    ...data.summary,
    total_spend: totalSpend,
    total_leads: Math.round(totalLeads),
    avg_cpl: Math.round(cpl),
    overall_ctr: Number(weightedCtr.toFixed(2)),
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

// Canonical query key for benchmarks — use this everywhere for consistent invalidation
export function benchmarksQueryKey(clientId: string, platform: string) {
  return ["/api/clients", clientId, "benchmarks", platform] as const;
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
  syncState: PlatformSyncState | undefined;
  isLoadingSyncState: boolean;

  // Benchmarks — global dynamic config layer (single source of truth)
  benchmarks: Record<string, any> | undefined;
  isLoadingBenchmarks: boolean;

  // Helpers
  apiBase: string; // e.g. "/api/clients/amara/meta"
}

const ClientContext = createContext<ClientContextValue | null>(null);

// ─── Provider ───────────────────────────────────────────────────────

export function ClientProvider({ children }: { children: ReactNode }) {
  const [activeClientId, setActiveClientId] = useState("");
  const [activePlatform, _setActivePlatform] = useState("meta");
  const [activeCadence, setActiveCadence] = useState("twice_weekly");

  // Fetch client registry
  const { data: clients = [], isLoading: isLoadingClients } = useQuery<ClientInfo[]>({
    queryKey: ["/api/clients"],
  });

  const activeClient = clients.find((c) => c.id === activeClientId);

  // Validated platform setter — rejects unknown platform IDs to prevent broken API URLs
  const setActivePlatform = useCallback((platform: string) => {
    const validPlatforms = activeClient?.platforms.map((p) => p.id) || [];
    // Allow setting during initial load (validPlatforms empty) or when platform is known
    if (validPlatforms.length === 0 || validPlatforms.includes(platform)) {
      _setActivePlatform(platform);
    } else {
      console.warn(`[ClientContext] Rejected unknown platform "${platform}". Valid: ${validPlatforms.join(", ")}`);
    }
  }, [activeClient]);

  // Auto-select first available client after load (no hardcoded default)
  useEffect(() => {
    if (!isLoadingClients && clients.length > 0 && !activeClientId) {
      const first = clients[0];
      setActiveClientId(first.id);
      const firstEnabled = first.platforms.find((p) => p.enabled && p.hasData);
      _setActivePlatform(firstEnabled?.id || first.platforms[0]?.id || "meta");
    }
  }, [clients, isLoadingClients, activeClientId]);

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
    // Analysis data changes only on agent runs — 5 min stale window is safe
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const {
    data: syncState,
    isLoading: isLoadingSyncState,
  } = useQuery<PlatformSyncState>({
    queryKey: [apiBase, "sync-state"],
    queryFn: async () => {
      const res = await apiRequest("GET", `${apiBase}/sync-state`);
      return res.json();
    },
    enabled: !!activePlatformInfo?.enabled,
    retry: false,
  });

  // Benchmarks — single global fetch; all modules share this query key
  const {
    data: benchmarks,
    isLoading: isLoadingBenchmarks,
  } = useQuery<Record<string, any>>({
    queryKey: benchmarksQueryKey(activeClientId, activePlatform),
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/clients/${activeClientId}/benchmarks?platform=${activePlatform}`);
      return res.json();
    },
    enabled: !!activeClientId,
    staleTime: 0, // Always re-fetch after invalidation — no stale caching
    retry: false,
  });

  const analysisData = useMemo(() => {
    if (!rawAnalysisData) return undefined;
    return recalcMetricsFromDailyArrays(rawAnalysisData, activeCadence) as AnalysisData;
  }, [rawAnalysisData, activeCadence]);

  // When switching clients, auto-select the first enabled platform
  const handleSetActiveClient = useCallback((id: string) => {
    setActiveClientId(id);
    const client = clients.find((c) => c.id === id);
    if (client) {
      const firstEnabled = client.platforms.find((p) => p.enabled && p.hasData);
      // Use _setActivePlatform directly here — the new client's platforms are the valid set
      _setActivePlatform(firstEnabled?.id || client.platforms[0]?.id || "meta");
    }
  }, [clients]);

  // ─── Auto-Sync on load if data is stale (> 12 hours) ───────────────
  const [hasAutoSynced, setHasAutoSynced] = useState(false);
  
  useEffect(() => {
    if (hasAutoSynced || !syncState?.last_successful_fetch || syncState?.sync_status === "loading") return;

    const lastSync = new Date(syncState.last_successful_fetch).getTime();
    const now = Date.now();
    const hoursSinceSync = (now - lastSync) / (1000 * 60 * 60);

    // If data is older than 12 hours, trigger a background run
    if (hoursSinceSync > 12) {
      setHasAutoSynced(true);
      console.log(`[Auto-Sync] Data is ${hoursSinceSync.toFixed(1)}h old. Triggering background run...`);
      apiRequest("POST", "/api/scheduler/run-now").catch(e => 
        console.error("[Auto-Sync] Failed to trigger background sync:", e)
      );
    }
  }, [syncState?.last_successful_fetch, syncState?.sync_status, hasAutoSynced]);

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
        syncState,
        isLoadingSyncState,
        benchmarks,
        isLoadingBenchmarks,
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
