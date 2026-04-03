import { useMemo, useState } from "react";
import { useClient } from "@/lib/client-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  CalendarClock,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  Clock,
  TrendingDown,
  ArrowRight,
  Pause,
  Sparkles,
} from "lucide-react";
import {
  formatINR,
  formatPct,
  formatNumber,
  truncate,
  getHealthBgColor,
  getHealthBarBg,
} from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { UnifiedActions } from "@/components/unified-actions";

// ─── Types ───────────────────────────────────────────────────────

interface CreativeEntry {
  id: string;
  name: string;
  campaign_name: string;
  adset_name: string;
  age_days: number | null;
  creative_score: number | null;
  performance_score: number | null;
  age_score: number | null;
  ctr: number;
  cpm: number;
  cpl: number;
  health_signals: string[];
  spend: number;
  impressions: number;
  leads: number;
  frequency: number;
  is_video: boolean;
  thumb_stop_pct: number;
  hold_rate_pct: number;
  source: "meta" | "google";
  campaign_type?: string;
  classification?: string;
}

type FatigueLevel = "green" | "yellow" | "orange" | "red";

// ─── Updated age thresholds: green<30, yellow 30-35, orange 35-45, red>45 ───
function getAgeColor(ageDays: number, performanceScore: number | null): FatigueLevel {
  // Override: if performance_score >= 70, show green regardless of age
  if (performanceScore !== null && performanceScore >= 70) return "green";
  
  if (ageDays < 30) return "green";
  if (ageDays <= 35) return "yellow";
  if (ageDays <= 45) return "orange";
  return "red";
}

function getAgeColorClasses(level: FatigueLevel): { bg: string; border: string; text: string } {
  switch (level) {
    case "green":
      return { bg: "bg-emerald-500", border: "border-emerald-500/30", text: "text-emerald-400" };
    case "yellow":
      return { bg: "bg-yellow-500", border: "border-yellow-500/30", text: "text-yellow-400" };
    case "orange":
      return { bg: "bg-orange-500", border: "border-orange-500/30", text: "text-orange-400" };
    case "red":
      return { bg: "bg-red-500", border: "border-red-500/30", text: "text-red-400" };
  }
}

function getAgeBadgeClasses(level: FatigueLevel): string {
  switch (level) {
    case "green":
      return "text-emerald-400 bg-emerald-500/10";
    case "yellow":
      return "text-yellow-400 bg-yellow-500/10";
    case "orange":
      return "text-orange-400 bg-orange-500/10";
    case "red":
      return "text-red-400 bg-red-500/10";
  }
}

// ─── Get refresh recommendation ───────────────────────────────────
function getRefreshRecommendation(c: CreativeEntry, targetCpl: number): {
  type: "pause" | "refresh";
  text: string;
  actionType: string;
} {
  // 1. Critical Failure Signal: Poor Performance (regardless of age)
  // Logic: Score < 30 OR (Spent > 2.5x target without leads)
  const isPoorPerf = (c.performance_score !== null && c.performance_score < 35) || 
                   (c.spend > targetCpl * 2.5 && c.leads === 0);

  if (isPoorPerf) {
    return {
      type: "pause",
      text: "Stop — poor performance baseline. No traction / high CPL.",
      actionType: "PAUSE_AD",
    };
  }

  // 2. High Age Signal: Aging / Fatigued but performance is "Okay" (35-70)
  if (c.age_days !== null && c.age_days > 35) {
    return {
      type: "refresh",
      text: `Fatigue — Creative is ${c.age_days}d old. Performance is stable but needs new visual.`,
      actionType: "CREATIVE_REFRESH",
    };
  }

  // 3. Middle ground: Check specific signals
  const suggestions: string[] = [];
  if (c.is_video && (c.thumb_stop_pct || 0) < 25) suggestions.push("fix hook");
  if ((c.frequency || 0) > 3.0) suggestions.push("audience fatigue");
  
  if (suggestions.length > 0) {
    return {
      type: "refresh",
      text: `Optimize — ${suggestions.join(", ")}`,
      actionType: "CREATIVE_REFRESH",
    };
  }

  return {
    type: "refresh",
    text: "Healthy — Maintain rotation",
    actionType: "MONITOR",
  };
}

