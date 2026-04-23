import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useClient } from "@/lib/client-context";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
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
import { cn } from "@/lib/utils";
import { UnifiedActions } from "@/components/unified-actions";
import { HealthScoreBreakdown } from "@/components/health-score-breakdown";
import { useBenchmarkTargets } from "@/hooks/use-meta-benchmarks";

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

type CreativeStatus = "green" | "yellow" | "red";

function getCreativeStatus(score: number | null): CreativeStatus {
  if (score === null) return "yellow";
  if (score >= 70) return "green";
  if (score >= 40) return "yellow";
  return "red";
}

function getStatusColorClasses(status: CreativeStatus): { bg: string; border: string; text: string; fill: string } {
  switch (status) {
    case "green":
      return { bg: "bg-emerald-500/10", border: "border-emerald-500/30", text: "text-emerald-400", fill: "bg-emerald-500" };
    case "yellow":
      return { bg: "bg-amber-500/10", border: "border-amber-500/30", text: "text-amber-400", fill: "bg-amber-500" };
    case "red":
      return { bg: "bg-red-500/10", border: "border-red-500/30", text: "text-red-400", fill: "bg-red-500" };
  }
}

// ─── Component ───────────────────────────────────────────────────

export default function CreativeCalendarPage() {
  const { analysisData: data, isLoadingAnalysis: isLoading, activePlatform, activeClientId } = useClient();
  const { toast } = useToast();
  const isGoogle = activePlatform === "google";
  const benchmarkTargets = useBenchmarkTargets();

  const { data: mtdData } = useQuery<{
    spend: number;
    leads: number;
    cpl: number;
    qualified_leads: number;
    svs: number;
  }>({
    queryKey: ["/api/mtd-deliverables", activeClientId, activePlatform],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/mtd-deliverables?client_id=${activeClientId}&platform=${activePlatform}`);
      return res.json();
    },
    enabled: !!activeClientId,
  });

  const [refreshedIds, setRefreshedIds] = useState<Set<string>>(new Set());

  const targetCpl = benchmarkTargets.cpl;

  const { data: pipelineData } = useQuery<{ insights: any[] }>({
    queryKey: ["/api/intelligence", activeClientId, activePlatform, "insights"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/intelligence/${activeClientId}/${activePlatform}/insights`);
      return res.json();
    },
    enabled: !!activeClientId && !!activePlatform,
  });

  const creativeInsights = useMemo(() => {
    return pipelineData?.insights?.filter(i => i.entityType === "ad") || [];
  }, [pipelineData]);

  const creatives = useMemo<CreativeEntry[]>(() => {
    if (!data) return [];
    const results: CreativeEntry[] = [];
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
    return results;
  }, [data, isGoogle]);

  const refreshQueueItems = useMemo(() => {
    return creativeInsights.map(ins => {
      const creative = creatives.find(c => c.id === ins.entityId);
      if (!creative) return null;
      return { insight: ins, creative };
    }).filter(Boolean);
  }, [creativeInsights, creatives]);

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

  const mtdSpend = mtdData?.spend || 0;
  const mtdLeads = mtdData?.leads || 0;
  const mtdCpl = mtdData?.cpl || (mtdLeads > 0 ? mtdSpend / mtdLeads : 0);

  return (
    <div className="p-6 space-y-5 max-w-[1600px]">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="size-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-sm">
              <CalendarClock className="w-4 h-4" />
            </div>
            <h1 className="t-page-title text-foreground">Creative Rotation</h1>
            <Badge variant="outline" className="ml-2 animate-pulse bg-primary/10 text-primary border-primary/20 text-[10px] font-black uppercase py-0">
              Strategic AI Audit Active
            </Badge>
          </div>
          <p className="t-caption text-muted-foreground">
            {creatives.length} creatives tracked · {timelineCreatives.length} with age data · Scoring aligned with global 4-layer AI health model.
          </p>
        </div>

        {/* ─── MTD Performance Snapshot ─── */}
        <div className="flex items-center gap-3">
          <div className="px-3 py-2 rounded-lg bg-card/40 border border-border/40 backdrop-blur-sm shadow-sm">
            <p className="t-micro text-muted-foreground uppercase tracking-widest mb-0.5 font-bold">MTD Spend</p>
            <p className="text-base font-black tabular-nums">{formatINR(mtdSpend, 0)}</p>
          </div>
          <div className="px-3 py-2 rounded-lg bg-card/40 border border-border/40 backdrop-blur-sm shadow-sm">
            <p className="t-micro text-muted-foreground uppercase tracking-widest mb-0.5 font-bold">MTD Leads</p>
            <p className="text-base font-black tabular-nums">{formatNumber(mtdLeads)}</p>
          </div>
          <div className="px-3 py-2 rounded-lg bg-primary/5 border border-primary/20 backdrop-blur-sm shadow-md">
            <p className="t-micro text-primary uppercase tracking-widest mb-0.5 font-bold">Account CPL</p>
            <p className="text-base font-black tabular-nums text-primary">{formatINR(mtdCpl, 0)}</p>
          </div>
        </div>
      </div>

      {/* ─── Creative Health Grid ────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-emerald-500/5 border-emerald-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <p className="t-micro text-emerald-400 uppercase tracking-widest font-black">Performance Winners</p>
            </div>
            <p className="text-2xl font-black tabular-nums text-emerald-400">
              {timelineCreatives.filter(c => (c.creative_score ?? 0) >= 70).length}
            </p>
            <p className="t-micro text-emerald-400/70 mt-1 font-bold">Efficiently Scaling</p>
          </CardContent>
        </Card>
        <Card className="bg-amber-500/5 border-amber-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-4 h-4 text-amber-400" />
              <p className="t-micro text-amber-400 uppercase tracking-widest font-black">Fatigue Watchlist</p>
            </div>
            <p className="text-2xl font-black tabular-nums text-amber-400">
              {timelineCreatives.filter(c => (c.creative_score ?? 0) >= 40 && (c.creative_score ?? 0) < 70).length}
            </p>
            <p className="t-micro text-amber-400/70 mt-1 font-bold">Monitor for Decay</p>
          </CardContent>
        </Card>
        <Card className="bg-red-500/5 border-red-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              <p className="t-micro text-red-400 uppercase tracking-widest font-black">Needs Immediate Refresh</p>
            </div>
            <p className="text-2xl font-black tabular-nums text-red-400">
              {timelineCreatives.filter(c => (c.creative_score ?? 0) < 40).length}
            </p>
            <p className="t-micro text-red-400/70 mt-1 font-bold">Inefficient Creative</p>
          </CardContent>
        </Card>
      </div>

      {/* ─── Refresh Queue (4-Layer Recommendations) ───────────────── */}
      {refreshQueueItems.length > 0 && (
        <Card className="border-primary/30 shadow-xl overflow-hidden bg-gradient-to-br from-card/80 to-muted/20">
          <CardHeader className="pb-3 px-6 pt-5 border-b border-border/40 bg-muted/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
                  <Sparkles className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg font-bold tracking-tight">AI Rotation Recommendations</CardTitle>
                  <p className="t-micro text-muted-foreground uppercase tracking-widest font-bold">Derived from 4-Layer Intelligence Pipeline</p>
                </div>
              </div>
              <Badge variant="outline" className="px-3 py-1 font-black text-xs uppercase tracking-widest bg-primary/5 text-primary border-primary/30">
                {refreshQueueItems.length} Actions Found
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border/30">
              {refreshQueueItems.map(({ insight: ins, creative: c }: any, idx: number) => {
                const status = getCreativeStatus(c.creative_score);
                const colors = getStatusColorClasses(status);
                return (
                  <div
                    key={idx}
                    className="p-6 hover:bg-muted/10 transition-colors group"
                  >
                    <div className="flex items-start justify-between gap-6">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2 flex-wrap">
                          <span className="text-lg font-black text-foreground tracking-tight">
                            {truncate(c.name, 50)}
                          </span>
                          <Badge variant="secondary" className={cn("t-micro px-2 py-0.5 shrink-0 font-bold border", colors.bg, colors.text, colors.border)}>
                            {Math.round(c.creative_score ?? 0)} HEALTH SCORE
                          </Badge>
                          <Badge variant="secondary" className="t-micro px-2 py-0.5 shrink-0 font-bold border border-border/40 bg-muted/50 text-muted-foreground">
                            {c.age_days} DAYS OLD
                          </Badge>
                          {ins.priority === "CRITICAL" && (
                            <Badge className="t-micro px-2 py-0.5 shrink-0 font-black uppercase tracking-widest bg-red-500/10 text-red-400 border border-red-500/30">
                              CRITICAL
                            </Badge>
                          )}
                        </div>
                        
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                          <div className="p-2 rounded-md bg-muted/30 border border-border/30">
                            <p className="t-micro text-muted-foreground uppercase tracking-wider mb-1">CTR</p>
                            <p className="text-sm font-bold tabular-nums">{formatPct(c.ctr)}</p>
                          </div>
                          <div className="p-2 rounded-md bg-muted/30 border border-border/30">
                            <p className="t-micro text-muted-foreground uppercase tracking-wider mb-1">MTD Spend</p>
                            <p className="text-sm font-bold tabular-nums">{formatINR(c.spend, 0)}</p>
                          </div>
                          <div className="p-2 rounded-md bg-muted/30 border border-border/30">
                            <p className="t-micro text-muted-foreground uppercase tracking-wider mb-1">Leads</p>
                            <p className="text-sm font-bold tabular-nums">{c.leads}</p>
                          </div>
                          <div className="p-2 rounded-md bg-muted/30 border border-border/30">
                            <p className="t-micro text-muted-foreground uppercase tracking-wider mb-1">CPL</p>
                            <p className={cn("text-sm font-bold tabular-nums", c.cpl > targetCpl ? "text-red-400" : "text-emerald-400")}>
                              {formatINR(c.cpl, 0)}
                            </p>
                          </div>
                        </div>

                        <div className="space-y-2 p-4 rounded-xl border border-primary/20 bg-primary/5 shadow-inner">
                          <div className="flex items-center gap-2">
                            <p className="t-micro text-primary font-black uppercase tracking-widest">Diagnostic Verdict:</p>
                            <span className="text-sm font-black text-foreground">{ins.issue}</span>
                          </div>
                          <p className="text-sm text-foreground/80 leading-relaxed font-medium">
                            <span className="text-primary font-bold">Recommendation:</span> {ins.recommendation}
                          </p>
                        </div>
                      </div>

                      <div className="w-64 pt-2">
                        <UnifiedActions
                          entityId={c.id}
                          entityName={c.name}
                          entityType="ad"
                          actionType={ins.priority === "CRITICAL" ? "PAUSE_AD" : "CREATIVE_REFRESH"}
                          isAutoExecutable={ins.priority === "CRITICAL"}
                          recommendation={ins.recommendation}
                          currentMetrics={{ spend: c.spend, leads: c.leads, cpl: c.cpl, ctr: c.ctr }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {refreshQueueItems.length === 0 && (
        <Card className="bg-emerald-500/5 border-emerald-500/20 border-dashed">
          <CardContent className="p-6 text-center">
            <div className="flex flex-col items-center gap-2 text-emerald-400">
              <CheckCircle2 className="w-8 h-8" />
              <p className="text-base font-bold tracking-tight">System Optimized</p>
              <p className="t-caption text-emerald-400/70">All creatives are within rotation window — no critical refresh actions needed.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Visual Timeline ──────────────────────────────────────── */}
      <Card className="shadow-2xl border-border/40 overflow-hidden bg-card/40 backdrop-blur-xl">
        <CardHeader className="pb-4 px-6 pt-6 border-b border-border/40 bg-muted/20">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg font-bold tracking-tight">Creative Age Timeline</CardTitle>
              <p className="t-micro text-muted-foreground uppercase tracking-widest font-bold">Health-First Visualization</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm bg-emerald-500" />
                <span className="t-micro font-bold text-muted-foreground uppercase tracking-widest">Healthy (&ge;70)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm bg-amber-500" />
                <span className="t-micro font-bold text-muted-foreground uppercase tracking-widest">Fatigue (40-70)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm bg-red-500" />
                <span className="t-micro font-bold text-muted-foreground uppercase tracking-widest">Stale (&lt;40)</span>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6 pt-4">
          {timelineCreatives.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-3">
              <CalendarClock className="w-12 h-12 opacity-10" />
              <p className="text-sm font-medium">No creative age data discovered in account audit</p>
            </div>
          ) : (
            <div className="space-y-2">
              {/* Day markers */}
              <div className="flex items-center gap-0 ml-[240px] mb-4">
                <div className="relative w-full h-4 border-b border-border/20">
                  {[0, 10, 20, 30, 40, 50, 60].filter(d => d <= maxAge).map((day) => (
                    <span
                      key={day}
                      className="absolute t-micro font-black text-muted-foreground -translate-x-1/2 -top-1"
                      style={{ left: `${(day / maxAge) * 100}%` }}
                    >
                      {day}d
                    </span>
                  ))}
                </div>
              </div>

              {/* Reference lines */}
              <div className="relative ml-[240px] h-0">
                <div
                  className="absolute top-0 bottom-0 border-l border-dashed border-border/30 z-10"
                  style={{ left: `${(30 / maxAge) * 100}%`, height: `${timelineCreatives.length * 42 + 20}px` }}
                />
              </div>

              {/* Creative bars */}
              <div className="space-y-3">
                {timelineCreatives.map((c) => {
                  const ageDays = c.age_days ?? 0;
                  const barWidth = Math.min((ageDays / maxAge) * 100, 100);
                  const status = getCreativeStatus(c.creative_score);
                  const colors = getStatusColorClasses(status);
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
                      className={cn("flex items-center gap-4 group h-8 transition-opacity", isRefreshed ? "opacity-30" : "opacity-100")}
                    >
                      {/* Creative name */}
                      <div className="w-[230px] shrink-0 flex items-center gap-2">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-sm font-bold text-foreground truncate cursor-default group-hover:text-primary transition-colors">
                                {truncate(c.name, 35)}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-xs p-3 space-y-2 bg-card border-border shadow-2xl">
                              <p className="font-bold border-b border-border/50 pb-1">{c.name}</p>
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                <span>CTR: {formatPct(c.ctr)}</span>
                                <span>CPL: {formatINR(c.cpl, 0)}</span>
                                <span>Spend: {formatINR(c.spend, 0)}</span>
                                <span>Freq: {c.frequency?.toFixed(1)}</span>
                              </div>
                              {c.health_signals.length > 0 && (
                                <div className="pt-2 border-t border-border/30 space-y-1">
                                  {c.health_signals.map((s, i) => (
                                    <p key={i} className="text-[10px] leading-tight text-muted-foreground">• {s}</p>
                                  ))}
                                </div>
                              )}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>

                      {/* Bar Container */}
                      <div className="flex-1 relative h-6 bg-muted/10 rounded-md overflow-hidden group-hover:bg-muted/20 transition-colors border border-border/10">
                        {/* The Actual Data Bar */}
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div
                                className={cn("absolute left-0 top-0 h-full rounded-r-md transition-all duration-700 ease-out cursor-pointer group-hover:opacity-100 opacity-80", colors.fill)}
                                style={{ width: `${barWidth}%` }}
                              />
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs font-bold">
                              {ageDays} Days Old · Health: {Math.round(c.creative_score ?? 0)}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>

                        {/* Score text overlay */}
                        {c.creative_score !== null && (
                          <div
                            className="absolute top-1/2 -translate-y-1/2 text-[10px] font-black text-white px-2 z-20 pointer-events-none drop-shadow-md"
                            style={{ left: `${Math.min(barWidth - 2, 95)}%` }}
                          >
                            {Math.round(c.creative_score)}
                          </div>
                        )}

                        {/* Warnings Overlay */}
                        {(hasCtrDecline || hasSevereFatigue) && (
                          <div className="absolute top-1/2 -translate-y-1/2 right-2 z-30">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className={cn("p-0.5 rounded-full", hasSevereFatigue ? "bg-red-500 shadow-lg shadow-red-500/50" : "bg-amber-500 shadow-lg shadow-amber-500/50")}>
                                    <TrendingDown className="w-3 h-3 text-white" />
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent side="left">
                                  <p className="text-xs font-bold">
                                    {hasSevereFatigue ? "CRITICAL FATIGUE" : "PERFORMANCE DRIFT"}
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                        )}
                      </div>

                      {/* Age label */}
                      <span className={cn("t-micro tabular-nums w-10 text-right shrink-0 font-black", colors.text)}>
                        {ageDays}d
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Rotation Strategy Guide ──────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <RefreshCw className="w-4 h-4 text-primary" />
              <p className="t-micro text-primary uppercase tracking-widest font-black">Refresh Strategy</p>
            </div>
            <ul className="text-sm space-y-2 text-foreground/80 font-medium">
              <li className="flex items-start gap-2 italic">
                • Replace Red (Stale) creatives first to immediately lower account CPL.
              </li>
              <li className="flex items-start gap-2 italic">
                • Rotate Yellow (Aging) creatives when new concepts are ready to prevent fatigue spikes.
              </li>
              <li className="flex items-start gap-2 italic">
                • Protect Green (Winners) regardless of age; only rotate if a CTR drop is sustained for 72h.
              </li>
            </ul>
          </CardContent>
        </Card>
        <Card className="bg-muted/20 border-border/40">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-muted-foreground" />
              <p className="t-micro text-muted-foreground uppercase tracking-widest font-black">System Thresholds</p>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed italic">
              AI health scores are calculated every 6 hours based on a weighted mix of CPL Efficiency (50%), 
              CTR Stability (30%), and Creative Retention (20%). Scoring is automatically benchmarked against 
              rolling account averages for the current client.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
