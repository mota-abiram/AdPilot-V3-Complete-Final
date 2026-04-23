import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useClient } from "@/lib/client-context";
import { apiRequest } from "@/lib/queryClient";
import { formatINR, formatPct, getCplColor, truncate } from "@/lib/format";
import {
  BarChart3,
  Clock,
  AlertTriangle,
  IndianRupee,
  Trophy,
  ThumbsDown,
  MapPin,
  Info,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Ban,
  Flag,
  Eye,
  SlidersHorizontal,
  ArrowUpDown,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { UnifiedActions, type UnifiedActionItem, type ActionState } from "@/components/unified-actions";
import { HealthScoreBreakdown } from "@/components/health-score-breakdown";
import { useExecution } from "@/hooks/use-execution";
import { useBenchmarkTargets } from "@/hooks/use-meta-benchmarks";

// ─── Constants & Types ──────────────────────────────────────────────

const ACCOUNT_OVERVIEW = "all";
const META_TABS = ["Age", "Gender", "Placement", "Device", "Region"] as const;
type MetaTabType = (typeof META_TABS)[number];

const META_COLUMN_CONFIG = [
  { column: "Dimension", description: "Breakdown segment (Age, Gender, etc.)" },
  { column: "Health Score", description: "Score based on CPL, CTR, and conversion efficiency" },
  { column: "Spend", description: "Spend for this segment" },
  { column: "Leads", description: "Conversions for segment" },
  { column: "CPL", description: "Cost per lead" },
  { column: "CTR", description: "Click-through rate" },
  { column: "CPM", description: "Cost per 1000 impressions" },
  { column: "Recommendation", description: "Action based on score" },
  { column: "Actions", description: "Manual audit control" }
];

const GOOGLE_TABS = ["Age", "Gender", "Device", "Location", "Placement"] as const;
type GoogleTabType = (typeof GOOGLE_TABS)[number];

const GOOGLE_TAB_KEYS: Record<GoogleTabType, string> = {
  Age: "age",
  Gender: "gender",
  Device: "device",
  Location: "location",
  Placement: "placement",
};

interface BreakdownRow {
  dimension: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  leads: number;
  cpl: number;
  classification?: string;
  is_target_location?: boolean;
}

interface GoogleBreakdownRow extends BreakdownRow {
  cost: number;
  conversions: number;
  cvr: number;
  bid_adjustment?: number;
}

interface BreakdownData {
  available: boolean;
  message?: string;
  breakdowns: any;
  geo_alerts: any[];
  target_locations: string[];
  dynamic_thresholds?: any;
}

// ─── Layout Helper ──────────────────────────────────────────────────

function formatNumber(n: number) {
  return n.toLocaleString();
}

// ─── Shared Components ─────────────────────────────────────────────


function getPerformanceStatus(score: number) {
  // Pure band-based scoring for breakdowns to handle high segment volatility
  if (score >= 70) return "GOOD";
  if (score >= 40) return "MODERATE";
  return "POOR";
}

function getHealthStatus(score: number) {
  const status = getPerformanceStatus(score);
  
  if (status === "GOOD") {
    return { label: "GOOD", color: "text-emerald-500", bg: "bg-emerald-500", lightBg: "bg-emerald-500/10", border: "border-emerald-500/20" };
  }
  if (status === "MODERATE") {
    return { label: "MODERATE", color: "text-amber-500", bg: "bg-amber-500", lightBg: "bg-amber-500/10", border: "border-amber-500/20" };
  }
  return { label: "POOR", color: "text-red-500", bg: "bg-red-500", lightBg: "bg-red-500/10", border: "border-red-500/20" };
}

/**
 * Mojo AdCortex v1.0 Quadratic Scoring Helpers
 */
const scoreWeightedCostMetric = (actual: number, target: number, weight: number) => {
  if (target <= 0) return weight;
  const d = Math.max(0, (actual - target) / target);
  // Using slightly more lenient breakdown decay: 1 - 1.2d - 3d^2 (vs 1.5d / 5d^2)
  return weight * Math.max(0, 1 - 1.2 * d - 3 * d * d);
};

const scoreWeightedBenefitMetric = (actual: number, target: number, weight: number) => {
  if (target <= 0 || actual >= target) return weight;
  const d = (target - actual) / target;
  return weight * Math.max(0, 1 - 1.2 * d - 3 * d * d);
};

const scoreWeightedBudgetMetric = (actual: number, planned: number, weight: number) => {
  if (planned <= 0) return weight;
  const b = Math.abs(actual - planned) / planned;
  return weight * Math.max(0, 1 - b - 10 * b * b);
};

function computeBreakdownScore(row: any, target: number, ctrBenchmark: number, cpmBenchmark: number, targetSpend: number) {
  const cplScore = scoreWeightedCostMetric(row.leads > 0 ? row.cpl : (row.spend > 0 ? 999999 : 0), target, 35);
  const ctrScore = scoreWeightedBenefitMetric(row.ctr, ctrBenchmark, 20);
  const cpmScore = scoreWeightedCostMetric(row.cpm, cpmBenchmark, 20);
  
  // Revised Spend Score: "More spend = More score" (Benefit logic)
  // Penalizing underspend but rewarding scale.
  const spendScore = targetSpend > 0 
    ? Math.min(25, (row.spend / targetSpend) * 25)
    : (row.spend > 0 ? 25 : 0);

  const total = Math.round(cplScore + ctrScore + cpmScore + spendScore);
  
  // Weights: CPL(35), CTR(20), CPM(20), SPEND(25)
  // CRITICAL: We exclude Spend from the Veto Gate for breakdowns. 
  // An efficient segment with low spend is still "GOOD" (scale candidate), not "POOR".
  const efficiencyRatios = [
    cplScore / 35,
    ctrScore / 20,
    cpmScore / 20
  ];
  const minRatio = Math.min(...efficiencyRatios);

  return {
    total,
    minRatio,
    cplScore: Math.round(cplScore),
    ctrScore: Math.round(ctrScore),
    cpmScore: Math.round(cpmScore),
    spendScore: Math.round(spendScore),
  };
}

function getRecommendationType(row: any, score: number, tabName: string, isTarget?: boolean) {
  if (tabName === "Region" && isTarget === false && row.spend > 0) {
    return { type: "exclude", text: "Pause / Exclude", color: "text-red-500", lightBg: "bg-red-500/10", border: "border-red-500/20", reason: "Outside target geography" };
  }
  
  const status = getPerformanceStatus(score);

  if (status === "GOOD") return { type: "scale", text: "Scale / Increase budget", color: "text-emerald-500", lightBg: "bg-emerald-500/10", border: "border-emerald-500/20", reason: "Top tier performance" };
  if (status === "MODERATE") return { type: "monitor", text: "Monitor / Optimize", color: "text-amber-500", lightBg: "bg-amber-500/10", border: "border-amber-500/20", reason: "Satisfactory performance" };
  
  // For POOR
  if (score > 0) return { type: "reduce", text: "Reduce spend / Pause", color: "text-red-500", lightBg: "bg-red-500/10", border: "border-red-500/20", reason: "Severe inefficiency" };
  return { type: "none", text: "Needs Data", color: "text-muted-foreground", lightBg: "bg-muted", border: "border-transparent", reason: "Insufficient impressions" };
}

// ─── Main Component ────────────────────────────────────────────────

export default function BreakdownsPage() {
  const { activeClient: client, activeCadence: globalCadence, activePlatform } = useClient();

  const clientId = client?.id || "amara";
  const platformKey = activePlatform === "google" ? "google" : "meta";
  const apiBase = `/api/clients/${clientId}`;

  const { data: analysisData, isLoading: isLoadingAnalysis } = useQuery({
    queryKey: [apiBase, platformKey, "analysis", globalCadence],
    queryFn: async () => {
      const url = `${apiBase}/${platformKey}/analysis?cadence=${globalCadence}`;
      const res = await apiRequest("GET", url);
      return res.json();
    },
  });

  const activeCadence = analysisData?.active_cadence || globalCadence;

  return (
    <div className="min-h-screen bg-background">
      {platformKey === "meta" ? (
        <MetaBreakdowns
          clientId={clientId}
          analysisData={analysisData}
          isLoadingAnalysis={isLoadingAnalysis}
          activeCadence={activeCadence}
        />
      ) : (
        <GoogleBreakdowns
          clientId={clientId}
          analysisData={analysisData}
          isLoadingAnalysis={isLoadingAnalysis}
          activeCadence={activeCadence}
        />
      )}
    </div>
  );
}

// ─── Meta Breakdowns ───────────────────────────────────────────────

function MetaBreakdowns({ clientId, analysisData, isLoadingAnalysis, activeCadence }: any) {
  const apiBase = `/api/clients/${clientId}/meta`;
  const [activeTab, setActiveTab] = useState<MetaTabType>("Age");
  const [selectedCampaign, setSelectedCampaign] = useState(ACCOUNT_OVERVIEW);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<string>("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const { executeBatch, isExecuting } = useExecution();

  async function handleManualAudit(row: any, action: "MANUAL_COMPLETE" | "MANUAL_REJECT") {
    await executeBatch([{
      action: action as any,
      entityId: `meta-${activeTab}-${row.dimension}`,
      entityName: `${activeTab}: ${row.dimension}`,
      entityType: "adset",
      params: { 
        reason: `Manual audit from Breakdowns page: ${action}`,
        segment: row.dimension,
        dimension: activeTab
      }
    }]);
  }


  function toggleSort(key: string) {
    if (sortKey === key) { setSortDir(d => d === "asc" ? "desc" : "asc"); }
    else { setSortKey(key); setSortDir("desc"); }
  }

  function toggleExpand(id: string) { setExpandedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }

  const thresholds = analysisData?.sop_benchmarks ?? analysisData?.dynamic_thresholds ?? {};
  const cplTarget = thresholds?.cpl_target ?? thresholds?.cpl ?? 1000;
  const ctrTarget = thresholds?.ctr_min ?? thresholds?.ctr_target ?? 0.8;
  const cpmTarget = thresholds?.cpm_max ?? thresholds?.cpm_target ?? 150;

  const campaigns = useMemo(() => {
    if (!analysisData?.campaign_audit) return [];
    return analysisData.campaign_audit
      .filter((c: any) => c.spend > 0)
      .map((c: any) => ({
        id: c.campaign_id,
        name: c.campaign_name,
        cpl: c.cpl,
        spend: c.spend,
        leads: c.leads,
        budget: c.daily_budget || c.budget || 0,
      }))
      .sort((a: any, b: any) => b.spend - a.spend);
  }, [analysisData]);

  const { data, isLoading } = useQuery<BreakdownData>({
    queryKey: [apiBase, "breakdowns", selectedCampaign, "mtd"],
    queryFn: async () => {
      const url = selectedCampaign === ACCOUNT_OVERVIEW
        ? `${apiBase}/breakdowns?cadence=mtd`
        : `${apiBase}/breakdowns/${selectedCampaign}?cadence=mtd`;
      const res = await apiRequest("GET", url);
      return res.json();
    },
  });

  const tabKey = activeTab.toLowerCase();

  const rawRows: BreakdownRow[] = useMemo(() => {
    const source = data?.available && data.breakdowns?.[tabKey] ? data.breakdowns[tabKey] : [];
    if (selectedCampaign !== ACCOUNT_OVERVIEW) return source;
    const aggregated: Record<string, BreakdownRow> = {};
    source.forEach((row: any) => {
      const dim = row.dimension || "Unknown";
      if (!aggregated[dim]) { 
        aggregated[dim] = { ...row }; 
        if (aggregated[dim].cpm === undefined) {
          aggregated[dim].cpm = aggregated[dim].impressions > 0 ? (aggregated[dim].spend / aggregated[dim].impressions) * 1000 : 0;
        }
      }
      else {
        const agg = aggregated[dim];
        agg.spend += row.spend;
        agg.impressions += row.impressions;
        agg.clicks += row.clicks;
        agg.leads += row.leads;
        agg.cpl = agg.leads > 0 ? agg.spend / agg.leads : 0;
        agg.ctr = agg.impressions > 0 ? (agg.clicks / agg.impressions) * 100 : 0;
        agg.cpm = agg.impressions > 0 ? (agg.spend / agg.impressions) * 1000 : 0;
      }
    });
    return Object.values(aggregated);
  }, [data, tabKey, selectedCampaign]);

  const rows = useMemo(() => {
    return [...rawRows].sort((a, b) => {
      const aVal = (a as any)[sortKey] ?? 0;
      const bVal = (b as any)[sortKey] ?? 0;
      if (typeof aVal === "string") return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      return sortDir === "asc" ? aVal - bVal : bVal - aVal;
    });
  }, [rawRows, sortKey, sortDir]);

  const totalSpend = rows.reduce((s, r) => s + r.spend, 0);
  const totalLeads = rows.reduce((s, r) => s + r.leads, 0);

  const daysElapsed = analysisData?.monthly_pacing?.days_elapsed || analysisData?.account_pulse?.mtd_pacing?.days_elapsed || new Date().getDate();
  const numDivisions = Math.max(1, rows.length);

  const segmentTargetSpend = useMemo(() => {
    if (selectedCampaign === ACCOUNT_OVERVIEW) {
      const accountMonthlyBudget = thresholds?.budget || analysisData?.targets?.budget || analysisData?.summary?.total_spend || 0;
      const accountDailySpend = accountMonthlyBudget / 30;
      return (accountDailySpend / numDivisions) * daysElapsed;
    } else {
      const camp = campaigns.find((c: any) => c.id === selectedCampaign);
      const campBudget = camp?.budget || 0; 
      return (campBudget / numDivisions) * daysElapsed;
    }
  }, [selectedCampaign, campaigns, numDivisions, daysElapsed, thresholds, analysisData]);

  const scoredRows = useMemo(() => {
    return rows.map((row) => {
      if (row.cpm === undefined || isNaN(row.cpm)) {
        row.cpm = row.impressions > 0 ? (row.spend / row.impressions) * 1000 : 0;
      }
      const score = computeBreakdownScore(row, cplTarget, ctrTarget, cpmTarget, segmentTargetSpend);
      const rec = getRecommendationType(row, score.total, activeTab, row.is_target_location);
      return { row, score, rec };
    });
  }, [rows, cplTarget, ctrTarget, cpmTarget, segmentTargetSpend, activeTab]);

  if (isLoading) return <div className="p-12 text-center text-muted-foreground"><Clock className="w-8 h-8 mx-auto mb-2 animate-spin opacity-20" /><p>Synthesizing Meta Ads Breakdowns...</p></div>;

  return (
    <div className="p-6 space-y-6 max-w-[1600px]">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
            <BarChart3 className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight">Meta Breakdowns Engine</h2>
            <p className="text-xs text-muted-foreground uppercase tracking-widest font-bold">Performance Audit Layer</p>
          </div>
        </div>
        <Select value={selectedCampaign} onValueChange={setSelectedCampaign}>
          <SelectTrigger className="w-[340px] h-11 bg-card border-border/60 shadow-md">
            <SelectValue placeholder="Campaign Selection" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ACCOUNT_OVERVIEW} className="font-semibold">Account-Wide View</SelectItem>
            {campaigns.map((c: any) => (
              <SelectItem key={c.id} value={c.id}>{truncate(c.name, 45)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-1 bg-muted/20 p-1 rounded-xl border border-border/40 w-fit">
        {META_TABS.map(tab => (
          <button key={tab} onClick={() => { setActiveTab(tab); setExpandedIds(new Set()); }}
            className={cn("px-6 py-2 text-xs font-bold uppercase tracking-widest rounded-lg transition-all", activeTab === tab ? "bg-primary text-primary-foreground shadow-lg" : "text-muted-foreground hover:text-foreground")}>
            {tab}
          </button>
        ))}
      </div>

      <Card className="border-border/60 shadow-2xl overflow-hidden bg-card/40 backdrop-blur-xl">
        <div className="overflow-x-auto">
          <table className="t-table w-full">
            <thead>
              <tr className="bg-muted/30 border-b border-border/60">
                {META_COLUMN_CONFIG.map((col, idx) => (
                  <th key={idx} className={cn("px-4 py-4 t-label font-bold uppercase tracking-widest text-muted-foreground text-left")}>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger className="flex items-center gap-1.5 hover:text-foreground transition-colors">
                          {col.column} <Info className="w-3 h-3 opacity-40" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[200px] p-3 space-y-2 bg-card border-border shadow-2xl">
                          <p className="font-bold border-b border-border/50 pb-1">{col.column} SOP</p>
                          <p className="text-xs leading-relaxed text-muted-foreground">{col.description}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scoredRows.map(({ row, score, rec }, i) => {
                const isExpanded = expandedIds.has(row.dimension);
                const health = getHealthStatus(score.total);
                return (
                  <React.Fragment key={i}>
                    <tr className={cn("border-b border-border/20 hover:bg-muted/30 transition-all cursor-pointer group", isExpanded && "bg-primary/5")} onClick={() => toggleExpand(row.dimension)}>
                      <td className="p-4 font-bold text-foreground text-base tracking-tight">{row.dimension}</td>
                      <td className="p-4">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="w-full max-w-[180px]">
                                <div className="flex items-center justify-between mb-1.5">
                                  <span className={cn("text-xs font-bold uppercase tracking-widest", health.color)}>{health.label}</span>
                                  <span className="text-xs font-bold text-foreground">{score.total}<span className="text-muted-foreground">/100</span></span>
                                </div>
                                <div className="h-1.5 w-full bg-border/40 rounded-full overflow-hidden">
                                  <div className={cn("h-full rounded-full", health.bg)} style={{ width: `${score.total}%` }} />
                                </div>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="bg-card border-border shadow-xl">
                              <p className="text-xs">Based on CPL efficiency, CTR, and conversion volume.</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </td>
                      <td className="p-4 tabular-nums font-bold text-foreground/80">{formatINR(row.spend, 0)}</td>
                      <td className="p-4 tabular-nums font-bold text-foreground">{row.leads}</td>
                      <td className={cn("p-4 tabular-nums font-bold", getCplColor(row.cpl, thresholds))}>{row.cpl > 0 ? formatINR(row.cpl, 0) : "—"}</td>
                      <td className="p-4 tabular-nums font-bold text-foreground/70">{formatPct(row.ctr)}</td>
                      <td className="p-4 tabular-nums font-bold text-foreground/70">{formatINR(row.cpm, 0)}</td>
                      <td className="p-4">
                        <div className={cn("inline-flex items-center gap-2 px-2.5 py-1 rounded border shadow-xs", rec.lightBg, rec.border, rec.color)}>
                          <div className={cn("w-1.5 h-1.5 rounded-full", rec.color.replace('text-', 'bg-'))} />
                          <span className="text-xs font-bold uppercase tracking-wider">{rec.text}</span>
                        </div>
                      </td>
                      <td className="p-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-emerald-400 hover:text-emerald-500 hover:bg-emerald-500/10"
                            onClick={() => handleManualAudit(row, "MANUAL_COMPLETE")}
                            disabled={isExecuting}
                          >
                            {isExecuting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-red-400 hover:text-red-500 hover:bg-red-500/10"
                            onClick={() => handleManualAudit(row, "MANUAL_REJECT")}
                            disabled={isExecuting}
                          >
                            {isExecuting ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-muted/10">
                        <td colSpan={9} className="p-8 border-b border-primary/20 space-y-6">
                          <div className="space-y-6">
                            <HealthScoreBreakdown
                              entityName={row.dimension}
                              scoreBreakdown={{
                                "CPL_Efficiency": score.cplScore,
                                "CTR_Impact": score.ctrScore,
                                "CPM_Impact": score.cpmScore,
                                "Spend_Utilization": score.spendScore
                              }}
                              detailedBreakdown={{
                                "CPL_Efficiency": { actual: row.cpl, target: cplTarget, unit: "currency", contribution: score.cplScore, weight: 35 },
                                "CTR_Impact": { actual: row.ctr, target: ctrTarget, unit: "percent", contribution: score.ctrScore, weight: 20 },
                                "CPM_Impact": { actual: row.cpm, target: cpmTarget, unit: "currency", contribution: score.cpmScore, weight: 20 },
                                "Spend_Utilization": { actual: row.spend, target: Math.round(segmentTargetSpend), unit: "currency", contribution: score.spendScore, weight: 25 }
                              }}
                            />
                            
                            <div className={cn("p-5 rounded-xl border bg-background/80 shadow-sm space-y-2", health.border)}>
                              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Expert Recommendation:</p>
                              <p className="text-base font-medium text-foreground leading-relaxed">
                                System indicates <span className={cn("font-bold", rec.color)}>{rec.text}</span> because {rec.reason.toLowerCase()}. 
                                Efficiency Score of <span className={cn("font-bold", health.color)}>{score.total}/100</span> suggests this segment is 
                                {score.total >= 60 ? " prime for budget acceleration or stabilization." : " currently underperforming relative to account-wide benchmarks and requires intervention."}
                              </p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ─── Google Breakdowns ─────────────────────────────────────────────

function GoogleBreakdowns({ clientId, analysisData, isLoadingAnalysis, activeCadence }: any) {
  const apiBase = `/api/clients/${clientId}/google`;
  const benchmarkTargets = useBenchmarkTargets();
  const [activeTab, setActiveTab] = useState<GoogleTabType>("Age");
  const [selectedCampaign, setSelectedCampaign] = useState(ACCOUNT_OVERVIEW);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [columnSize, setColumnSize] = useState<"compact" | "normal" | "wide">("normal");
  const [sortKey, setSortKey] = useState<string>("cost");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const { executeBatch, isExecuting } = useExecution();


  function toggleSort(key: string) {
    if (sortKey === key) { setSortDir(d => d === "asc" ? "desc" : "asc"); }
    else { setSortKey(key); setSortDir("desc"); }
  }

  function toggleExpand(id: string) { setExpandedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }

  const { data, isLoading } = useQuery<BreakdownData>({
    queryKey: [apiBase, "breakdowns", selectedCampaign, activeCadence],
    queryFn: async () => {
      const url = selectedCampaign === ACCOUNT_OVERVIEW
        ? `${apiBase}/breakdowns?cadence=${activeCadence}`
        : `${apiBase}/breakdowns/${selectedCampaign}?cadence=${activeCadence}`;
      const res = await apiRequest("GET", url);
      return res.json();
    },
  });

  const tabKey = GOOGLE_TAB_KEYS[activeTab];

  const rawRows: GoogleBreakdownRow[] = useMemo(() => {
    if (!data?.available || !data.breakdowns) return [];

    // Google demographic_breakdowns is a global object with keys like 'age', 'gender', 'device'
    // Each key contains a flat array of records for ALL campaigns.
    const allRecords = data.breakdowns[tabKey] || [];

    // 1. Filter by selected campaign if not ACCOUNT_OVERVIEW
    const filtered = selectedCampaign === ACCOUNT_OVERVIEW
      ? allRecords
      : allRecords.filter((r: any) => r.campaign_id === selectedCampaign);

    // 2. Aggregate by dimension
    const aggregated: Record<string, GoogleBreakdownRow> = {};

    filtered.forEach((r: any) => {
      // Handle the various field names Google uses for dimensions
      const dim = r.age_range || r.gender || r.device || r.region || r.location || r.dimension || "Unknown";

      if (!aggregated[dim]) {
        aggregated[dim] = {
          ...r,
          dimension: dim,
          cost: r.cost || r.spend || 0,
          conversions: r.conversions || r.leads || 0,
          impressions: r.impressions || 0,
          clicks: r.clicks || 0
        };
      } else {
        const agg = aggregated[dim];
        agg.cost += (r.cost || r.spend || 0);
        agg.impressions += (r.impressions || 0);
        agg.clicks += (r.clicks || 0);
        agg.conversions += (r.conversions || r.leads || 0);
      }
    });

    // 3. Final metric derivation
    return Object.values(aggregated).map(r => ({
      ...r,
      ctr: r.impressions > 0 ? (r.clicks / r.impressions) * 100 : 0,
      cpc: r.clicks > 0 ? r.cost / r.clicks : 0,
      cpl: r.conversions > 0 ? r.cost / r.conversions : 0,
      cvr: r.clicks > 0 ? (r.conversions / r.clicks) * 100 : 0,
      cpm: r.impressions > 0 ? (r.cost / r.impressions) * 1000 : 0,
    }));
  }, [data, tabKey, selectedCampaign]);

  const rows = useMemo(() => {
    return [...rawRows].sort((a, b) => {
      const aVal = (a as any)[sortKey] ?? 0;
      const bVal = (b as any)[sortKey] ?? 0;
      return sortDir === "asc" ? aVal - bVal : bVal - aVal;
    });
  }, [rawRows, sortKey, sortDir]);

  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  const rowsWithConversions = rows.filter(r => r.conversions > 0);
  const best = rowsWithConversions.length > 0 ? rowsWithConversions.reduce((a, b) => (a.cpl < b.cpl ? a : b)) : null;
  const cplTarget = benchmarkTargets.cpl;
  const ctrTarget = benchmarkTargets.ctrMin;
  const conversionTarget = rows.length > 0 && benchmarkTargets.leads > 0
    ? Math.max(1, Math.round(benchmarkTargets.leads / rows.length))
    : 0;

  if (isLoading) return <div className="p-12 text-center text-muted-foreground"><Clock className="w-8 h-8 mx-auto mb-2 animate-spin opacity-20" /><p>Scanning Google demographics...</p></div>;

  if (!data?.available) {
    return (
      <Card className="m-6 bg-muted/20 border-border/50">
        <CardContent className="p-12 text-center">
          <Clock className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-base text-muted-foreground">
            {data?.message || "Google breakdown data not yet synced for this cadence."}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card className="m-6 bg-muted/20 border-border/50" >
        <CardContent className="p-12 text-center">
          <Clock className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-base text-muted-foreground">
            No {activeTab.toLowerCase()} segments detected for the selected period.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="p-6 space-y-4 max-w-[1600px]">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-6 h-6 text-[#F0BC00]" />
          <h2 className="text-xl font-bold tracking-tight">Google Breakdown Intelligence</h2>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <MetricCard icon={IndianRupee} label="Total Cost" value={formatINR(totalCost, 0)} color="text-[#F0BC00]" />
        <MetricCard icon={Trophy} label="Best Google Performance" value={best ? best.dimension : "—"} subValue={best ? `CPL ${formatINR(best.cpl, 0)}` : ""} color="text-emerald-400" />
      </div>

      <div className="flex items-center gap-1 border-b border-border/50">
        {GOOGLE_TABS.map(tab => (
          <button key={tab} onClick={() => { setActiveTab(tab); setExpandedIds(new Set()); }}
            className={cn("px-4 py-2.5 text-xs font-bold uppercase tracking-widest border-b-2 transition-all", activeTab === tab ? "text-[#F0BC00] border-[#F0BC00] bg-[#F0BC00]/5" : "text-muted-foreground border-transparent hover:text-foreground hover:bg-muted/50")}>
            {tab}
          </button>
        ))}
      </div>

      <Card className="border-border/40 shadow-sm overflow-hidden bg-card/30">
        <div className="overflow-x-auto">
          <table className="t-table w-full">
            <thead>
              <tr className="bg-muted/20 border-b border-border/50">
                <th className="p-3 w-10"></th>
                <th className="p-3 text-left font-bold uppercase tracking-widest text-muted-foreground">Dimension</th>
                <th className="p-3 text-right font-bold uppercase tracking-widest text-muted-foreground">Cost</th>
                <th className="p-3 text-right font-bold uppercase tracking-widest text-muted-foreground">Clicks</th>
                <th className="p-3 text-right font-bold uppercase tracking-widest text-muted-foreground">CTR</th>
                <th className="p-3 text-right font-bold uppercase tracking-widest text-muted-foreground">CPM</th>
                <th className="p-3 text-right font-bold uppercase tracking-widest text-muted-foreground">Conv</th>
                <th className="p-3 text-right font-bold uppercase tracking-widest text-muted-foreground">CPL</th>
                <th className="p-3 text-center font-bold uppercase tracking-widest text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const isExpanded = expandedIds.has(row.dimension);
                const itemId = `google-${activeTab}-${row.dimension}`;
                return (
                  <React.Fragment key={i}>
                    <tr className={cn("border-b border-border/30 hover:bg-muted/20 transition-all cursor-pointer", isExpanded && "bg-[#F0BC00]/5")} onClick={() => toggleExpand(row.dimension)}>
                      <td className="p-3"><Button variant="ghost" size="sm" className="h-6 w-6 p-0">{isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</Button></td>
                      <td className="p-3 font-semibold text-foreground">{row.dimension}</td>
                      <td className="p-3 text-right tabular-nums font-medium">{formatINR(row.cost, 0)}</td>
                      <td className="p-3 text-right tabular-nums text-muted-foreground">{formatNumber(row.clicks)}</td>
                      <td className="p-3 text-right tabular-nums">{formatPct(row.ctr)}</td>
                      <td className="p-3 text-right tabular-nums">{formatINR(row.cpm, 0)}</td>
                      <td className="p-3 text-right tabular-nums font-bold text-foreground">{row.conversions}</td>
                      <td className={cn("p-3 text-right tabular-nums font-bold", row.cpl > 0 && cplTarget > 0 && row.cpl <= cplTarget ? "text-emerald-400" : "text-foreground")}>{row.cpl > 0 ? formatINR(row.cpl, 0) : "—"}</td>
                      <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1 justify-center">
                          <UnifiedActions compact item={{ id: itemId, description: `Google ${activeTab}: ${row.dimension}`, autoExecutable: false }}
                            entityId={itemId} entityName={`${activeTab}: ${row.dimension}`} entityType="adset" actionType="MANUAL_ACTION"
                            recommendation="Monitor segment" onStateChange={() => { }} />
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-muted/5">
                        <td colSpan={9} className="p-8 border-b border-border/40 space-y-6">
                          <HealthScoreBreakdown
                            entityName={row.dimension}
                            scoreBreakdown={{
                              "CPL_Efficiency": row.cpl > 0 && cplTarget > 0 && row.cpl <= cplTarget ? 80 : 40,
                              "Conversion_Volume": conversionTarget > 0 && row.conversions >= conversionTarget ? 90 : 20,
                              "CTR_Impact": ctrTarget > 0 && row.ctr >= ctrTarget ? 85 : 45
                            }}
                            detailedBreakdown={{
                              "CPL_Efficiency": { actual: row.cpl, target: cplTarget, unit: "currency", contribution: row.cpl > 0 && cplTarget > 0 && row.cpl <= cplTarget ? 40 : 20, weight: 50 },
                              "Conversion_Volume": { actual: row.conversions, target: conversionTarget, unit: "number", contribution: conversionTarget > 0 && row.conversions >= conversionTarget ? 18 : 4, weight: 20 },
                              "CTR_Impact": { actual: row.ctr, target: ctrTarget, unit: "percent", contribution: ctrTarget > 0 && row.ctr >= ctrTarget ? 17 : 9, weight: 20 }
                            }}
                          />
                          <div className="p-5 rounded-xl border border-border/40 bg-background/80 shadow-sm mt-4">
                            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Strategic analysis:</p>
                            <p className="text-base font-medium text-foreground leading-relaxed">
                              Strategic analysis for Google segment <strong>{row.dimension}</strong>. Cost per lead is {row.cpl > 0 ? formatINR(row.cpl, 0) : "not yet established"}. 
                              {row.cpl > 0 && cplTarget > 0 && row.cpl <= cplTarget ? " Performance is within the configured Google benchmark target." : " Intervention may be required to qualify traffic and reduce CPA drift."}
                            </p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ─── Shared UI Components ──────────────────────────────────────────

function MetricCard({ icon: Icon, label, value, subValue, color }: any) {
  return (
    <Card className="bg-card/50 border-border/40">
      <CardContent className="card-content-premium">
        <div className="flex items-center gap-2 mb-2">
          <Icon className={cn("w-4 h-4", color)} />
          <span className="text-xs font-black uppercase tracking-widest text-muted-foreground">{label}</span>
        </div>
        <p className="text-lg font-black tracking-tight">{value}</p>
        {subValue && <p className="text-xs text-muted-foreground mt-1">{subValue}</p>}
      </CardContent>
    </Card>
  );
}

function ProgressBar({ pct, color }: { pct: number, color: string }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="w-16 h-1 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full", color)} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-xs text-muted-foreground w-8 text-right font-medium">{pct.toFixed(0)}%</span>
    </div>
  );
}