// ─── Component ───────────────────────────────────────────────────

export default function CreativeCalendarPage() {
  const { analysisData: data, isLoadingAnalysis: isLoading, benchmarks, activePlatform, activeClientId, activeClient, apiBase } = useClient();
  const { toast } = useToast();
  const isGoogle = activePlatform === "google";

  const [refreshedIds, setRefreshedIds] = useState<Set<string>>(new Set());

  const targetCpl = activeClient?.targets?.[activePlatform]?.cpl || (data as any)?.dynamic_thresholds?.cpl_target || 800;

  // Extract creatives from both platforms
  const creatives = useMemo<CreativeEntry[]>(() => {
    if (!data) return [];
    const results: CreativeEntry[] = [];

    // Unified path: both agents now provide 'creative_health' array
    const creativeHealth = (data as any).creative_health || [];
    
    if (creativeHealth.length > 0) {
      for (const c of creativeHealth) {
        results.push({
          id: c.ad_id || c.id,
          name: c.ad_name || c.name || `Ad ${c.ad_id || ""}`,
          campaign_name: c.campaign_name || "",
          adset_name: c.adset_name || c.ad_group_name || "",
          age_days: c.creative_age_days ?? c.age_days ?? null,
          creative_score: c.creative_score ?? null,
          performance_score: c.performance_score ?? null,
          age_score: c.age_score ?? null,
          ctr: c.ctr || 0,
          cpm: c.cpm || 0,
          cpl: c.cpl || 0,
          health_signals: c.health_signals || [],
          spend: c.spend || 0,
          impressions: c.impressions || 0,
          leads: c.leads || c.conversions || 0,
          frequency: c.frequency || 0,
          is_video: !!c.is_video,
          thumb_stop_pct: c.thumb_stop_pct || 0,
          hold_rate_pct: c.hold_rate_pct || 0,
          source: isGoogle ? "google" : "meta",
          classification: c.classification,
        });
      }
    }
    
    // Fallback for older Google agent data or if creative_health missing
    if (results.length === 0 && isGoogle) {
      const campaigns = (data as any).campaigns || [];
      for (const camp of campaigns) {
        const adGroups = camp.ad_groups || [];
        for (const ag of adGroups) {
          const ads = ag.ads || [];
          for (const ad of ads) {
            results.push({
              id: ad.id || ad.ad_id || `${camp.id}-${ag.id}-${Math.random().toString(36).slice(2, 8)}`,
              name: ad.name || ad.headline || `Ad ${ad.id || ""}`,
              campaign_name: camp.name || "",
              adset_name: ag.name || "",
              age_days: ad.age_days ?? ad.creative_age_days ?? null,
              creative_score: ad.score ?? ad.health_score ?? ad.creative_score ?? null,
              performance_score: ad.performance_score ?? null,
              age_score: ad.age_score ?? null,
              ctr: ad.ctr || 0,
              cpm: ad.cpm || 0,
              cpl: ad.cost_per_conversion || ad.cpl || 0,
              health_signals: ad.health_signals || [],
              spend: ad.cost || ad.spend || 0,
              impressions: ad.impressions || 0,
              leads: ad.conversions || ad.leads || 0,
              frequency: 0,
              is_video: ad.ad_type === "VIDEO" || (ad.type?.includes?.("VIDEO") ?? false),
              thumb_stop_pct: 0,
              hold_rate_pct: 0,
              source: "google",
              campaign_type: camp.campaign_type,
            });
          }
        }
      }
    }
    return results;
  }, [data, isGoogle]);

  // Separate into refresh queue and timeline — use updated threshold (>35d, not >25d)
  const refreshQueue = useMemo(() => {
    return creatives
      .filter((c) => {
        if (c.age_days === null) return false;
        if (refreshedIds.has(c.id)) return false;
        // Override: if performance_score >= 70, don't flag for refresh even if old
        if (c.performance_score !== null && c.performance_score >= 70) return false;
        return c.age_days > 35;
      })
      .sort((a, b) => {
        // Sort by creative_score (weighted) ascending — worst performers first
        const scoreA = a.creative_score ?? 0;
        const scoreB = b.creative_score ?? 0;
        return scoreA - scoreB;
      });
  }, [creatives, refreshedIds]);

  const timelineCreatives = useMemo(() => {
    return creatives
      .filter((c) => c.age_days !== null)
      .sort((a, b) => (b.age_days ?? 0) - (a.age_days ?? 0));
  }, [creatives]);

  const maxAge = useMemo(() => {
    const ages = timelineCreatives.map((c) => c.age_days ?? 0);
    return Math.max(60, ...ages);
  }, [timelineCreatives]);

  if (isLoading || !data) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64 mb-4" />
        <Skeleton className="h-40 rounded-md" />
        <Skeleton className="h-[400px] rounded-md" />
      </div>
    );
  }

  // ─── MTD Calculations ─────────────────────────────────────────
  const mp = (data as any)?.account_pulse?.monthly_pacing;
  const mtdSpend = mp?.mtd?.spend || 0;
  const mtdLeads = mp?.mtd?.leads || 0;
  const mtdQL = benchmarks?.positive_leads_mtd || 0;
  const mtdSV = benchmarks?.svs_mtd || 0;

  const mtdCpl = mtdLeads > 0 ? mtdSpend / mtdLeads : 0;
  const mtdCpql = mtdQL > 0 ? mtdSpend / mtdQL : 0;
  const mtdCpsv = mtdSV > 0 ? mtdSpend / mtdSV : 0;

  const posPct = mtdLeads > 0 ? (mtdQL / mtdLeads) * 100 : 0;
  const svPct = mtdLeads > 0 ? (mtdSV / mtdLeads) * 100 : 0;

  return (
    <div className="p-6 space-y-5 max-w-[1600px]">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <CalendarClock className="w-5 h-5 text-primary" />
            <h1 className="text-lg font-semibold text-foreground">Creative Rotation Calendar</h1>
          </div>
          <p className="text-xs text-muted-foreground">
            {creatives.length} creatives tracked · {timelineCreatives.length} with age data · Thresholds: &lt;30d green, 30-35d yellow, 35-45d orange, &gt;45d red
          </p>
        </div>

        {/* ─── MTD Performance Snapshot ─── */}
        <div className="flex items-center gap-3">
          <div className="px-3 py-2 rounded-lg bg-card/40 border border-border/40 backdrop-blur-sm">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-0.5">MTD Spend</p>
            <p className="text-sm font-bold tabular-nums">{formatINR(mtdSpend, 0)}</p>
          </div>
          <div className="px-3 py-2 rounded-lg bg-card/40 border border-border/40 backdrop-blur-sm">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-0.5">MTD Leads</p>
            <p className="text-sm font-bold tabular-nums">{formatNumber(mtdLeads)}</p>
          </div>
          <div className="px-3 py-2 rounded-lg bg-card/40 border border-border/40 backdrop-blur-sm">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-0.5">CPL</p>
            <p className="text-sm font-bold tabular-nums text-primary">{formatINR(mtdCpl, 0)}</p>
          </div>
        </div>
      </div>

      {/* ─── Creative Efficiency Grid ────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Qualified Leads</p>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold tabular-nums">{mtdQL}</span>
              <span className="text-[11px] font-medium text-emerald-400">{posPct.toFixed(1)}% Pos</span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">CPQL: {formatINR(mtdCpql, 0)}</p>
          </CardContent>
        </Card>
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Site Visits (SVs)</p>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold tabular-nums">{mtdSV}</span>
              <span className="text-[11px] font-medium text-emerald-400">{svPct.toFixed(1)}% SV</span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">CPSV: {formatINR(mtdCpsv, 0)}</p>
          </CardContent>
        </Card>
        
        {/* Existing health summary stats moved into this grid for compactness */}
        <Card>
          <CardContent className="p-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Fresh (&lt;30d)</p>
            <p className="text-xl font-bold tabular-nums text-emerald-400">
              {timelineCreatives.filter(c => (c.age_days ?? 0) < 30).length}
            </p>
            <p className="text-[9px] text-muted-foreground mt-1">Active rotation</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Aging (30–45d)</p>
            <p className="text-xl font-bold tabular-nums text-amber-400">
              {timelineCreatives.filter(c => (c.age_days ?? 0) >= 30 && (c.age_days ?? 0) <= 45).length}
            </p>
            <p className="text-[9px] text-muted-foreground mt-1">Watch for fatigue</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Stale (&gt;45d)</p>
            <p className="text-xl font-bold tabular-nums text-red-400">
              {timelineCreatives.filter(c => (c.age_days ?? 0) > 45).length}
            </p>
            <p className="text-[9px] text-muted-foreground mt-1">Needs refresh</p>
          </CardContent>
        </Card>
      </div>

      {/* ─── Refresh Queue ─────────────────────────────────────────── */}
      {refreshQueue.length > 0 && (
        <Card className="border-orange-500/30">
          <CardHeader className="pb-2 px-4 pt-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-orange-400" />
                <CardTitle className="text-sm font-medium text-orange-400">
                  Refresh Queue — {refreshQueue.length} Overdue
                </CardTitle>
              </div>
              <Badge variant="secondary" className="text-[10px] px-2 py-0.5 text-orange-400 bg-orange-500/10">
                &gt;35 days old (score &lt;70)
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="space-y-3">
              {refreshQueue.map((c) => {
                const ageLevel = getAgeColor(c.age_days!, c.creative_score);
                const ageClasses = getAgeBadgeClasses(ageLevel);
                const rec = getRefreshRecommendation(c, targetCpl);
                return (
                  <div
                    key={c.id}
                    className="p-3 rounded-md bg-muted/30 border border-border/30"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-xs font-medium text-foreground truncate max-w-[240px] block">
                                {truncate(c.name, 40)}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              <p className="text-xs max-w-sm">{c.name}</p>
                            </TooltipContent>
                          </Tooltip>
                          <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 shrink-0 ${ageClasses}`}>
                            {c.age_days}d old
                          </Badge>
                          {c.creative_score !== null && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 shrink-0 ${
                                  c.creative_score >= 70 ? "text-emerald-400 bg-emerald-500/10" :
                                  c.creative_score >= 40 ? "text-amber-400 bg-amber-500/10" :
                                  "text-red-400 bg-red-500/10"
                                }`}>
                                  Score: {c.creative_score.toFixed(0)}
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="text-[10px] font-medium">60/40 Weighted Signal</p>
                                <p className="text-[9px] text-muted-foreground mt-0.5">
                                  Perf: {c.performance_score?.toFixed(0)} (60%) + Age: {c.age_score?.toFixed(0)} (40%)
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          )}
                          {/* Pause vs Refresh badge */}
                          {rec.type === "pause" ? (
                            <Badge variant="destructive" className="text-[9px] px-1.5 py-0 shrink-0">
                              <Pause className="w-2.5 h-2.5 mr-0.5 inline" /> Pause
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[9px] px-1.5 py-0 shrink-0 text-blue-400 bg-blue-500/10">
                              <Sparkles className="w-2.5 h-2.5 mr-0.5 inline" /> Refresh
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-[10px] text-muted-foreground mb-1">
                          <span>CTR: {formatPct(c.ctr)}</span>
                          <span>CPM: {formatINR(c.cpm, 0)}</span>
                          <span>Spend: {formatINR(c.spend, 0)}</span>
                          <span>Leads: {c.leads}</span>
                          {c.cpl > 0 && <span>CPL: {formatINR(c.cpl, 0)}</span>}
                          {c.frequency > 0 && <span>Freq: {c.frequency.toFixed(2)}</span>}
                        </div>
                        <p className={`text-[10px] leading-relaxed ${rec.type === "pause" ? "text-red-400" : "text-blue-400"}`}>
                          {rec.text}
                        </p>
                        {c.health_signals.length > 0 && (
                          <div className="flex items-center gap-1 mt-1">
                            <ArrowRight className="w-2.5 h-2.5 text-primary shrink-0" />
                            <span className="text-[10px] text-primary/80 truncate">
                              {c.health_signals[0]}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                    {/* Unified Actions */}
                    <div className="mt-2 pt-2 border-t border-border/20">
                      <UnifiedActions
                        entityId={c.id}
                        entityName={c.name}
                        entityType="ad"
                        actionType={rec.actionType}
                        isAutoExecutable={rec.type === "pause"}
                        recommendation={rec.text}
                        currentMetrics={{ spend: c.spend, leads: c.leads, cpl: c.cpl, ctr: c.ctr }}
                        compact
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {refreshQueue.length === 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
              <span className="text-xs font-medium">All creatives are within rotation window — no refresh needed</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Visual Timeline ──────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2 px-4 pt-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">Creative Age Timeline</CardTitle>
            <div className="flex items-center gap-3 text-[10px]">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" />
                &lt;30d
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm bg-yellow-500 inline-block" />
                30–35d
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm bg-orange-500 inline-block" />
                35–45d
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm bg-red-500 inline-block" />
                &gt;45d
              </span>
              <span className="flex items-center gap-1 text-emerald-400">
                Score &ge;70 = green
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-2">
          {timelineCreatives.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-xs text-muted-foreground">
              No creative age data available
            </div>
          ) : (
            <div className="space-y-1.5">
              {/* Day markers */}
              <div className="flex items-center gap-0 ml-[220px] mb-2">
                <div className="relative w-full h-4">
                  {[0, 10, 20, 30, 35, 45].filter(d => d <= maxAge).map((day) => (
                    <span
                      key={day}
                      className="absolute text-[9px] text-muted-foreground -translate-x-1/2"
                      style={{ left: `${(day / maxAge) * 100}%` }}
                    >
                      {day}d
                    </span>
                  ))}
                  <span
                    className="absolute text-[9px] text-muted-foreground right-0"
                  >
                    {maxAge}d
                  </span>
                </div>
              </div>

              {/* Reference lines at 30d and 45d */}
              <div className="relative ml-[220px] h-0">
                <div
                  className="absolute top-0 bottom-0 border-l border-dashed border-yellow-500/40 z-10"
                  style={{ left: `${(30 / maxAge) * 100}%`, height: `${timelineCreatives.length * 36 + 10}px` }}
                />
                <div
                  className="absolute top-0 bottom-0 border-l border-dashed border-red-500/40 z-10"
                  style={{ left: `${(45 / maxAge) * 100}%`, height: `${timelineCreatives.length * 36 + 10}px` }}
                />
              </div>

              {/* Creative bars */}
              {timelineCreatives.map((c) => {
                const ageDays = c.age_days ?? 0;
                const barWidth = Math.min((ageDays / maxAge) * 100, 100);
                const ageLevel = getAgeColor(ageDays, c.creative_score);
                const colorClasses = getAgeColorClasses(ageLevel);
                const isPerformingWell = c.creative_score !== null && c.creative_score >= 70;
                const isRefreshed = refreshedIds.has(c.id);

                const hasCtrDecline = c.health_signals.some(s =>
                  s.toLowerCase().includes("ctr") && (s.toLowerCase().includes("declin") || s.toLowerCase().includes("drop"))
                );
                const hasSevereFatigue = c.health_signals.some(s =>
                  s.toLowerCase().includes("fatigue") || s.toLowerCase().includes("exhaust")
                );

                return (
                  <div
                    key={c.id}
                    className={`flex items-center gap-2 h-8 ${isRefreshed ? "opacity-40" : ""}`}
                  >
                    {/* Creative name */}
                    <div className="w-[210px] shrink-0 flex items-center gap-1.5">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-[11px] text-foreground truncate block max-w-[180px]">
                            {truncate(c.name, 28)}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="max-w-xs">
                          <div className="text-xs space-y-1">
                            <p className="font-medium">{c.name}</p>
                            <p className="text-muted-foreground">{c.campaign_name}</p>
                            <p>Score: {c.creative_score ?? "—"} · CTR: {formatPct(c.ctr)} · CPM: {formatINR(c.cpm, 0)}</p>
                            {c.health_signals.length > 0 && (
                              <div className="pt-1 border-t border-border/30">
                                {c.health_signals.map((s, i) => (
                                  <p key={i} className="text-[10px]">{s}</p>
                                ))}
                              </div>
                            )}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                      {c.performance_score !== null && c.performance_score >= 70 && ageDays > 30 && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant="secondary" className="text-[8px] px-1 py-0 text-emerald-400 bg-emerald-500/10 shrink-0">
                              HIGH_PERF
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="text-xs">High Performance (score {c.performance_score}) — Override aging fatigue</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>

                    {/* Bar */}
                    <div className="flex-1 relative h-5">
                      <div className="absolute inset-0 bg-muted/20 rounded-sm" />
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div
                            className={`absolute left-0 top-0 h-full rounded-sm ${colorClasses.bg} opacity-70 transition-all cursor-default`}
                            style={{ width: `${barWidth}%` }}
                          />
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          <div className="text-xs space-y-0.5">
                            <p className="font-medium">{c.name}</p>
                            <p>Age: {ageDays} days</p>
                            <p>CTR: {formatPct(c.ctr)} · CPM: {formatINR(c.cpm, 0)}</p>
                            {c.creative_score !== null && <p>Score: {c.creative_score}{isPerformingWell ? " (Performing Well)" : ""}</p>}
                          </div>
                        </TooltipContent>
                      </Tooltip>

                      {/* Score badge on bar */}
                      {c.creative_score !== null && (
                        <div
                          className="absolute top-0.5 text-[9px] font-bold text-white px-1 z-20 pointer-events-none"
                          style={{ left: `${Math.min(barWidth - 5, 90)}%` }}
                        >
                          {Math.round(c.creative_score)}
                        </div>
                      )}

                      {/* Fatigue warning */}
                      {(hasCtrDecline || hasSevereFatigue) && (
                        <div
                          className="absolute top-0.5 right-1 z-20"
                        >
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <TrendingDown className={`w-3.5 h-3.5 ${hasSevereFatigue ? "text-red-400" : "text-amber-400"}`} />
                            </TooltipTrigger>
                            <TooltipContent side="left">
                              <p className="text-xs">
                                {hasSevereFatigue ? "Severe fatigue detected" : "CTR declining — potential fatigue"}
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      )}
                    </div>

                    {/* Age label */}
                    <span className={`text-[10px] tabular-nums w-10 text-right shrink-0 ${colorClasses.text}`}>
                      {ageDays}d
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Summary Stats (updated thresholds) ────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Creatives</p>
            <p className="text-lg font-semibold tabular-nums">{creatives.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Fresh (&lt;30d)</p>
            <p className="text-lg font-semibold tabular-nums text-emerald-400">
              {timelineCreatives.filter(c => (c.age_days ?? 0) < 30).length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Aging (30–45d)</p>
            <p className="text-lg font-semibold tabular-nums text-amber-400">
              {timelineCreatives.filter(c => (c.age_days ?? 0) >= 30 && (c.age_days ?? 0) <= 45).length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Stale (&gt;45d)</p>
            <p className="text-lg font-semibold tabular-nums text-red-400">
              {timelineCreatives.filter(c => (c.age_days ?? 0) > 45).length}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
