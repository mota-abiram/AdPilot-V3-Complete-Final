import { useQuery } from "@tanstack/react-query";
import { useClient } from "@/lib/client-context";
import { apiRequest } from "@/lib/queryClient";
import type { AnalysisData } from "@shared/schema";
import { useNow } from "@/hooks/use-now";
import { formatHoursAgo, parseSyncTimestamp } from "@/lib/sync-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Link } from "wouter";
import {
  IndianRupee,
  Users,
  Target,
  MousePointerClick,
  TrendingUp,
  AlertTriangle,
  ArrowRight,
  Gauge,
  Pause,
  Play,
  Zap,
  AlertCircle,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  BarChart3,
  Trophy,
  Activity,
  Bell,
  CheckCircle2,
  Clock,
  XCircle,
  TrendingDown,
  CalendarCheck,
  CalendarClock,
  Filter,
  Eye,
  MousePointer2,
  UserCheck,
  Home,
  Star,
} from "lucide-react";
import {
  formatINR,
  formatPct,
  formatNumber,
  getTrendInfo,
  getHealthBgColor,
  getHealthBarBg,
  getLayerColor,
  getStatusColor,
  getCplColor,
  getClassificationColor,
  getCtrColor,
  getFrequencyColor,
  truncate,
} from "@/lib/format";
import {
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { ExecutionButton } from "@/components/execution-button";
import { UnifiedActions } from "@/components/unified-actions";

function KpiCard({
  title,
  value,
  subtitle,
  trend,
  trendValue,
  icon: Icon,
  isInverse,
  status,
}: {
  title: string;
  value: string;
  subtitle?: string;
  trend?: string;
  trendValue?: string;
  icon: any;
  isInverse?: boolean;
  status?: {
    label: string;
    variant?: "success" | "warning" | "destructive" | "info" | "secondary";
    className?: string;
  };
}) {
  const trendInfo = trend ? getTrendInfo(trend, isInverse) : null;
  return (
    <Card className="relative overflow-visible border-border/70 shadow-lg before:absolute before:inset-x-0 before:top-0 before:h-1 before:rounded-t-[10px] before:bg-primary/80">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="type-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
            {title}
          </h3>
          <Icon className="w-4 h-4 text-primary/90 shrink-0" />
        </div>
        <div className="tabular-nums type-2xl font-extrabold tracking-[-0.03em] text-foreground" data-testid={`text-kpi-${title.toLowerCase().replace(/\s+/g, "-")}`}>
          {value}
        </div>
        <div className="flex items-center gap-2 mt-2">
          {trendInfo && trendValue && (
            <span className={`text-xs font-medium tabular-nums ${trendInfo.color}`}>
              {trendInfo.arrow} {trendValue}
            </span>
          )}
          {subtitle && (
            <span className="type-xs text-muted-foreground">{subtitle}</span>
          )}
          {status && (
            <Badge
              variant={status.variant ?? "secondary"}
              className={`px-1.5 py-0 ${status.className ?? ""}`}
            >
              {status.label}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

const CHART_COLORS = {
  gold: "hsl(47, 85%, 65%)",
  purple: "hsl(220, 50%, 65%)",
  blue: "hsl(215, 60%, 60%)",
  green: "hsl(146, 40%, 60%)",
  red: "hsl(0, 50%, 65%)",
  amber: "hsl(35, 70%, 60%)",
};

const FUNNEL_COLORS: Record<string, string> = {
  TOFU: "hsl(220, 70%, 55%)",
  MOFU: "hsl(262, 60%, 55%)",
  BOFU: "hsl(35, 90%, 55%)",
};

function CustomTooltipContent({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border/50 bg-card p-2 shadow-md">
      <p className="text-[11px] text-muted-foreground mb-1">{label}</p>
      {payload.map((entry: any, i: number) => {
        const isVideoMetric = entry.name.toLowerCase().includes("tsr") || entry.name.toLowerCase().includes("vhr");
        const hasPct = entry.name.includes("%");
        return (
          <p key={i} className="text-xs tabular-nums" style={{ color: entry.color }}>
            {entry.name}{isVideoMetric ? " (Video Only)" : ""}: {typeof entry.value === "number" ? entry.value.toLocaleString("en-IN") : entry.value}
            {(hasPct || isVideoMetric) && !entry.name.includes("%") ? "%" : ""}
          </p>
        );
      })}
    </div>
  );
}

// Dynamic cadence label
function getCadencePeriodLabel(cadence: string): string {
  switch (cadence) {
    case "daily": return "1d";
    case "twice_weekly": return "7d";
    case "weekly": return "14d";
    case "biweekly": return "30d";
    case "monthly": return "MTD";
    default: return "7d";
  }
}

export default function DashboardPage() {
  const {
    analysisData: data,
    isLoadingAnalysis: isLoading,
    analysisError,
    activeClient,
    activeClientId,
    activePlatformInfo,
    activePlatform,
    activeCadence,
    syncState,
    benchmarks, // global context — auto-refreshes when benchmarks are saved
  } = useClient();
  const now = useNow();

  const { data: verifyData } = useQuery<{
    verified: boolean;
    apiSpend: number;
    agentSpend: number;
    discrepancy: number;
    discrepancyPct: number;
    status: string;
    lastVerified: string | null;
  }>({
    queryKey: ["/api/clients", activeClientId, activePlatform, "verify-data"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/clients/${activeClientId}/${activePlatform}/verify-data`);
      return res.json();
    },
    enabled: !!activeClientId && !!activePlatform,
    staleTime: 5 * 60 * 1000,
  });

  const { data: newEntities } = useQuery<{
    hasNewEntities: boolean;
    newCampaigns: Array<{ id: string; name: string; type: string }>;
    newAdsets: Array<{ id: string; name: string }>;
    totalNew: number;
    lastAnalysis: string | null;
  }>({
    queryKey: ["/api/clients", activeClientId, activePlatform, "check-new-entities"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/clients/${activeClientId}/${activePlatform}/check-new-entities`);
      return res.json();
    },
    enabled: !!activeClientId && !!activePlatform,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000, // Poll every 5 minutes for new entities
  });

  const { data: recentAuditLog } = useQuery<Array<{
    id: string;
    success: boolean;
    action: string;
    entityId: string;
    entityName: string;
    entityType: string;
    timestamp: string;
    requestedBy: string;
    reason?: string;
    error?: string;
  }>>({
    queryKey: ["/api/audit-log", 3],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/audit-log?limit=3`);
      return res.json();
    },
    staleTime: 2 * 60 * 1000,
  });

  // MTD Deliverables — authoritative source for SVs, Qualified Leads, Closures
  const { data: mtdData } = useQuery<{
    client_id: string;
    month: string;
    mtd: {
      spend: number;
      leads: number;
      qualified_leads: number;
      svs: number;
      cpl: number;
      cpql: number;
      cpsv: number;
      positive_pct: number;
    };
    status: { data_complete: boolean; manual_input_missing: boolean; tracking_issue_flag: boolean };
    last_updated: string;
  }>({
    queryKey: ["/api/mtd-deliverables", activeClientId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/mtd-deliverables?client_id=${activeClientId}`);
      return res.json();
    },
    enabled: !!activeClientId,
    staleTime: 0,
  });

  if (analysisError) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          Failed to load dashboard data: {analysisError.message.replace(/^\d+:\s*/, "")}
        </div>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-md" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-64 rounded-md" />
          ))}
        </div>
      </div>
    );
  }

  const isGoogle = activePlatform === "google";
  const rawAp = (data as any).account_pulse || {};
  const lastSuccessfulFetch =
    syncState?.last_successful_fetch ||
    (data as any)?.last_successful_fetch ||
    (data as any)?.generated_at ||
    (data as any)?.timestamp ||
    null;
  const lastSuccessfulFetchDate = parseSyncTimestamp(lastSuccessfulFetch);

  // ─── Normalize account_pulse for both platforms ─────────────────
  const ap = {
    ...rawAp,
    total_spend_30d: rawAp.total_spend_30d ?? rawAp.total_spend ?? 0,
    total_leads_30d: rawAp.total_leads_30d ?? Math.round(rawAp.total_leads ?? 0),
    overall_cpl: rawAp.overall_cpl ?? 0,
    overall_ctr: rawAp.overall_ctr ?? 0,
    overall_cpm: rawAp.overall_cpm ?? 0,
    overall_cpc: rawAp.overall_cpc ?? 0,
    spend_trend: rawAp.spend_trend || "flat",
    spend_change_pct: rawAp.spend_change_pct ?? 0,
    leads_trend: rawAp.leads_trend || "flat",
    leads_change_pct: rawAp.leads_change_pct ?? 0,
    ctr_trend: rawAp.ctr_trend || "flat",
    ctr_change_pct: rawAp.ctr_change_pct ?? 0,
    daily_spends: rawAp.daily_spends || [],
    daily_leads: rawAp.daily_leads || [],
    daily_ctrs: rawAp.daily_ctrs || [],
    daily_cpms: rawAp.daily_cpms || [],
    daily_tsrs: rawAp.daily_tsrs || [],
    daily_vhrs: rawAp.daily_vhrs || [],
  };

  // ─── Normalize monthly_pacing from the active analysis snapshot ──
  const rawMp = (data as any).monthly_pacing;
  const rawMtdPacing = ((data as any).account_pulse || rawAp).mtd_pacing;
  const clientTargets = activeClient?.targets?.[activePlatform];

  const mp = rawMp ? rawMp : rawMtdPacing ? {
    month: new Date().toISOString().slice(0, 7),
    days_elapsed: rawMtdPacing.days_elapsed ?? 0,
    days_remaining: rawMtdPacing.days_remaining ?? 0,
    pct_through_month: rawMtdPacing.days_elapsed && rawMtdPacing.days_remaining
      ? (rawMtdPacing.days_elapsed / (rawMtdPacing.days_elapsed + rawMtdPacing.days_remaining)) * 100
      : 0,
    targets: {
      budget: rawMtdPacing.target_budget ?? clientTargets?.budget ?? 0,
      leads: rawMtdPacing.target_leads ?? clientTargets?.leads ?? 0,
      cpl: rawMtdPacing.target_cpl ?? clientTargets?.cpl ?? 0,
      svs: clientTargets?.svs ?? { low: 0, high: 0 },
      cpsv: clientTargets?.cpsv ?? { low: 0, high: 0 },
    },
    mtd: {
      spend: rawMtdPacing.spend_mtd ?? 0,
      leads: Math.round(rawMtdPacing.leads_mtd ?? 0),
      cpl: rawMtdPacing.leads_mtd > 0 ? (rawMtdPacing.spend_mtd / rawMtdPacing.leads_mtd) : 0,
    },
    projected_eom: {
      spend: rawMtdPacing.projected_spend ?? 0,
      leads: rawMtdPacing.projected_leads ?? 0,
      cpl: rawMtdPacing.projected_leads > 0 ? (rawMtdPacing.projected_spend / rawMtdPacing.projected_leads) : 0,
    },
    pacing: {
      spend_pct: rawMtdPacing.pacing_spend_pct ?? 0,
      spend_status: rawMtdPacing.on_track ? "ON_TRACK" : (rawMtdPacing.pacing_spend_pct > 100 ? "AHEAD" : "BEHIND"),
      leads_pct: rawMtdPacing.pacing_leads_pct ?? 0,
      leads_status: rawMtdPacing.on_track ? "ON_TRACK" : (rawMtdPacing.pacing_leads_pct > 80 ? "ON_TRACK" : "BEHIND"),
      cpl_status: rawMtdPacing.leads_mtd > 0 && (rawMtdPacing.spend_mtd / rawMtdPacing.leads_mtd) <= (rawMtdPacing.target_cpl ?? 850) ? "ON TARGET" : "HIGH",
    },
    daily_needed: {
      spend: rawMtdPacing.days_remaining > 0 ? ((rawMtdPacing.target_budget ?? 0) - (rawMtdPacing.spend_mtd ?? 0)) / rawMtdPacing.days_remaining : 0,
      leads: rawMtdPacing.days_remaining > 0 ? ((rawMtdPacing.target_leads ?? 0) - (rawMtdPacing.leads_mtd ?? 0)) / rawMtdPacing.days_remaining : 0,
    },
    alerts: ((data as any).account_pulse || rawAp).alerts?.map((a: any) => typeof a === "string" ? a : a.message || a.alert || JSON.stringify(a)) || [],
  } : null;

  // ─── Normalize other fields ────────────────────────────────────
  const s = (data as any).summary || {
    total_fatigue_alerts: ((data as any).frequency_audit?.alerts || []).length,
    immediate_actions: ((data as any).auto_pause_candidates || []).length,
  };

  const fatigue_alerts: any[] = (data as any).fatigue_alerts || [];
  const recommendations: any[] = (data as any).recommendations || [];

  const campaign_audit: any[] = (data as any).campaign_audit || ((data as any).campaigns || []).map((c: any) => ({
    campaign_id: c.id || "",
    campaign_name: c.name || "Unknown",
    layer: c.campaign_type || "unknown",
    status: c.status || "ENABLED",
    health_score: c.benchmark_comparison ? Math.round(
      (c.ctr > 0 ? 30 : 0) +
      (c.conversions > 0 ? 40 : 0) +
      (c.cpl > 0 && c.cpl < (clientTargets?.cpl ?? 850) * 1.5 ? 30 : 10)
    ) : 50,
    spend: c.cost || 0,
    leads: Math.round(c.conversions || c.all_conversions || 0),
    cpl: c.cpl || 0,
    ctr: c.ctr || 0,
  }));

  const cost_stack = (data as any).cost_stack || {};
  const thresholds = (data as any).dynamic_thresholds || (data as any).thresholds || null;
  const rawScoringSummary = (data as any).scoring_summary;
  const adsetAnalysis: any[] = (data as any).adset_analysis || [];

  const scoringSummary = adsetAnalysis.length > 0 ? {
    total_adsets: adsetAnalysis.length,
    winners: adsetAnalysis.filter((a: any) => a.classification === "WINNER").length,
    watch: adsetAnalysis.filter((a: any) => a.classification === "WATCH").length,
    underperformers: adsetAnalysis.filter((a: any) => a.classification === "UNDERPERFORMER" || a.classification === "LOSER").length,
    auto_pause: rawScoringSummary?.ad_scores?.auto_pause || [],
  } : null;

  const intellectInsights = (data as any).intellect_insights || [];
  const agentVersion = (data as any).agent_version || "";
  const cadenceLabel = (data as any).cadence || activeCadence || "";
  const periodLabel = getCadencePeriodLabel(cadenceLabel);
  const patternAnalysis = (data as any).pattern_analysis;

  // ─── Google-specific data ──────────────────────────────────────
  const searchSummary = isGoogle ? (data as any).search_summary : null;
  const dgSummary = isGoogle ? (data as any).dg_summary : null;
  const autoPauseCandidates = (data as any).auto_pause_candidates || [];
  const playbooksTriggered = (data as any).playbooks_triggered || [];

  // ─── Creative health for performance insights ──────────────────
  const creativeHealth: any[] = (data as any).creative_health || [];

  // Fallback for Google: if daily_spends empty, try daily_trends
  if (isGoogle && ap.daily_spends.length === 0) {
    const dt = (data as any).daily_trends || (data as any).account_pulse?.daily_trends || [];
    if (dt.length > 0) {
      ap.daily_spends = dt.map((d: any) => d.spend || d.cost || 0);
      ap.daily_leads = dt.map((d: any) => d.leads || d.conversions || 0);
      ap.daily_ctrs = dt.map((d: any) => d.ctr || 0);
      ap.daily_cpms = dt.map((d: any) => d.cpm || 0);
    }
  }

  // Daily chart data
  const dayLabels = ap.daily_spends.map((_: number, i: number) => `Day ${i + 1}`);
  const dailyChartData = ap.daily_spends.map((spend: number, i: number) => {
    const leads = ap.daily_leads[i] || 0;
    return {
      day: dayLabels[i],
      spend: Math.round(spend),
      leads,
      cpl: leads > 0 ? Math.round(spend / leads) : 0,
    };
  });

  // ─── Multi-metric CTR/TSR/VHR/CPM chart data ──────────────────
  const videoCreatives = creativeHealth.filter((c: any) => c.is_video && c.impressions > 0);
  const totalVideoImpressions = videoCreatives.reduce((s: number, c: any) => s + c.impressions, 0);
  const blendedTSR = totalVideoImpressions > 0
    ? videoCreatives.reduce((s: number, c: any) => s + c.thumb_stop_pct * c.impressions, 0) / totalVideoImpressions
    : null;
  const blendedVHR = totalVideoImpressions > 0
    ? videoCreatives.reduce((s: number, c: any) => s + c.hold_rate_pct * c.impressions, 0) / totalVideoImpressions
    : null;

  const multiMetricChartData = ap.daily_ctrs.map((ctr: number, i: number) => ({
    day: dayLabels[i],
    ctr: parseFloat(ctr.toFixed(2)),
    // Segregate TSR/VHR: only use video-specific metrics if available
    tsr: ap.daily_tsrs?.[i] ?? blendedTSR ?? 0,
    vhr: ap.daily_vhrs?.[i] ?? blendedVHR ?? 0,
    cpm: ap.daily_cpms?.[i] ?? ap.overall_cpm ?? 0,
  }));

  // Funnel donut data
  const funnelData = cost_stack?.funnel_split_actual
    ? Object.entries(cost_stack.funnel_split_actual)
      .filter(([, v]) => (v as number) > 0)
      .map(([key, val]) => ({ name: key, value: val as number }))
    : isGoogle && searchSummary && dgSummary
      ? [
        { name: "Search", value: Math.round((searchSummary.spend / ap.total_spend_30d) * 100) || 0 },
        { name: "Demand Gen", value: Math.round((dgSummary.spend / ap.total_spend_30d) * 100) || 0 },
      ].filter(d => d.value > 0)
      : [];

  const GOOGLE_FUNNEL_COLORS: Record<string, string> = {
    Search: "hsl(220, 70%, 55%)",
    "Demand Gen": "hsl(35, 90%, 55%)",
    branded: "hsl(262, 60%, 55%)",
    location: "hsl(220, 70%, 55%)",
    demand_gen: "hsl(35, 90%, 55%)",
  };
  const activeFunnelColors = isGoogle ? { ...FUNNEL_COLORS, ...GOOGLE_FUNNEL_COLORS } : FUNNEL_COLORS;

  // Critical alerts for banner
  const criticalAlerts: string[] = [];
  const cplCritical = thresholds?.cpl_critical ?? (isGoogle ? 1360 : 0);
  const cplAlert = thresholds?.cpl_alert ?? (isGoogle ? 1190 : 0);
  const cplTarget = thresholds?.cpl_target ?? (isGoogle ? 850 : 0);
  if (cplCritical > 0 && ap.overall_cpl > cplCritical) {
    criticalAlerts.push(`CPL ₹${Math.round(ap.overall_cpl)} exceeds critical threshold ₹${Math.round(cplCritical)}`);
  }
  if (!isGoogle && ap.overall_ctr < 0.4) {
    criticalAlerts.push(`CTR ${formatPct(ap.overall_ctr)} is critically low (< 0.4%)`);
  }
  if (isGoogle && mp && mp.pacing.leads_pct < 50) {
    criticalAlerts.push(`Lead pacing at ${mp.pacing.leads_pct.toFixed(0)}% — projected ${Math.round(mp.projected_eom?.leads || 0)} vs ${mp.targets?.leads || 0} target. Significant shortfall.`);
  }
  intellectInsights.filter((i: any) => (i.severity === "HIGH" || i.confidence === "high")).forEach((i: any) => {
    criticalAlerts.push(i.detail || i.observation || i.title);
  });
  if (isGoogle && autoPauseCandidates.length > 10) {
    criticalAlerts.push(`${autoPauseCandidates.length} ads/ad groups flagged for auto-pause. Review required.`);
  }

  // ─── Performance Insights helpers ─────────────────────────────
  const adsWithMetrics = creativeHealth.filter((c: any) => c.spend > 0);
  const totalAdsAnalyzed = adsWithMetrics.length;
  const totalCampaignsAnalyzed = new Set(adsWithMetrics.map((c: any) => c.campaign_name)).size;

  // Best and worst performing ads
  const adsWithLeads = adsWithMetrics.filter((c: any) => c.leads > 0 && c.cpl > 0);
  const bestAd = adsWithLeads.length > 0
    ? adsWithLeads.reduce((best: any, c: any) => (!best || c.cpl < best.cpl) ? c : best, null)
    : null;
  const worstAd = adsWithMetrics.length > 0
    ? adsWithMetrics.reduce((worst: any, c: any) => (!worst || (c.spend > 500 && (c.cpl > worst.cpl || (c.leads === 0 && c.spend > worst.spend)))) ? c : worst, null)
    : null;

  // Budget efficiency
  const targetCpl = benchmarks?.cpl_target || clientTargets?.cpl || cplTarget || 800;
  const spendOnHighCpl = adsWithMetrics
    .filter((c: any) => c.cpl > targetCpl || (c.leads === 0 && c.spend > 0))
    .reduce((s: number, c: any) => s + c.spend, 0);
  const totalSpendAll = adsWithMetrics.reduce((s: number, c: any) => s + c.spend, 0);
  const budgetEfficiencyPct = totalSpendAll > 0 ? Math.round((spendOnHighCpl / totalSpendAll) * 100) : 0;

  // ─── Account Health Score (Powered by Centralized Backend Engine) ────
  const backendHealthScore = (data as any)?.account_health_score;
  const backendBreakdown = (data as any)?.account_health_breakdown;

  const healthScoreComponents = {
    cpsv: backendBreakdown?.cpsv ?? 70,
    pacing_budget: backendBreakdown?.budget ?? 70,
    cpql: backendBreakdown?.cpql ?? 70,
    cpl: backendBreakdown?.cpl ?? 70,
    creative: backendBreakdown?.creative ?? 70,
    campaign: backendBreakdown?.campaign ?? 70,
  };

  const accountHealthScore = backendHealthScore ?? Math.round(
    healthScoreComponents.cpsv * 0.25 +
    healthScoreComponents.pacing_budget * 0.25 +
    healthScoreComponents.cpql * 0.20 +
    healthScoreComponents.cpl * 0.20 +
    healthScoreComponents.creative * 0.10
  );

  // Derive KPI variables from monthly_pacing and benchmarks
  const svsMtd = benchmarks?.svs_mtd || 0;
  const cpsvMtd = svsMtd > 0 ? (mp?.mtd?.spend || 0) / svsMtd : 0;
  const targetCpsvValue = thresholds?.cpsv_high || mp?.targets?.cpsv?.high || 20000;
  const pacingSpendStatus = mp?.pacing?.spend_status || "UNKNOWN";
  const healthScoreColor = accountHealthScore >= 75 ? "hsl(142, 70%, 45%)" : accountHealthScore >= 50 ? "hsl(38, 92%, 50%)" : "hsl(0, 72%, 55%)";
  const healthScoreData = [
    { name: "Score", value: accountHealthScore },
    { name: "Remaining", value: 100 - accountHealthScore },
  ];

  // Helper: find ad id by name from creative_health
  function findAdIdByName(adName: string): string | null {
    const ad = creativeHealth.find((a: any) => a.ad_name === adName);
    return ad?.ad_id || null;
  }

  // Helper: find adset by entity name from intellect insights
  function findAdsetByEntity(entity: string): { id: string; name: string } | null {
    const adset = adsetAnalysis.find((a: any) => entity.includes(a.adset_name) || a.adset_name.includes(entity));
    if (adset) return { id: adset.adset_id, name: adset.adset_name };
    return null;
  }

  const cadenceDisplayMap: Record<string, string> = {
    daily: "Last 1 Day",
    twice_weekly: "Last 7 Days",
    weekly: "Last 14 Days",
    biweekly: "Last 30 Days",
    monthly: "Month to Date",
  };

  const displayDateRange = (() => {
    const googleWindow = (data as any)?.window;
    if (googleWindow?.since && googleWindow?.until) {
      return { since: googleWindow.since, until: googleWindow.until };
    }

    const dateRange = (data as any)?.date_range;
    if (dateRange?.since && dateRange?.until) {
      return { since: dateRange.since, until: dateRange.until };
    }

    const period = (data as any)?.period?.primary;
    if (period?.start && period?.end) {
      return { since: period.start, until: period.end };
    }

    return null;
  })();

  const formatRangeDate = (value: string) => {
    const parsed = new Date(`${value}T00:00:00`);
    return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  return (
    <div className="page-shell max-w-[1600px] mx-auto">
      {/* Top bar */}
      <section className="page-zone" aria-labelledby="dashboard-title">
        <div className="flex items-center justify-between gap-4 flex-wrap rounded-[10px] border border-border/70 bg-card/80 px-5 py-4 shadow-sm">
          <div className="page-subsection">
            <div>
              <h1 id="dashboard-title" className="text-2xl font-extrabold text-foreground">Dashboard</h1>
              <p className="type-base text-muted-foreground">
                {activeClient?.name || ""} · {activePlatformInfo?.label || ""} · {cadenceLabel.replace(/_/g, " ")} analysis{agentVersion ? ` · ${agentVersion}` : ""}
              </p>
            </div>
            <div className="page-subsection gap-2">
              <Badge variant="warning" className="w-fit font-semibold">
                {displayDateRange
                  ? `Showing: ${cadenceDisplayMap[cadenceLabel] || "Last 7 Days"} | ${formatRangeDate(displayDateRange.since)} – ${formatRangeDate(displayDateRange.until)}`
                  : `Showing: ${cadenceDisplayMap[cadenceLabel] || "Last 7 Days"}`}
              </Badge>
              {lastSuccessfulFetchDate && (
                <Badge variant="secondary" className="w-fit text-muted-foreground">
                  Data as of: {lastSuccessfulFetchDate.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} ({formatHoursAgo(lastSuccessfulFetch, now)})
                </Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em] rounded-lg border border-primary/30 bg-primary/12 text-foreground hover:bg-primary/18 hover:border-primary/45 transition-colors"
                  onClick={() => {
                    fetch("/api/scheduler/run-now", { method: "POST" }).then(() => {
                      // Will auto-refresh via SSE when done
                    });
                  }}
                  data-testid="button-run-audit"
                >
                  Auto-runs daily at 9 AM IST · Click to run now
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">Click to trigger an immediate agent run. Normally runs daily at 9 AM IST.</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </section>

      {/* Critical Alerts Banner */}
      {criticalAlerts.length > 0 && (
        <section className="page-subsection" aria-labelledby="dashboard-critical-alerts">
          <h2 id="dashboard-critical-alerts" className="sr-only">Critical alerts</h2>
          {criticalAlerts.map((alert, i) => (
            <div key={i} className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span className="text-xs text-red-300 font-medium">{alert}</span>
            </div>
          ))}
        </section>
      )}

      {/* New Entity Detection Banner */}
      {newEntities?.hasNewEntities && (
        <section aria-labelledby="dashboard-new-entities">
          <h2 id="dashboard-new-entities" className="sr-only">New entities detected</h2>
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-500/10 border border-blue-500/30">
            <AlertCircle className="w-4 h-4 text-blue-400 shrink-0" />
            <span className="text-xs text-blue-300 font-medium">
              {newEntities.totalNew} new {newEntities.totalNew === 1 ? "entity" : "entities"} detected since last analysis
              {newEntities.newCampaigns.length > 0 && ` (${newEntities.newCampaigns.length} campaign${newEntities.newCampaigns.length > 1 ? "s" : ""})`}
              {newEntities.newAdsets.length > 0 && ` (${newEntities.newAdsets.length} ad set${newEntities.newAdsets.length > 1 ? "s" : ""})`}
              . Run agent to include them.
            </span>
          </div>
        </section>
      )}

      {/* KPI Cards */}
      <section className="page-zone" aria-labelledby="dashboard-kpis">
        <h2 id="dashboard-kpis" className="sr-only">Key performance indicators</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
          <KpiCard
            title={`Spend (${periodLabel})`}
            value={formatINR(ap.total_spend_30d, 0)}
            trend={ap.spend_trend}
            trendValue={`${Math.abs(ap.spend_change_pct).toFixed(1)}%`}
            icon={IndianRupee}
            subtitle="vs prior"
            status={verifyData ? (
              verifyData.verified
                ? { label: "Verified ✓", variant: "success" }
                : { label: `Mismatch: ${verifyData.discrepancyPct}%`, variant: "warning" }
            ) : undefined}
          />
          <KpiCard
            title={`Leads (${periodLabel})`}
            value={ap.total_leads_30d.toString()}
            trend={ap.leads_trend}
            trendValue={`${Math.abs(ap.leads_change_pct).toFixed(1)}%`}
            icon={Users}
            subtitle="vs prior"
          />
          <KpiCard
            title="Avg CPL"
            value={formatINR(ap.overall_cpl, 0)}
            trend={ap.spend_trend}
            trendValue={`${Math.abs((ap as any).cpl_change_pct || ap.spend_change_pct || 0).toFixed(1)}%`}
            icon={Target}
            isInverse
            status={
              thresholds
                ? ap.overall_cpl <= thresholds.cpl_target
                  ? { label: "On Target", variant: "success" }
                  : ap.overall_cpl <= thresholds.cpl_alert
                    ? { label: "Watch", variant: "warning" }
                    : { label: "Alert", variant: "destructive" }
                : undefined
            }
          />
          <KpiCard
            title="Avg CPSV"
            value={formatINR(cpsvMtd, 0)}
            icon={Zap}
            isInverse
            status={
              cpsvMtd > 0
                ? cpsvMtd <= targetCpsvValue
                  ? { label: "On Target", variant: "success" }
                  : cpsvMtd <= targetCpsvValue * 1.3
                    ? { label: "Watch", variant: "warning" }
                    : { label: "Alert", variant: "destructive" }
                : { label: "Awaiting Data", variant: "secondary" }
            }
            subtitle="vs target"
          />
          <KpiCard
            title="Monthly Pacing"
            value={mp ? `${mp.pacing.spend_pct.toFixed(0)}%` : "—"}
            icon={Gauge}
            status={mp ? {
              label: pacingSpendStatus,
              variant: pacingSpendStatus === "ON_TRACK" ? "success" : pacingSpendStatus === "AHEAD" ? "warning" : "destructive",
            } : undefined}
            subtitle={mp ? `Leads: ${mp.pacing.leads_pct.toFixed(0)}%` : "No pacing data"}
          />
          <KpiCard
            title="Active Alerts"
            value={`${(s.total_fatigue_alerts || 0) + (s.immediate_actions || 0)}`}
            icon={AlertTriangle}
            subtitle={`${s.total_fatigue_alerts || 0} fatigue · ${s.immediate_actions || 0} actions`}
          />
        </div>
      </section>

      {/* Data Verification Widget */}
      {verifyData && (
        <Card className={
          verifyData.verified
            ? "border-emerald-500/30"
            : verifyData.discrepancyPct <= 5
              ? "border-amber-500/30"
              : "border-red-500/30"
        }>
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className={`flex items-center justify-center w-9 h-9 rounded-lg ${verifyData.verified ? "bg-emerald-500/10" : verifyData.discrepancyPct <= 5 ? "bg-amber-500/10" : "bg-red-500/10"
                  }`}>
                  {verifyData.verified
                    ? <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    : verifyData.discrepancyPct <= 5
                      ? <ShieldAlert className="w-4 h-4 text-amber-400" />
                      : <ShieldX className="w-4 h-4 text-red-400" />
                  }
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-xs text-muted-foreground uppercase tracking-wider">Data Verification</h3>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <AlertCircle className="w-3 h-3 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs text-xs">
                        Validates consistency between the backend Intelligence agent and live platform APIs (Meta/Google). Flags discrepancies in spend or conversion counts.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">
                    {verifyData.status === "verified" ? "Cross-checked with API" : verifyData.status === "cross_checked" ? "Cross-checked across cadences" : "Single source"}
                    {verifyData.lastVerified && ` · ${new Date(verifyData.lastVerified).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-6 text-center">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">API Spend</p>
                  <p className="text-sm font-semibold tabular-nums">{formatINR(verifyData.apiSpend, 0)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Agent Spend</p>
                  <p className="text-sm font-semibold tabular-nums">{formatINR(verifyData.agentSpend, 0)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Difference</p>
                  <p className={`text-sm font-semibold tabular-nums ${verifyData.discrepancyPct <= 2 ? "text-emerald-400" : verifyData.discrepancyPct <= 5 ? "text-amber-400" : "text-red-400"
                    }`}>
                    {verifyData.discrepancyPct.toFixed(1)}%
                  </p>
                </div>
                <Badge variant="secondary" className={`text-[10px] px-2 py-0.5 ${verifyData.verified ? "text-emerald-400 bg-emerald-500/10" : verifyData.discrepancyPct <= 5 ? "text-amber-400 bg-amber-500/10" : "text-red-400 bg-red-500/10"
                  }`}>
                  {verifyData.verified ? "Verified" : verifyData.discrepancyPct <= 5 ? "Warning" : "Mismatch"}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Account Health Score */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card className="h-full flex flex-col">
          <CardContent className="p-4 flex flex-col items-center justify-center flex-1">
            <div className="flex items-center gap-1.5 mb-2">
              <h3 className="text-[15px] font-large uppercase tracking-wider text-black">Account Health</h3>
              <Tooltip>
                <TooltipTrigger asChild>
                  <AlertCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs text-xs space-y-1.5">
                  <p className="font-semibold">Performance Intelligence Score</p>
                  <div className="space-y-1">
                    {isGoogle ? (
                      <>
                        <p>• 25% CPSV (Cost Per Site Visit)</p>
                        <p>• 20% Budget (MTD Pacing)</p>
                        <p>• 20% CPQL (Cost Per Quality Lead)</p>
                        <p>• 10% CPL (Cost Per Lead)</p>
                        <p>• 15% Campaign Health (Avg)</p>
                        <p>• 10% Creative Health (Avg)</p>
                      </>
                    ) : (
                      <>
                        <p>• 25% CPSV (Cost Per Site Visit)</p>
                        <p>• 25% Budget (MTD Pacing)</p>
                        <p>• 20% CPQL (Cost Per Quality Lead)</p>
                        <p>• 20% CPL (Cost Per Lead)</p>
                        <p>• 10% Creative Health (Avg)</p>
                      </>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="relative h-32 w-32">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={healthScoreData} cx="50%" cy="50%" innerRadius={38} outerRadius={52} dataKey="value" startAngle={90} endAngle={-270}>
                    <Cell fill={healthScoreColor} />
                    <Cell fill="hsl(260, 12%, 16%)" />
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pt-2">
                <p className="text-2xl font-bold tabular-nums leading-none" style={{ color: healthScoreColor }}>{accountHealthScore}</p>
              </div>
            </div>
            <p className="text-[15px] font-large text-black text-muted-foreground mt-2">Weighted composite score</p>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2 h-full flex flex-col">
          <CardContent className="p-4">
            <h3 className="text-[13px] font-large text-black uppercase tracking-wider text-muted-foreground mb-3">Health Score Breakdown</h3>
            <div className={`grid ${isGoogle ? 'grid-cols-6' : 'grid-cols-5'} gap-2`}>
              {(isGoogle ? [
                { label: "CPSV", score: healthScoreComponents.cpsv, weight: "25%" },
                { label: "Budget", score: healthScoreComponents.pacing_budget, weight: "20%" },
                { label: "CPQL", score: healthScoreComponents.cpql, weight: "20%" },
                { label: "CPL", score: healthScoreComponents.cpl, weight: "10%" },
                { label: "Comp.", score: healthScoreComponents.campaign, weight: "15%" },
                { label: "Creat.", score: healthScoreComponents.creative, weight: "10%" },
              ] : [
                { label: "CPSV", score: healthScoreComponents.cpsv, weight: "25%" },
                { label: "Budget", score: healthScoreComponents.pacing_budget, weight: "25%" },
                { label: "CPQL", score: healthScoreComponents.cpql, weight: "20%" },
                { label: "CPL", score: healthScoreComponents.cpl, weight: "20%" },
                { label: "Creative", score: healthScoreComponents.creative, weight: "10%" },
              ]).map((item) => (
                <div key={item.label} className="text-center">
                  <p className="text-[11px] font-semibold text-black uppercase">{item.label} ({item.weight})</p>
                  <div className="w-full h-1.5 rounded-full bg-muted/50 mt-1.5">
                    <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(item.score, 100)}%`, backgroundColor: item.score >= 75 ? "hsl(142, 70%, 45%)" : item.score >= 50 ? "hsl(38, 92%, 50%)" : "hsl(0, 72%, 55%)" }} />
                  </div>
                  <p className="text-[11px] font-semibold tabular-nums mt-1" style={{ color: item.score >= 75 ? "hsl(142, 70%, 45%)" : item.score >= 50 ? "hsl(38, 92%, 50%)" : "hsl(0, 72%, 55%)" }}>
                    {Math.round(item.score)}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Google: Campaign Split */}
      {isGoogle && searchSummary && dgSummary && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Campaign Split</h3>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {(searchSummary.campaign_count || 0) + (dgSummary.campaign_count || 0)} active campaigns
                </span>
                <a href="/#/campaigns?filter=branded" className="cursor-pointer">
                  <Badge variant="secondary" className="text-[10px] px-2 py-0.5 text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 transition-colors">
                    {searchSummary.campaign_count} Search · CPL {formatINR(searchSummary.cpl, 0)} →
                  </Badge>
                </a>
                <a href="/#/campaigns?filter=demand_gen" className="cursor-pointer">
                  <Badge variant="secondary" className="text-[10px] px-2 py-0.5 text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 transition-colors">
                    {dgSummary.campaign_count} DG · CPL {formatINR(dgSummary.cpl, 0)} →
                  </Badge>
                </a>
                {autoPauseCandidates.length > 0 && (
                  <Badge variant="secondary" className="text-[10px] px-2 py-0.5 text-red-400 bg-red-500/10">
                    {autoPauseCandidates.length} Auto-Pause
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Charts Row — Daily Spend & Leads + Funnel Split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Funnel Split */}
        <Card className="h-full flex flex-col">
          <CardHeader className="pb-2 px-4 pt-4">
            <CardTitle className="text-m font-medium">{isGoogle ? "Spend Split" : "Funnel Split"}</CardTitle>
          </CardHeader>
          {/* GD-03: overflow fix — increased height so legend never gets clipped */}
          <CardContent className="px-2 pb-2 flex-1">
            <div className="w-full" style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <Pie
                    data={funnelData}
                    cx="50%"
                    cy="45%"
                    innerRadius={48}
                    outerRadius={72}
                    dataKey="value"
                    paddingAngle={2}
                    label={false}
                  >
                    {funnelData.map((entry) => (
                      <Cell
                        key={entry.name}
                        fill={activeFunnelColors[entry.name] || "hsl(215, 15%, 55%)"}
                      />
                    ))}
                  </Pie>
                  <Legend
                    verticalAlign="bottom"
                    height={36}
                    wrapperStyle={{ fontSize: "15px", paddingTop: "8px" }}
                    formatter={(value: string) => (
                      <span style={{ color: "hsl(215, 15%, 55%)" }}>{value}</span>
                    )}
                  />
                  <RechartsTooltip content={<CustomTooltipContent />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Monthly Pacing — Full Table */}
        {(() => {
          // ─── Pacing calculations (all backend-spec formulas) ─────────
          const daysElapsed = mp?.days_elapsed || 0;
          const daysRemaining = mp?.days_remaining ?? 1;
          const totalDays = daysElapsed + daysRemaining;

          // Helper: safe divide
          function div(a: number, b: number) { return b > 0 ? a / b : 0; }

          // MTD Target = (Monthly Target / totalDays) × daysElapsed
          function mtdTarget(monthlyTarget: number) {
            return totalDays > 0 ? (monthlyTarget / totalDays) * daysElapsed : 0;
          }
          // Projected = (MTD Delivered / daysElapsed) × totalDays
          function projected(delivered: number) {
            return daysElapsed > 0 ? (delivered / daysElapsed) * totalDays : 0;
          }
          // Daily Needed = (Monthly Target - MTD Delivered) / daysRemaining
          function dailyNeeded(monthlyTarget: number, delivered: number) {
            return daysRemaining > 0 ? (monthlyTarget - delivered) / daysRemaining : 0;
          }

          // Status logic — volume metrics (higher is better)
          function pacingStatus(delivered: number, target: number): { label: string; cls: string } {
            if (target <= 0) return { label: "—", cls: "text-muted-foreground" };
            const ratio = div(delivered, target);
            if (ratio >= 1.0) return { label: "ON TRACK", cls: "text-emerald-400" };
            if (ratio >= 0.9) return { label: "SLIGHTLY BEHIND", cls: "text-amber-400" };
            return { label: "OFF TRACK", cls: "text-red-400" };
          }
          // Status logic — cost metrics (lower is better)
          function costStatus(delivered: number, target: number): { label: string; cls: string } {
            if (target <= 0 || delivered <= 0) return { label: "—", cls: "text-muted-foreground" };
            const ratio = div(delivered, target);
            if (ratio <= 1.0) return { label: "ON TARGET", cls: "text-emerald-400" };
            if (ratio <= 1.1) return { label: "SLIGHTLY HIGH", cls: "text-amber-400" };
            return { label: "OFF TARGET", cls: "text-red-400" };
          }
          // Budget status — on track when within ±10%
          function budgetStatus(delivered: number, target: number): { label: string; cls: string } {
            if (target <= 0) return { label: "—", cls: "text-muted-foreground" };
            const ratio = div(delivered, target);
            if (ratio >= 0.9 && ratio <= 1.1) return { label: "ON TRACK", cls: "text-emerald-400" };
            if (ratio > 1.1) return { label: "OVERSPENT", cls: "text-red-400" };
            if (ratio >= 0.8) return { label: "SLIGHTLY UNDER", cls: "text-amber-400" };
            return { label: "UNDERSPENT", cls: "text-red-400" };
          }

          // ─── Data from MTD Deliverables API (authoritative source) ──
          const mtdSpend = mtdData?.mtd?.spend ?? mp?.mtd?.spend ?? 0;
          const mtdLeads = mtdData?.mtd?.leads ?? mp?.mtd?.leads ?? 0;
          const mtdQLeads = mtdData?.mtd?.qualified_leads ?? 0;
          const mtdSvs = mtdData?.mtd?.svs ?? 0;
          const mtdCpl = mtdLeads > 0 ? div(mtdSpend, mtdLeads) : 0;
          const mtdCpql = mtdQLeads > 0 ? div(mtdSpend, mtdQLeads) : 0;
          const mtdCpsv = mtdSvs > 0 ? div(mtdSpend, mtdSvs) : 0;
          const mtdClosures = benchmarks?.closures_mtd ?? 0;

          // ─── Targets ─────────────────────────────────────────────────
          const budgetTargetMonthly = benchmarks?.budget ?? mp?.targets?.budget ?? 0;
          const leadsTargetMonthly = benchmarks?.leads ?? mp?.targets?.leads ?? 0;
          const cplTargetVal = benchmarks?.cpl ?? mp?.targets?.cpl ?? 0;
          const cpqlTargetVal = benchmarks?.cpql_target ?? 0;
          const svsTargetLow = benchmarks?.svs_low ?? mp?.targets?.svs?.low ?? 0;
          const svsTargetHigh = benchmarks?.svs_high ?? mp?.targets?.svs?.high ?? 0;
          const cpsvTargetLow = benchmarks?.cpsv_low ?? mp?.targets?.cpsv?.low ?? 0;
          const cpsvTargetHigh = benchmarks?.cpsv_high ?? mp?.targets?.cpsv?.high ?? 0;
          const qLeadTargetMonthly = benchmarks?.positive_lead_target ?? 0;

          // ─── Row computations ─────────────────────────────────────────
          const budget = {
            target: budgetTargetMonthly,
            mtdTarget: mtdTarget(budgetTargetMonthly),
            delivered: mtdSpend,
            projected: projected(mtdSpend),
            dailyNeeded: dailyNeeded(budgetTargetMonthly, mtdSpend),
            status: budgetStatus(mtdSpend, mtdTarget(budgetTargetMonthly)),
          };
          const leads = {
            target: leadsTargetMonthly,
            mtdTarget: mtdTarget(leadsTargetMonthly),
            delivered: mtdLeads,
            projected: projected(mtdLeads),
            dailyNeeded: dailyNeeded(leadsTargetMonthly, mtdLeads),
            status: pacingStatus(mtdLeads, mtdTarget(leadsTargetMonthly)),
          };
          const cpl = {
            target: cplTargetVal,
            delivered: mtdCpl,
            projected: mp?.projected_eom?.cpl ?? 0,
            status: costStatus(mtdCpl, cplTargetVal),
          };
          const qleads = {
            target: qLeadTargetMonthly,
            mtdTarget: mtdTarget(qLeadTargetMonthly),
            delivered: mtdQLeads,
            projected: projected(mtdQLeads),
            dailyNeeded: dailyNeeded(qLeadTargetMonthly, mtdQLeads),
            status: pacingStatus(mtdQLeads, mtdTarget(qLeadTargetMonthly)),
          };
          const cpql = {
            target: cpqlTargetVal,
            delivered: mtdCpql,
            projected: qLeadTargetMonthly > 0 ? div(budgetTargetMonthly, qLeadTargetMonthly) : 0,
            status: costStatus(mtdCpql, cpqlTargetVal),
          };
          const svs = {
            targetLow: svsTargetLow,
            targetHigh: svsTargetHigh,
            mtdTarget: mtdTarget(svsTargetLow),
            delivered: mtdSvs,
            projected: projected(mtdSvs),
            dailyNeeded: dailyNeeded(svsTargetLow, mtdSvs),
            status: pacingStatus(mtdSvs, mtdTarget(svsTargetLow)),
          };
          const cpsv = {
            targetLow: cpsvTargetLow,
            targetHigh: cpsvTargetHigh,
            delivered: mtdCpsv,
            status: costStatus(mtdCpsv, cpsvTargetHigh),
          };

          const Dash = () => <span className="text-muted-foreground">—</span>;

          type RowDef = {
            label: string;
            target: React.ReactNode;
            mtdTarget: React.ReactNode;
            delivered: React.ReactNode;
            projectedNode: React.ReactNode;
            status: { label: string; cls: string };
            daily: React.ReactNode;
            highlight?: boolean;
          };

          const rows: RowDef[] = [
            {
              label: "Spend",
              target: formatINR(budget.target, 0),
              mtdTarget: formatINR(budget.mtdTarget, 0),
              delivered: <span className="font-semibold">{formatINR(budget.delivered, 0)}</span>,
              projectedNode: formatINR(budget.projected, 0),
              status: budget.status,
              daily: formatINR(budget.dailyNeeded, 0),
            },
            {
              label: "Leads",
              target: Math.round(leads.target),
              mtdTarget: Math.round(leads.mtdTarget),
              delivered: <span className="font-semibold">{Math.round(leads.delivered)}</span>,
              projectedNode: Math.round(leads.projected),
              status: leads.status,
              daily: leads.dailyNeeded.toFixed(1),
            },
            {
              label: "CPL",
              target: formatINR(cpl.target, 0),
              mtdTarget: formatINR(cpl.target, 0),
              delivered: <span className="font-semibold">{cpl.delivered > 0 ? formatINR(cpl.delivered, 0) : <Dash />}</span>,
              projectedNode: cpl.projected > 0 ? formatINR(cpl.projected, 0) : <Dash />,
              status: cpl.status,
              daily: <Dash />,
            },
            {
              label: "Qualified Leads",
              target: qleads.target > 0 ? Math.round(qleads.target) : <Dash />,
              mtdTarget: qleads.target > 0 ? Math.round(qleads.mtdTarget) : <Dash />,
              delivered: <span className="font-semibold">{mtdQLeads > 0 ? mtdQLeads : <Dash />}</span>,
              projectedNode: qleads.projected > 0 ? Math.round(qleads.projected) : <Dash />,
              status: qleads.target > 0 ? qleads.status : { label: "Awaiting", cls: "text-muted-foreground" },
              daily: qleads.target > 0 && daysRemaining > 0 ? qleads.dailyNeeded.toFixed(1) : <Dash />,
            },
            {
              label: "CPQL",
              target: cpql.target > 0 ? formatINR(cpql.target, 0) : <Dash />,
              mtdTarget: cpql.target > 0 ? formatINR(cpql.target, 0) : <Dash />,
              delivered: <span className="font-semibold">{mtdCpql > 0 ? formatINR(mtdCpql, 0) : <Dash />}</span>,
              projectedNode: cpql.projected > 0 ? formatINR(cpql.projected, 0) : <Dash />,
              status: cpql.target > 0 ? cpql.status : { label: "Awaiting", cls: "text-muted-foreground" },
              daily: <Dash />,
            },
            {
              label: "SVs",
              target: svs.targetLow > 0 ? `${svs.targetLow}–${svs.targetHigh}` : <Dash />,
              mtdTarget: svs.targetLow > 0 ? Math.round(svs.mtdTarget) : <Dash />,
              delivered: <span className="font-semibold">{mtdSvs > 0 ? mtdSvs : <Dash />}</span>,
              projectedNode: svs.projected > 0 ? Math.round(svs.projected) : <Dash />,
              status: mtdSvs > 0 ? svs.status : { label: "Awaiting data", cls: "text-muted-foreground" },
              daily: svs.targetLow > 0 && daysRemaining > 0 ? svs.dailyNeeded.toFixed(1) : <Dash />,
              highlight: true,
            },
            {
              label: "CPSV",
              target: cpsv.targetHigh > 0 ? `${formatINR(cpsv.targetLow, 0)}–${formatINR(cpsv.targetHigh, 0)}` : <Dash />,
              mtdTarget: cpsv.targetHigh > 0 ? formatINR(cpsv.targetHigh, 0) : <Dash />,
              delivered: <span className="font-semibold">{mtdCpsv > 0 ? formatINR(mtdCpsv, 0) : <Dash />}</span>,
              projectedNode: <Dash />,
              status: mtdCpsv > 0 ? cpsv.status : { label: "Awaiting data", cls: "text-muted-foreground" },
              daily: <Dash />,
            },
            {
              label: "Closures",
              target: <Dash />,
              mtdTarget: <Dash />,
              delivered: <span className="font-semibold">{mtdClosures > 0 ? mtdClosures : <Dash />}</span>,
              projectedNode: <Dash />,
              status: mtdClosures > 0 ? { label: "TRACKING", cls: "text-emerald-400" } : { label: "Awaiting data", cls: "text-muted-foreground" },
              daily: <Dash />,
            },
          ];

          const hasMtdMismatch = mtdData?.status?.tracking_issue_flag;
          const hasManualMissing = mtdData?.status?.manual_input_missing;

          return (
            <Card className="lg:col-span-2 h-full flex flex-col">
              <CardHeader className="pb-2 px-4 pt-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <CardTitle className="text-sm font-medium">
                      Monthly Pacing — {mp?.month || new Date().toISOString().slice(0, 7)}
                    </CardTitle>
                    <p className="text-[10px] text-muted-foreground">
                      {daysElapsed} days elapsed · {daysRemaining} remaining · {((mp?.pct_through_month || 0)).toFixed(0)}% through month
                      {mtdData?.last_updated && (
                        <span className="ml-2 text-muted-foreground/60">· updated {new Date(mtdData.last_updated).toLocaleDateString()}</span>
                      )}
                    </p>
                  </div>
                  <a href="/#/mtd-deliverables" className="text-[10px] text-primary flex items-center gap-0.5 hover:underline">
                    Update MTD Deliverables <ArrowRight className="w-2.5 h-2.5" />
                  </a>
                </div>
                {/* Data integrity flags */}
                {hasMtdMismatch && (
                  <div className="flex items-center gap-1.5 text-[10px] text-red-400 mt-1 rounded bg-red-500/8 px-2 py-1">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    Tracking issue detected — spend recorded but 0 leads. MTD data may be incomplete.
                  </div>
                )}
                {hasManualMissing && (
                  <div className="flex items-center gap-1.5 text-[10px] text-amber-400 mt-1 rounded bg-amber-500/8 px-2 py-1">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    SVs and Qualified Leads not entered yet — update MTD Deliverables for full pacing view.
                  </div>
                )}
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border/50">
                        <th className="p-2 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground sticky left-0 bg-card">Metric</th>
                        <th className="p-2 text-right text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Target</th>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <th className="p-2 text-right text-[10px] font-medium uppercase tracking-wider text-muted-foreground cursor-help">MTD Target</th>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs max-w-[200px]">
                            (Monthly Target ÷ Total Days) × Days Elapsed
                          </TooltipContent>
                        </Tooltip>
                        <th className="p-2 text-right text-[10px] font-medium uppercase tracking-wider text-muted-foreground">MTD Delivered</th>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <th className="p-2 text-right text-[10px] font-medium uppercase tracking-wider text-muted-foreground cursor-help">Projected</th>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs max-w-[200px]">
                            (MTD Delivered ÷ Days Elapsed) × Total Days
                          </TooltipContent>
                        </Tooltip>
                        <th className="p-2 text-right text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Status</th>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <th className="p-2 text-right text-[10px] font-medium uppercase tracking-wider text-muted-foreground cursor-help">Daily Needed</th>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs max-w-[200px]">
                            (Monthly Target − MTD Delivered) ÷ Remaining Days
                          </TooltipContent>
                        </Tooltip>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => (
                        <tr key={row.label} className={`border-b border-border/30 ${row.highlight ? "bg-primary/3" : ""} hover:bg-muted/20 transition-colors`}>
                          <td className="p-2 text-foreground font-medium sticky left-0 bg-card">{row.label}</td>
                          <td className="p-2 text-right tabular-nums text-muted-foreground">{row.target}</td>
                          <td className="p-2 text-right tabular-nums text-primary/80">{row.mtdTarget}</td>
                          <td className="p-2 text-right tabular-nums">{row.delivered}</td>
                          <td className="p-2 text-right tabular-nums">{row.projectedNode}</td>
                          <td className="p-2 text-right">
                            <Badge variant="secondary" className={`text-[10px] ${row.status.cls}`}>
                              {row.status.label}
                            </Badge>
                          </td>
                          <td className="p-2 text-right tabular-nums text-foreground/80">{row.daily}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {(mp?.alerts?.length || 0) > 0 && (
                  <div className="space-y-1 pt-2 mt-2 border-t border-border/30">
                    {(mp?.alerts || []).map((alert: string, i: number) => (
                      <div key={i} className="flex items-start gap-2 text-[11px] text-amber-400">
                        <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                        <span>{alert}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })()}
      </div>

      {/* ─── Adset/Ad Group Scoring ─────────────────────────────── */}
      {scoringSummary && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <Link href="/adsets" className="group flex items-center gap-1.5 cursor-pointer">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider group-hover:text-primary transition-colors">
                  {isGoogle ? "Ad Group Scoring" : "Adset Scoring"}
                </h3>
                <ArrowRight className="w-3 h-3 text-muted-foreground/50 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
              </Link>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {scoringSummary.total_adsets} total {isGoogle ? "ad groups" : "adsets"}
                </span>

                <Badge variant="secondary" className="text-[10px] px-2 py-0.5 text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors">
                  {scoringSummary.winners} Winners →
                </Badge>

                <Badge variant="secondary" className="text-[10px] px-2 py-0.5 text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 transition-colors">
                  {scoringSummary.watch} Watch →
                </Badge>
                <Badge variant="secondary" className="text-[10px] px-2 py-0.5 text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors">
                  {scoringSummary.underperformers} Underperformers →
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* CTR Trend + Multi-Metric Chart & Monthly Pacing Table */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* CTR / TSR / VHR / CPM Multi-Metric Chart */}
        <Card className="h-full flex flex-col">
          <CardHeader className="pb-2 px-4 pt-4">
            <CardTitle className="text-sm font-medium">{isGoogle ? `Key Metrics (${periodLabel})` : `CTR · TSR · VHR · CPM (${periodLabel})`}</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-4">
            <div className="h-56">
              {!isGoogle && multiMetricChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={multiMetricChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(260, 12%, 16%)" />
                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: "hsl(215, 15%, 55%)" }} />
                    <YAxis
                      yAxisId="pct"
                      tick={{ fontSize: 10, fill: "hsl(215, 15%, 55%)" }}
                      tickFormatter={(v: number) => `${v.toFixed(1)}%`}
                      domain={["auto", "auto"]}
                    />
                    <YAxis
                      yAxisId="rupee"
                      orientation="right"
                      tick={{ fontSize: 10, fill: "hsl(215, 15%, 55%)" }}
                      tickFormatter={(v: number) => `₹${v.toFixed(0)}`}
                    />
                    <RechartsTooltip content={<CustomTooltipContent />} />
                    <Legend wrapperStyle={{ fontSize: "10px" }} />
                    <Line yAxisId="pct" type="monotone" dataKey="ctr" stroke={CHART_COLORS.blue} strokeWidth={2} dot={{ r: 2 }} name="CTR %" />
                    <Line yAxisId="pct" type="monotone" dataKey="tsr" stroke={CHART_COLORS.amber} strokeWidth={2} dot={{ r: 2 }} name="TSR %" />
                    <Line yAxisId="pct" type="monotone" dataKey="vhr" stroke={CHART_COLORS.green} strokeWidth={2} dot={{ r: 2 }} name="VHR %" />
                    <Line yAxisId="rupee" type="monotone" dataKey="cpm" stroke={CHART_COLORS.red} strokeWidth={2} strokeDasharray="5 3" dot={false} name="CPM (₹)" />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : isGoogle ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={multiMetricChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(260, 12%, 16%)" />
                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: "hsl(215, 15%, 55%)" }} />
                    <YAxis
                      yAxisId="pct"
                      tick={{ fontSize: 10, fill: "hsl(215, 15%, 55%)" }}
                      tickFormatter={(v: number) => `${v.toFixed(1)}%`}
                      domain={["auto", "auto"]}
                    />
                    <YAxis
                      yAxisId="rupee"
                      orientation="right"
                      tick={{ fontSize: 10, fill: "hsl(215, 15%, 55%)" }}
                      tickFormatter={(v: number) => `₹${v.toFixed(0)}`}
                    />
                    <RechartsTooltip content={<CustomTooltipContent />} />
                    <Legend wrapperStyle={{ fontSize: "10px" }} />
                    <Line yAxisId="pct" type="monotone" dataKey="ctr" stroke={CHART_COLORS.blue} strokeWidth={2} dot={{ r: 3, fill: CHART_COLORS.blue }} name="CTR %" />
                    <Line yAxisId="pct" type="monotone" dataKey="tsr" stroke={CHART_COLORS.amber} strokeWidth={2} dot={{ r: 3, fill: CHART_COLORS.amber }} name="TSR %" />
                    <Line yAxisId="pct" type="monotone" dataKey="vhr" stroke={CHART_COLORS.green} strokeWidth={2} dot={{ r: 3, fill: CHART_COLORS.green }} name="VHR %" />
                    <Line yAxisId="rupee" type="monotone" dataKey="cpm" stroke={CHART_COLORS.red} strokeWidth={2} strokeDasharray="5 3" dot={false} name="CPM (₹)" />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-xs text-muted-foreground">No daily data available</div>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2 px-2 pt-2">
              {isGoogle ? (
                <>
                  <div className="rounded-md bg-muted/30 p-2 text-center">
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Avg CPC</p>
                    <p className="text-xs font-medium tabular-nums">{formatINR(ap.overall_cpc, 1)}</p>
                  </div>
                  <div className="rounded-md bg-muted/30 p-2 text-center">
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Avg CPM</p>
                    <p className="text-xs font-medium tabular-nums">{formatINR(ap.overall_cpm, 0)}</p>
                  </div>
                  <div className="rounded-md bg-muted/30 p-2 text-center">
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wider">CVR</p>
                    <p className="text-xs font-medium tabular-nums">{formatPct(ap.overall_cvr || 0)}</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="rounded-md bg-muted/30 p-2 text-center">
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Avg CPM</p>
                    <p className="text-xs font-medium tabular-nums">{formatINR(ap.overall_cpm, 0)}</p>
                  </div>
                  <div className="rounded-md bg-muted/30 p-2 text-center">
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Blended TSR</p>
                    <p className="text-xs font-medium tabular-nums">{blendedTSR !== null ? `${blendedTSR.toFixed(1)}%` : "—"}</p>
                  </div>
                  <div className="rounded-md bg-muted/30 p-2 text-center">
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Blended VHR</p>
                    <p className="text-xs font-medium tabular-nums">{blendedVHR !== null ? `${blendedVHR.toFixed(1)}%` : "—"}</p>
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>
        {/* Daily Spend + Leads — ComposedChart */}
        <Card className="lg:col-span-2 h-full flex flex-col">
          <CardHeader className="pb-2 px-4 pt-4">
            <CardTitle className="text-m font-medium">Daily Spend & Leads</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-4">
            <div className="h-56">
              {dailyChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={dailyChartData}>
                    <defs>
                      <linearGradient id="gradSpend" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={CHART_COLORS.gold} stopOpacity={0.3} />
                        <stop offset="100%" stopColor={CHART_COLORS.gold} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(260, 12%, 16%)" />
                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: "hsl(215, 15%, 55%)" }} />
                    <YAxis
                      yAxisId="spend"
                      tick={{ fontSize: 10, fill: "hsl(260, 12%, 16%)" }}
                      tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}K`}
                    />
                    <YAxis
                      yAxisId="leads"
                      orientation="right"
                      tick={{ fontSize: 10, fill: "hsl(260, 12%, 16%)" }}
                    />
                    <RechartsTooltip content={<CustomTooltipContent />} />
                    <Area
                      yAxisId="spend"
                      type="monotone"
                      dataKey="spend"
                      stroke={CHART_COLORS.gold}
                      fill="url(#gradSpend)"
                      strokeWidth={2}
                      name="Spend (₹)"
                    />
                    <Line
                      yAxisId="leads"
                      type="monotone"
                      dataKey="leads"
                      stroke={CHART_COLORS.purple}
                      strokeWidth={2}
                      dot={{ r: 3, fill: CHART_COLORS.purple }}
                      name="Leads"
                    />
                    <Line
                      yAxisId="spend"
                      type="monotone"
                      dataKey="cpl"
                      stroke={CHART_COLORS.red}
                      strokeWidth={2}
                      strokeDasharray="5 3"
                      dot={false}
                      name="CPL (₹)"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-xs text-muted-foreground">No daily data available</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ─── Tracking Sanity Card ────────────────── */}
      {(() => {
        const monthlyAp = rawAp;
        const dailyLeads = ap.daily_leads || [];
        const latestDailyLeads = dailyLeads.length > 0 ? dailyLeads[dailyLeads.length - 1] : null;
        const prevDayLeads = dailyLeads.length > 1 ? dailyLeads[dailyLeads.length - 2] : null;

        // Monthly targets and MTD for tracking
        const targetLeads = mp?.targets?.leads || clientTargets?.leads || 0;
        const mtdLeads = mp?.mtd?.leads || monthlyAp.total_leads_30d || 0;
        const mtdLeadsTarget = targetLeads * ((mp?.pct_through_month || 0) / 100);
        const todayLeads = latestDailyLeads ?? 0;
        const daysRemaining = mp?.days_remaining || 15;
        const dailyRateNeeded = daysRemaining > 0 ? Math.max(0, ((targetLeads - mtdLeads) / daysRemaining)) : 0;

        const zeroLeadDays = (ap as any).zero_lead_days ?? dailyLeads.filter((d: number) => d === 0).length;

        const conversionSanity = isGoogle ? (data as any).conversion_sanity : null;
        const googleLeadsToday = conversionSanity?.leads_today ?? null;
        const ga4Match = conversionSanity?.ga4_match_status ?? null;
        const trackingAlerts = conversionSanity?.tracking_alerts || [];

        const isZeroToday = isGoogle
          ? (googleLeadsToday === 0 || googleLeadsToday === null)
          : (latestDailyLeads === 0 || latestDailyLeads === null);
        const leadsToday = isGoogle ? (googleLeadsToday ?? latestDailyLeads ?? 0) : todayLeads;
        const hasSuddenDrop = prevDayLeads !== null && prevDayLeads > 0 && leadsToday < prevDayLeads * 0.2;

        // Health status
        let healthStatus: "Healthy" | "On Track" | "Behind" | "Alert" = "Healthy";
        let trafficLight: "green" | "amber" | "red" = "green";
        if (isZeroToday || hasSuddenDrop || (isGoogle && trackingAlerts.length > 0)) {
          trafficLight = "red";
          healthStatus = "Alert";
        } else if (dailyRateNeeded > (todayLeads || 1) * 1.5 || zeroLeadDays > 1) {
          trafficLight = "amber";
          healthStatus = "Behind";
        } else if (mtdLeads >= targetLeads * ((mp?.pct_through_month || 50) / 100) * 0.85) {
          healthStatus = "On Track";
        }

        const lightColors = {
          green: { icon: ShieldCheck, bg: "bg-emerald-500/10", border: "border-emerald-500/30", text: "text-emerald-400" },
          amber: { icon: ShieldAlert, bg: "bg-amber-500/10", border: "border-amber-500/30", text: "text-amber-400" },
          red: { icon: ShieldX, bg: "bg-red-500/10", border: "border-red-500/30", text: "text-red-400" },
        };
        const light = lightColors[trafficLight];
        const LightIcon = light.icon;

        const lastVerified = lastSuccessfulFetchDate
          ? lastSuccessfulFetchDate.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
          : "Unknown";

        return (
          <Card className={light.border}>
            {isZeroToday && (
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-t-lg bg-red-500/15 border-b border-red-500/30">
                <ShieldX className="w-4 h-4 text-red-400 shrink-0" />
                <span className="text-xs text-red-300 font-semibold">
                  TRACKING ALERT: Zero leads captured today — verify {isGoogle ? "conversion setup / GA4 linking" : "pixel / conversion setup"}
                </span>
              </div>
            )}
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className={`flex items-center justify-center w-10 h-10 rounded-lg ${light.bg}`}>
                    <LightIcon className={`w-5 h-5 ${light.text}`} />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-sm font-medium text-foreground">Tracking Sanity</h3>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <AlertCircle className="w-3 h-3 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs text-xs">
                          Monitors pixel/conversion stability by comparing MTD performance against expected daily velocity. Flags sudden drops or zero-lead days.
                        </TooltipContent>
                      </Tooltip>
                      <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${light.text} ${light.bg}`}>
                        {healthStatus}
                      </Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Last verified: {lastVerified}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wider">MTD Leads Target</p>
                    <p className="text-sm font-semibold tabular-nums text-foreground">{Math.round(mtdLeadsTarget)}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wider">MTD Leads Delivered</p>
                    <p className="text-sm font-semibold tabular-nums text-foreground">{mtdLeads}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Yesterday's Delivered</p>
                    <p className="text-sm font-semibold tabular-nums text-foreground">{prevDayLeads || 0}</p>
                  </div>
                </div>
              </div>
              {isGoogle && conversionSanity && (
                <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border/30">
                  {ga4Match && (
                    <Badge variant="secondary" className={`text-[10px] px-2 py-0.5 ${ga4Match === "match" ? "text-emerald-400 bg-emerald-500/10" :
                      ga4Match === "mismatch" ? "text-amber-400 bg-amber-500/10" :
                        "text-muted-foreground"
                      }`}>
                      GA4: {ga4Match}
                    </Badge>
                  )}
                  {trackingAlerts.map((alert: string, i: number) => (
                    <span key={i} className="text-[10px] text-amber-400 flex items-center gap-1">
                      <AlertTriangle className="w-2.5 h-2.5" />
                      {alert}
                    </span>
                  ))}
                </div>
              )}
              {hasSuddenDrop && !isZeroToday && (
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/30">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                  <span className="text-[10px] text-red-400 font-medium">
                    Sudden drop detected: {leadsToday} leads today vs {prevDayLeads} yesterday ({prevDayLeads && prevDayLeads > 0 ? ((1 - leadsToday / prevDayLeads) * 100).toFixed(0) : 0}% decrease)
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {/* ─── Performance Insights (Enhanced) ────────────────────── */}
      <Card>
        <CardHeader className="pb-2 px-4 pt-4">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            Performance Insights
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-3">
          {/* Summary insights */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {totalAdsAnalyzed > 0 && (
              <div className="flex items-start gap-2 p-2.5 rounded-md bg-muted/30 border border-border/30">
                <BarChart3 className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <span className="text-[11px] text-foreground leading-relaxed">
                  Analyzing <strong>{totalAdsAnalyzed} ads</strong> across <strong>{totalCampaignsAnalyzed} campaigns</strong>
                </span>
              </div>
            )}
            {bestAd && (
              <div className="flex items-start gap-2 p-2.5 rounded-md bg-muted/30 border border-emerald-500/20">
                <Trophy className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <span className="text-[11px] text-foreground leading-relaxed">
                    Best performing: <strong className="text-emerald-400">{truncate(bestAd.ad_name, 30)}</strong> — CPL {formatINR(bestAd.cpl, 0)}, {bestAd.leads} leads, CTR {formatPct(bestAd.ctr / 100)}
                  </span>
                </div>
              </div>
            )}
            {worstAd && (
              <div className="flex items-start gap-2 p-2.5 rounded-md bg-muted/30 border border-red-500/20">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <span className="text-[11px] text-foreground leading-relaxed">
                    Worst performing: <strong className="text-red-400">{truncate(worstAd.ad_name, 30)}</strong> — CPL {worstAd.cpl > 0 ? formatINR(worstAd.cpl, 0) : "N/A"}, ₹{Math.round(worstAd.spend)} spent, {worstAd.leads} leads
                  </span>
                  {worstAd.ad_id && (
                    <div className="mt-1.5">
                      <UnifiedActions
                        entityId={worstAd.ad_id}
                        entityName={worstAd.ad_name}
                        entityType="ad"
                        actionType="PAUSE_AD"
                        isAutoExecutable={true}
                        recommendation={`Worst performer — CPL ${worstAd.cpl > 0 ? formatINR(worstAd.cpl, 0) : "N/A"}, consider pausing`}
                        currentMetrics={{ spend: worstAd.spend, leads: worstAd.leads, cpl: worstAd.cpl, ctr: worstAd.ctr }}
                        compact
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
            {budgetEfficiencyPct > 0 && (
              <div className="flex items-start gap-2 p-2.5 rounded-md bg-muted/30 border border-border/30">
                <IndianRupee className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span className="text-[11px] text-foreground leading-relaxed">
                  Budget efficiency: <strong className={budgetEfficiencyPct > 40 ? "text-red-400" : "text-amber-400"}>{budgetEfficiencyPct}%</strong> of spend going to ads with CPL &gt; target (₹{Math.round(targetCpl)})
                </span>
              </div>
            )}
            {/* Google-specific insights */}
            {isGoogle && (
              <>
                {searchSummary && (
                  <div className="flex items-start gap-2 p-2.5 rounded-md bg-muted/30 border border-blue-500/20">
                    <BarChart3 className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                    <span className="text-[11px] text-foreground leading-relaxed">
                      Search: <strong>{searchSummary.campaign_count || 0}</strong> campaigns · CPL {formatINR(searchSummary.cpl || 0, 0)} · CTR {formatPct(searchSummary.ctr / 100 || 0)} · IS {formatPct(searchSummary.impression_share || 0)}
                    </span>
                  </div>
                )}
                {dgSummary && (
                  <div className="flex items-start gap-2 p-2.5 rounded-md bg-muted/30 border border-amber-500/20">
                    <BarChart3 className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <span className="text-[11px] text-foreground leading-relaxed">
                      Demand Gen: <strong>{dgSummary.campaign_count || 0}</strong> campaigns · CPL {formatINR(dgSummary.cpl || 0, 0)} · CPM {formatINR(dgSummary.cpm || 0, 0)} · CTR {formatPct(dgSummary.ctr / 100 || 0)}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* MV2-N19: Execution cooldown indicator */}
          {(() => {
            const lastAuditEntry = recentAuditLog && recentAuditLog.length > 0 ? recentAuditLog[0] : null;
            const timeAgoLabel = (() => {
              if (!lastAuditEntry) return null;
              const ms = Date.now() - new Date(lastAuditEntry.timestamp).getTime();
              const mins = Math.round(ms / 60000);
              const hours = Math.round(ms / 3600000);
              const days = Math.round(ms / 86400000);
              if (mins < 60) return `${mins}m ago`;
              if (hours < 24) return `${hours}h ago`;
              return `${days}d ago`;
            })();
            const recentActionDays = lastAuditEntry
              ? (Date.now() - new Date(lastAuditEntry.timestamp).getTime()) / 86400000
              : null;
            const isRecent = recentActionDays !== null && recentActionDays < 5;
            return (
              <div className="col-span-full flex items-start gap-2 p-2.5 rounded-md bg-blue-500/5 border border-blue-500/20 mt-1">
                <Clock className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <span className="text-[11px] text-blue-300 font-medium">
                    SOP: Wait 3–5 days before overreacting to performance dips
                  </span>
                  {isRecent && timeAgoLabel && (
                    <p className="text-[10px] text-muted-foreground">
                      Last action {timeAgoLabel} ({lastAuditEntry?.action?.replace(/_/g, " ")} on {lastAuditEntry?.entityName ? lastAuditEntry.entityName.slice(0, 40) : "entity"}). Allow time for data to stabilize.
                    </p>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Pattern analysis insights */}
          {patternAnalysis && patternAnalysis.patterns.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-border/30">
              {patternAnalysis.patterns.map((p: { type: string; detail: string }, i: number) => (
                <div key={i} className="flex items-start gap-2 p-2.5 rounded-md bg-muted/30 border border-border/30">
                  <Badge variant="secondary" className="text-[9px] px-1 py-0 shrink-0 mt-0.5">{p.type.replace(/_/g, " ")}</Badge>
                  <span className="text-[11px] text-foreground leading-relaxed">{p.detail}</span>
                </div>
              ))}
            </div>
          )}
          {patternAnalysis?.top_avg && patternAnalysis?.bottom_avg && (
            <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
              <span>Top avg CPL: <span className="text-emerald-400 tabular-nums">{formatINR(patternAnalysis.top_avg.cpl, 0)}</span></span>
              <span>Bottom avg CPL: <span className="text-red-400 tabular-nums">{formatINR(patternAnalysis.bottom_avg.cpl, 0)}</span></span>
              <span>Ratio: <span className="text-foreground tabular-nums">{patternAnalysis.bottom_avg.cpl > 0 && patternAnalysis.top_avg.cpl > 0 ? (patternAnalysis.bottom_avg.cpl / patternAnalysis.top_avg.cpl).toFixed(1) : "—"}x</span></span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Campaign Health Table + Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Campaign Table */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2 px-4 pt-4 flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-sm font-medium flex items-center gap-1.5">
              Campaign Health
              <Tooltip>
                <TooltipTrigger asChild>
                  <AlertCircle className="w-3 h-3 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs text-xs">
                  Aggregated health score based on CPL, CTR, and spend efficiency. Click a score to view underlying adsets.
                </TooltipContent>
              </Tooltip>
            </CardTitle>
            <Link href="/campaigns" className="text-xs text-primary flex items-center gap-1" data-testid="link-view-campaigns">
              View All <ArrowRight className="w-3 h-3" />
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Campaign</th>
                    <th className="text-left p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Layer</th>
                    <th className="text-left p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Status</th>
                    <th className="text-left p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Health</th>
                    <th className="text-right p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Spend</th>
                    <th className="text-right p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Leads</th>
                    <th className="text-right p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">CPL</th>
                    <th className="text-right p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">CTR</th>
                    <th className="text-center p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {campaign_audit.map((c) => {
                    const layer = getLayerColor(c.layer);
                    const status = getStatusColor(c.status);
                    const isPaused = c.status === "PAUSED";
                    return (
                      <tr key={c.campaign_id} className="border-b border-border/30 hover:bg-muted/30 transition-colors">
                        <td className="p-3 max-w-[200px]">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="truncate block cursor-default text-foreground">{truncate(c.campaign_name, 40)}</span>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              <p className="text-xs max-w-xs">{c.campaign_name}</p>
                            </TooltipContent>
                          </Tooltip>
                        </td>
                        <td className="p-3">
                          <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${layer.bg} ${layer.text}`}>
                            {c.layer}
                          </span>
                        </td>
                        <td className="p-3">
                          <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${status.bg} ${status.text}`}>
                            {c.status}
                          </span>
                        </td>
                        <td className="p-3">
                          <Link href={`/adsets?campaignId=${c.campaign_id}`}>
                            <div className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity">
                              <div className={`w-16 h-1.5 rounded-full ${getHealthBarBg(c.health_score)}`}>
                                <div
                                  className={`h-full rounded-full ${getHealthBgColor(c.health_score)}`}
                                  style={{ width: `${c.health_score}%` }}
                                />
                              </div>
                              <span className="tabular-nums text-muted-foreground w-6 font-medium">{c.health_score}</span>
                            </div>
                          </Link>
                        </td>
                        <td className="p-3 text-right tabular-nums">{formatINR(c.spend, 0)}</td>
                        <td className="p-3 text-right tabular-nums">{c.leads}</td>
                        <td className={`p-3 text-right tabular-nums ${c.cpl > 0 ? getCplColor(c.cpl, thresholds) : "text-foreground"}`}>
                          {c.cpl > 0 ? formatINR(c.cpl, 0) : "—"}
                        </td>
                        <td className={`p-3 text-right tabular-nums ${getCtrColor(c.ctr)}`}>
                          {formatPct(c.ctr)}
                        </td>
                        <td className="p-3 text-center">
                          {isPaused ? (
                            <ExecutionButton
                              action="UNPAUSE_CAMPAIGN"
                              entityId={c.campaign_id}
                              entityName={c.campaign_name}
                              entityType="campaign"
                              label=""
                              variant="ghost"
                              size="icon"
                              icon={<Play className="w-3.5 h-3.5 text-emerald-400" />}
                              confirmMessage={`Activate campaign "${c.campaign_name}"?`}
                              params={{ reason: "Manual activation from Dashboard" }}
                              className="h-7 w-7"
                              data-testid={`button-unpause-campaign-${c.campaign_id}`}
                            />
                          ) : (
                            <ExecutionButton
                              action="PAUSE_CAMPAIGN"
                              entityId={c.campaign_id}
                              entityName={c.campaign_name}
                              entityType="campaign"
                              label=""
                              variant="ghost"
                              size="icon"
                              icon={<Pause className="w-3.5 h-3.5 text-red-400" />}
                              confirmMessage={`Pause campaign "${c.campaign_name}"? This will stop all ads in this campaign.`}
                              params={{ reason: "Manual pause from Dashboard" }}
                              className="h-7 w-7"
                              data-testid={`button-pause-campaign-${c.campaign_id}`}
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Alerts & Actions */}
        <Card>
          <CardHeader className="pb-2 px-4 pt-4">
            <CardTitle className="text-sm font-medium">Alerts & Actions</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-4">
            {/* Fatigue Alerts */}
            {fatigue_alerts.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Fatigue Alerts
                </h3>
                {fatigue_alerts.map((alert, i) => {
                  const adId = findAdIdByName(alert.ad_name);
                  return (
                    <div key={i} className="p-2 rounded-md bg-muted/30 border border-border/30">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="secondary"
                            className={`text-[10px] px-1 py-0 ${alert.severity === "CRITICAL"
                              ? "text-red-400"
                              : "text-amber-400"
                              }`}
                          >
                            {alert.severity}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">{alert.type}</span>
                        </div>
                      </div>
                      <p className="text-[11px] text-foreground leading-relaxed mb-1.5">
                        {alert.message}
                      </p>
                      {adId && (
                        <UnifiedActions
                          entityId={adId}
                          entityName={alert.ad_name}
                          entityType="ad"
                          actionType="PAUSE_AD"
                          isAutoExecutable={true}
                          recommendation={`Fatigue alert: ${alert.message}`}
                          compact
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Top Recommendations */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Top Recommendations
                </h3>
                <Link href="/recommendations" className="text-[10px] text-primary flex items-center gap-0.5" data-testid="link-view-recs">
                  View All <ArrowRight className="w-2.5 h-2.5" />
                </Link>
              </div>
              {recommendations.slice(0, 3).map((rec, i) => (
                <div key={i} className="p-2 rounded-md bg-muted/30 border border-border/30">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-bold tabular-nums text-primary">
                      ICE {rec.ice_score}
                    </span>
                    <span className={`text-[10px] px-1 py-0 rounded ${getLayerColor(rec.layer || rec.category || "unknown").bg} ${getLayerColor(rec.layer || rec.category || "unknown").text}`}>
                      {rec.layer || rec.category || ""}
                    </span>
                  </div>
                  <p className="text-[11px] text-foreground font-medium">
                    {truncate(rec.action || rec.description || rec.title || "", 60)}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Performance Intelligence — Intellect Insights with UnifiedActions */}
      {intellectInsights.length > 0 && (
        <Card>
          <CardHeader className="pb-2 px-4 pt-4">
            <CardTitle className="text-sm font-medium">Performance Intelligence</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {intellectInsights.map((insight: any, i: number) => {
                const sev = insight.severity || (insight.confidence === "high" ? "HIGH" : insight.confidence === "medium" ? "MEDIUM" : "LOW");
                const severityColor =
                  sev === "HIGH"
                    ? "text-red-400 bg-red-500/10"
                    : sev === "MEDIUM"
                      ? "text-amber-400 bg-amber-500/10"
                      : "text-blue-400 bg-blue-500/10";
                const insightType = insight.type || "insight";
                const insightEntity = insight.entity || insight.title || "";
                const insightDetail = insight.detail || insight.observation || "";
                const insightRec = insight.recommendation || "";
                const adsetMatch = findAdsetByEntity(insightEntity);
                return (
                  <div
                    key={i}
                    className="p-3 rounded-md bg-muted/30 border border-border/30 space-y-2"
                    data-testid={`insight-card-${i}`}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${severityColor}`}>
                        {sev}
                      </Badge>
                      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                        {insightType}
                      </span>
                    </div>
                    <p className="text-xs font-medium text-foreground">{insightEntity}</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{insightDetail}</p>
                    {insightRec && <p className="text-[11px] text-primary/80 leading-relaxed">{insightRec}</p>}
                    {adsetMatch && (
                      <UnifiedActions
                        entityId={adsetMatch.id}
                        entityName={adsetMatch.name}
                        entityType="adset"
                        actionType={insight.auto_action ? "PAUSE_ADSET" : "MANUAL_ACTION"}
                        isAutoExecutable={!!insight.auto_action}
                        recommendation={insightRec || insightDetail}
                        currentMetrics={insight.metrics}
                        compact
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Funnel Diagnostics (moved from Audit Panel) ────────── */}
      {(data as any).funnel_diagnostics && (
        <Card>
          <CardHeader className="pb-2 px-4 pt-4">
            <CardTitle className="text-sm font-medium">Funnel Diagnostics</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {Object.entries((data as any).funnel_diagnostics).map(([key, value]: [string, any]) => (
                <div key={key} className="p-2.5 rounded-md bg-muted/30 border border-border/30">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{key.replace(/_/g, " ")}</p>
                  <p className="text-xs text-foreground leading-relaxed">
                    {typeof value === "object" ? JSON.stringify(value) : String(value)}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── MV2-N03: Recent Actions quick view ────────────────── */}
      <Card>
        <CardHeader className="pb-2 px-4 pt-4">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              Recent Actions
            </CardTitle>
            <Link href="/execution-log" className="text-[10px] text-primary flex items-center gap-0.5 hover:underline">
              View All <ArrowRight className="w-2.5 h-2.5" />
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {!recentAuditLog || recentAuditLog.length === 0 ? (
            <p className="text-xs text-muted-foreground">No recent actions</p>
          ) : (
            <div className="space-y-2">
              {recentAuditLog.map((entry) => {
                const ts = new Date(entry.timestamp);
                const timeLabel = ts.toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" });
                const actionLabel = entry.action.replace(/_/g, " ");
                return (
                  <div key={entry.id} className="flex items-center gap-3 py-1.5 border-b border-border/30 last:border-0">
                    <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap shrink-0">{timeLabel}</span>
                    <Badge
                      variant="secondary"
                      className={`text-[10px] px-1.5 py-0 shrink-0 ${entry.action.includes("PAUSE") ? "text-amber-400 bg-amber-500/10" :
                        entry.action.includes("UNPAUSE") || entry.action.includes("PLAY") ? "text-emerald-400 bg-emerald-500/10" :
                          entry.action.includes("SCALE") || entry.action.includes("BUDGET") ? "text-blue-400 bg-blue-500/10" :
                            "text-muted-foreground"
                        }`}
                    >
                      {actionLabel}
                    </Badge>
                    <span className="text-[11px] text-foreground truncate flex-1" title={entry.entityName}>
                      {entry.entityName.length > 40 ? entry.entityName.slice(0, 40) + "…" : entry.entityName}
                    </span>
                    <span className={`text-[10px] font-medium shrink-0 flex items-center gap-1 ${entry.success ? "text-emerald-400" : "text-red-400"}`}>
                      {entry.success ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                      {entry.success ? "success" : "failed"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── MV2-N04: Acquisition Funnel visualization (Enhanced) ─────── */}
      {(() => {
        const impressions: number = (ap as any).total_impressions ?? (ap as any).impressions ?? 0;
        const clicks: number = (ap as any).total_clicks ?? (ap as any).clicks ?? Math.round(impressions * (ap.overall_ctr / 100));
        const leads: number = ap.total_leads_30d ?? 0;
        const svsMtd: number = benchmarks?.svs_mtd ?? 0;
        const posLeads: number = benchmarks?.positive_leads_mtd ?? 0;

        const steps = [
          {
            label: "Impressions",
            value: impressions,
            color: "from-blue-500/50 to-blue-300/50",
            sub: "Awareness",
            icon: Eye
          },
          {
            label: "Clicks",
            value: clicks,
            color: "from-indigo-500/50 to-indigo-300/50",
            sub: "Consideration",
            icon: MousePointer2
          },
          {
            label: "Leads",
            value: leads,
            color: "from-purple-500/50 to-purple-300/50",
            sub: "Intent",
            icon: UserCheck
          },
          ...(svsMtd > 0 ? [{
            label: "SVs",
            value: svsMtd,
            color: "from-emerald-500/50 to-emerald-300/50",
            sub: "Conversion",
            icon: Home
          }] : []),
          ...(posLeads > 0 ? [{
            label: "Positive Leads",
            value: posLeads,
            color: "from-amber-500/50 to-amber-300/50",
            sub: "Quality",
            icon: Star
          }] : []),
        ];

        const maxVal = steps[0]?.value || 1;

        const getConvRate = (from: number, to: number) =>
          from > 0 ? ((to / from) * 100).toFixed(2) : "0.00";

        const convRateLabels = steps.map((step, i) => {
          if (i === 0) return null;
          const prev = steps[i - 1];
          const labels: Record<number, string> = { 1: "CTR", 2: "CVR", 3: "Lead→SV", 4: "SV→Pos" };
          return { label: labels[i] || "Rate", rate: getConvRate(prev.value, step.value) };
        });

        if (impressions === 0 && leads === 0) return null;

        return (
          <Card className="overflow-hidden border-border/40 bg-muted/5">
            <CardHeader className="pb-4 px-5 pt-5 border-b border-border/20">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Filter className="w-4 h-4 text-primary" />
                  Acquisition Funnel
                </CardTitle>
                <Badge variant="outline" className="text-[10px] font-medium border-primary/20 text-primary/80">
                  Performance Layer
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-5">
              <div className="space-y-0 text-center relative">
                {/* Connector line behind */}
                <div className="absolute left-[3.25rem] md:left-[5.25rem] top-8 bottom-8 w-px bg-gradient-to-b from-blue-500/20 via-purple-500/20 to-emerald-500/20 z-0 hidden sm:block" />

                {steps.map((step, i) => {
                  const widthPct = maxVal > 0 ? Math.max(15, (step.value / maxVal) * 100) : 15;
                  const conv = convRateLabels[i];
                  const Icon = step.icon;

                  return (
                    <div key={step.label} className="relative z-10 group">
                      {/* Conversion Gate Badge */}
                      {conv && (
                        <div className="flex justify-center -my-1 py-1 relative z-20">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="bg-background/80 backdrop-blur-md border border-border/60 rounded-full px-2.5 py-0.5 flex items-center gap-1.5 shadow-sm group-hover:border-primary/40 transition-colors cursor-help">
                                <TrendingDown className="w-2.5 h-2.5 text-muted-foreground" />
                                <span className="text-[10px] font-bold text-foreground">
                                  {conv.label}: <span className="text-primary">{conv.rate}%</span>
                                </span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="text-xs max-w-[200px]">
                              {conv.label === "CTR" ? "Click-Through Rate: Performance of creatives in driving traffic." :
                                conv.label === "CVR" ? "Conversion Rate: Effectiveness of your landing page in generating leads." :
                                  conv.label === "Lead→SV" ? "Lead-to-Site Visit: Quality of leads becoming qualified prospects." :
                                    "Progression rate between funnel stages."}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      )}

                      <div className="flex items-center gap-4 py-2">
                        {/* Label Layer */}
                        <div className="w-20 md:w-28 shrink-0 text-left">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80 group-hover:text-primary/70 transition-colors">
                            {step.label}
                          </p>
                          <p className="text-[9px] font-medium text-muted-foreground/40 italic">
                            {step.sub}
                          </p>
                        </div>

                        {/* Bar Container */}
                        <div className="flex-1 relative">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="h-9 w-full bg-muted/10 rounded-lg overflow-hidden border border-border/5 group-hover:border-border/20 transition-all cursor-help backdrop-blur-[2px]">
                                <div
                                  className={`h-full bg-gradient-to-r ${step.color} rounded-r-md flex items-center justify-between px-3 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)] transition-all`}
                                  style={{ width: `${widthPct}%` }}
                                >
                                  <Icon className="w-3.5 h-3.5 text-white/40 group-hover:text-white/70 transition-colors" />
                                  <span className="text-xs font-black text-white drop-shadow-md tabular-nums">
                                    {step.value > 0 ? formatNumber(step.value) : "—"}
                                  </span>
                                </div>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">
                              {step.label}: {formatNumber(step.value)} total {step.sub.toLowerCase()} actions
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg bg-muted/20 border border-border/40">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                  <p className="text-[10px] font-semibold text-foreground uppercase tracking-wider">
                    Spend context
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-sm font-bold text-primary">
                      {formatINR(ap.total_spend_30d, 0)}
                    </p>
                    <p className="text-[9px] text-muted-foreground uppercase">
                      {periodLabel} Window
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* ─── MV2-N16: Notification badge ────────────────────────── */}
      {(() => {
        const notifications: Array<{ icon: any; color: string; bg: string; text: string }> = [];

        // CPL change notification
        const cplChangePct = Math.abs((ap as any).cpl_change_pct ?? 0);
        if (cplChangePct > 15) {
          const dir = ((ap as any).cpl_change_pct ?? 0) > 0 ? "increased" : "decreased";
          notifications.push({
            icon: TrendingUp,
            color: "text-amber-400",
            bg: "bg-amber-500/10 border-amber-500/20",
            text: `CPL ${dir} by ${cplChangePct.toFixed(1)}% since last analysis`,
          });
        }

        // New entities notification
        if (newEntities?.hasNewEntities && (newEntities.totalNew ?? 0) > 0) {
          notifications.push({
            icon: AlertCircle,
            color: "text-blue-400",
            bg: "bg-blue-500/10 border-blue-500/20",
            text: `${newEntities.totalNew} new ${newEntities.totalNew === 1 ? "entity" : "entities"} since last run`,
          });
        }

        // Auto-pause candidates
        if (autoPauseCandidates.length > 0) {
          notifications.push({
            icon: Pause,
            color: "text-red-400",
            bg: "bg-red-500/10 border-red-500/20",
            text: `${autoPauseCandidates.length} ${autoPauseCandidates.length === 1 ? "entity" : "entities"} flagged for auto-pause`,
          });
        }

        // Playbooks triggered
        if (playbooksTriggered.length > 0) {
          notifications.push({
            icon: Zap,
            color: "text-purple-400",
            bg: "bg-purple-500/10 border-purple-500/20",
            text: `${playbooksTriggered.length} SOP ${playbooksTriggered.length === 1 ? "playbook" : "playbooks"} triggered`,
          });
        }

        if (notifications.length === 0) return null;

        return (
          <Card>
            <CardHeader className="pb-2 px-4 pt-4">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Bell className="w-4 h-4 text-primary" />
                Notifications
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 text-primary bg-primary/10 ml-1">
                  {notifications.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-2">
              {notifications.map((n, i) => {
                const NIcon = n.icon;
                return (
                  <div key={i} className={`flex items-center gap-3 px-3 py-2 rounded-md border ${n.bg}`}>
                    <NIcon className={`w-3.5 h-3.5 shrink-0 ${n.color}`} />
                    <span className={`text-[11px] font-medium ${n.color}`}>{n.text}</span>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })()}

      {/* ─── MV2-N21: Audit completion tracking ─────────────────── */}
      {(() => {
        const generatedAt = lastSuccessfulFetchDate;
        const now = new Date();

        interface AuditCadenceDef {
          key: string;
          label: string;
          windowHours: number;
        }

        const cadenceDefs: AuditCadenceDef[] = [
          { key: "daily", label: "Daily", windowHours: 28 },
          { key: "twice_weekly", label: "Twice Weekly", windowHours: 72 },
          { key: "weekly", label: "Weekly", windowHours: 120 },
          { key: "biweekly", label: "Bi-Weekly", windowHours: 240 },
          { key: "monthly", label: "Monthly", windowHours: 744 },
        ];

        const hoursAgoData = generatedAt
          ? (now.getTime() - generatedAt.getTime()) / 3600000
          : null;

        const auditStatuses = cadenceDefs.map((def) => {
          let status: "Completed" | "Due" | "Overdue" = "Overdue";
          if (hoursAgoData !== null) {
            if (hoursAgoData <= def.windowHours * 0.5) {
              status = "Completed";
            } else if (hoursAgoData <= def.windowHours) {
              status = "Due";
            } else {
              status = "Overdue";
            }
          }
          const isCurrent = def.key === cadenceLabel;
          return { ...def, status, isCurrent };
        });

        const completedCount = auditStatuses.filter((a) => a.status === "Completed").length;
        const completionPct = Math.round((completedCount / cadenceDefs.length) * 100);
        const lastCompletedDate = generatedAt
          ? generatedAt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
          : "Never";

        const statusStyles: Record<string, string> = {
          Completed: "text-emerald-400 bg-emerald-500/10",
          Due: "text-amber-400 bg-amber-500/10",
          Overdue: "text-red-400 bg-red-500/10",
        };

        const StatusIcon = ({ s }: { s: "Completed" | "Due" | "Overdue" }) =>
          s === "Completed"
            ? <CalendarCheck className="w-3.5 h-3.5 text-emerald-400" />
            : s === "Due"
              ? <CalendarClock className="w-3.5 h-3.5 text-amber-400" />
              : <XCircle className="w-3.5 h-3.5 text-red-400" />;

        return (
          <Card>
            <CardHeader className="pb-2 px-4 pt-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-primary" />
                  Audit Status
                </CardTitle>
                <span className="text-[11px] text-muted-foreground">
                  Audit Completion:{" "}
                  <span className={`font-semibold tabular-nums ${completionPct >= 80 ? "text-emerald-400" : completionPct >= 50 ? "text-amber-400" : "text-red-400"}`}>
                    {completionPct}%
                  </span>{" "}
                  this week
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
                {auditStatuses.map((a) => (
                  <div
                    key={a.key}
                    className={`flex flex-col gap-1 p-2.5 rounded-md border ${a.isCurrent ? "border-primary/30 bg-primary/5" : "border-border/30 bg-muted/20"}`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className={`text-[10px] font-medium uppercase tracking-wider ${a.isCurrent ? "text-primary" : "text-muted-foreground"}`}>
                        {a.label}{a.isCurrent ? " ●" : ""}
                      </span>
                      <StatusIcon s={a.status} />
                    </div>
                    <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 self-start ${statusStyles[a.status]}`}>
                      {a.status}
                    </Badge>
                    <span className="text-[9px] text-muted-foreground leading-tight">
                      {a.status === "Completed" ? `Last: ${lastCompletedDate}` : `Window: ${a.windowHours}h`}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })()}
    </div>
  );
}
