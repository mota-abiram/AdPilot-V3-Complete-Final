import { useState, useMemo, useEffect } from "react";
import { useClient } from "@/lib/client-context";
import { DataTablePagination } from "@/components/data-table-pagination";
import type { CreativeHealth } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ArrowUpDown, ChevronDown, ChevronUp, Video, Image, Pause, Play } from "lucide-react";
import {
  formatINR,
  formatPct,
  formatNumber,
  getHealthBgColor,
  getHealthBarBg,
  getClassificationColor,
  getCplColor,
  getCtrColor,
  getFrequencyColor,
  getVideoMetricColor,
  truncate,
} from "@/lib/format";
import { ExecutionButton } from "@/components/execution-button";
import { UnifiedActions, UnifiedActionsInline } from "@/components/unified-actions";
import { usePausedEntities } from "@/hooks/use-paused-entities";

type SortKey = keyof CreativeHealth;
type SortDir = "asc" | "desc";
type CreativeTab = "all" | "video" | "static";
type GoogleTab = "all" | "search" | "dg";

// ─── Smart Recommendation Engine ─────────────────────────────────
function getCreativeRecommendation(c: any, targetCpl: number): { text: string; actionType: string; severity: "high" | "medium" | "low" } | null {
  // Priority 1: Spend > ₹2000 with 0 leads → Pause immediately
  if ((c.spend || 0) > 2000 && (c.leads || 0) === 0) {
    return {
      text: "Pause immediately — ₹" + Math.round(c.spend) + " spent with 0 leads",
      actionType: "PAUSE_AD",
      severity: "high",
    };
  }

  // Priority 2: CPL > target × 1.3 → Consider pausing
  if ((c.cpl || 0) > targetCpl * 1.3 && (c.leads || 0) > 0) {
    return {
      text: "Consider pausing — CPL ₹" + Math.round(c.cpl) + " above threshold (₹" + Math.round(targetCpl * 1.3) + ")",
      actionType: "PAUSE_AD",
      severity: "high",
    };
  }

  // Priority 3: Frequency > 2.5 → Creative fatigue
  if ((c.frequency || 0) > 2.5) {
    return {
      text: "Creative fatigue — frequency " + (c.frequency?.toFixed(2) || "—") + ", refresh with new angle",
      actionType: "CREATIVE_REFRESH",
      severity: "medium",
    };
  }

  // Priority 4: TSR < 25% (video) → Improve hook
  if (c.is_video && (c.thumb_stop_pct || 0) > 0 && (c.thumb_stop_pct || 0) < 25) {
    return {
      text: "Improve hook — add motion/face in first 3s (TSR " + (c.thumb_stop_pct?.toFixed(1) || "0") + "%)",
      actionType: "CREATIVE_REFRESH",
      severity: "medium",
    };
  }

  // Priority 5: CTR declining + CPM stable → Sharpen CTA
  const hasCtrDecline = (c.health_signals || []).some((s: string) =>
    s.toLowerCase().includes("ctr") && (s.toLowerCase().includes("declin") || s.toLowerCase().includes("drop"))
  );
  if (hasCtrDecline) {
    return {
      text: "Sharpen CTA/offer — CTR declining while CPM stable",
      actionType: "CREATIVE_REFRESH",
      severity: "medium",
    };
  }

  // Priority 6: should_pause flag from analysis
  if (c.should_pause) {
    return {
      text: (c.auto_pause_reasons || []).join("; ") || "Agent recommends pausing",
      actionType: "PAUSE_AD",
      severity: "high",
    };
  }

  return null;
}

export default function CreativesPage() {
  const { analysisData: data, isLoadingAnalysis: isLoading, activePlatform, activeClient } = useClient();
  const { isPaused: isEntityPaused } = usePausedEntities();
  const isGoogle = activePlatform === "google";

  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [activeTab, setActiveTab] = useState<CreativeTab>("all");
  const [googleTab, setGoogleTab] = useState<GoogleTab>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Reset page when tab changes
  useEffect(() => { setPage(1); }, [activeTab, googleTab]);

  const targetCpl = activeClient?.targets?.[activePlatform]?.cpl || (data as any)?.dynamic_thresholds?.cpl_target || 800;

  const allCreatives = useMemo(() => {
    if (!data) return [];

    if (isGoogle) {
      const googleAds = (data as any)?.campaigns?.flatMap((c: any) =>
        c.ad_groups?.flatMap((ag: any) =>
          ag.ads?.map((ad: any) => ({
            ad_id: ad.id || ad.ad_id || `${c.id}-${ag.id}-${Math.random().toString(36).slice(2, 8)}`,
            ad_name: ad.name || ad.headline || `Ad ${ad.id || ""}`,
            campaign_name: c.name,
            adset_name: ag.name,
            spend: ad.cost || ad.spend || 0,
            impressions: ad.impressions || 0,
            clicks: ad.clicks || 0,
            ctr: ad.ctr || 0,
            cpc: ad.cpc || 0,
            cpm: ad.cpm || 0,
            frequency: 0,
            leads: ad.conversions || ad.leads || 0,
            cpl: ad.cost_per_conversion || ad.cpl || 0,
            is_video: ad.ad_type === "VIDEO" || (ad.type?.includes?.("VIDEO") ?? false),
            thumb_stop_pct: 0,
            hold_rate_pct: 0,
            first_frame_rate: 0,
            avg_watch_sec: 0,
            video_p25: ad.video_quartile_p25_rate ?? null,
            video_p50: ad.video_quartile_p50_rate ?? null,
            video_p75: ad.video_quartile_p75_rate ?? null,
            video_p100: ad.video_quartile_p100_rate ?? null,
            creative_age_days: ad.age_days ?? null,
            health_signals: ad.health_signals || [],
            creative_score: ad.score || ad.health_score || 0,
            scoring_type: "google",
            score_breakdown: ad.score_breakdown || {},
            score_bands: ad.score_bands || {},
            classification: ad.classification || "",
            should_pause: ad.should_pause || false,
            auto_pause_reasons: ad.auto_pause_reasons || [],
            status: ad.status || "",
            ad_strength: ad.ad_strength || null,
            campaign_type: c.campaign_type || "",
            headlines: ad.headlines || [],
            descriptions: ad.descriptions || [],
            ad_type_detail: ad.ad_type || ad.type || "RSA",
          })) || []
        ) || []
      ) || [];
      return googleAds;
    }

    return [...data.creative_health];
  }, [data, isGoogle]);

  const isDGCampaign = (c: any) => {
    const ct = (c.campaign_type || "").toLowerCase();
    return ct.includes("demand_gen") || ct.includes("video") || ct.includes("display");
  };

  const searchCount = allCreatives.filter((c: any) => !isDGCampaign(c)).length;
  const dgCount = allCreatives.filter((c: any) => isDGCampaign(c)).length;

  const filteredCreatives = useMemo(() => {
    let list = allCreatives;
    if (isGoogle) {
      if (googleTab === "search") list = list.filter((c: any) => !isDGCampaign(c));
      if (googleTab === "dg") list = list.filter((c: any) => isDGCampaign(c));
    } else {
      if (activeTab === "video") list = list.filter((c: any) => c.is_video);
      if (activeTab === "static") list = list.filter((c: any) => !c.is_video);
    }
    list.sort((a: any, b: any) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      return sortDir === "asc"
        ? String(aVal ?? "").localeCompare(String(bVal ?? ""))
        : String(bVal ?? "").localeCompare(String(aVal ?? ""));
    });
    return list;
  }, [allCreatives, sortKey, sortDir, activeTab, googleTab, isGoogle]);

  const videoCount = allCreatives.filter((c: any) => c.is_video).length;
  const staticCount = allCreatives.filter((c: any) => !c.is_video).length;

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 opacity-30" />;
    return sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  }

  if (isLoading || !data) {
    return (
      <div className="p-6">
        <Skeleton className="h-8 w-48 mb-4" />
        <Skeleton className="h-[500px] rounded-md" />
      </div>
    );
  }

  const thresholds = data.dynamic_thresholds;
  const showMetaVideoColumns = !isGoogle && activeTab !== "static";
  const hasDGAds = isGoogle && allCreatives.some((c: any) => c.campaign_type?.toLowerCase()?.includes("demand_gen") || c.campaign_type?.toLowerCase()?.includes("video") || c.is_video);

  const baseColumns: Array<{ key: SortKey; label: string; align: string }> = [
    { key: "ad_name", label: isGoogle ? "Ad Copy" : "Creative", align: "left" },
    ...(isGoogle ? [{ key: "campaign_type" as SortKey, label: "Type", align: "left" }] : []),
    { key: "campaign_name", label: "Campaign", align: "left" },
    { key: "classification", label: "Class", align: "left" },
    { key: "creative_score", label: "Health", align: "left" },
    { key: "spend", label: "Spend", align: "right" },
    { key: "impressions", label: "Impr.", align: "right" },
    { key: "clicks", label: "Clicks", align: "right" },
    { key: "ctr", label: "CTR", align: "right" },
    { key: "cpc", label: "CPC", align: "right" },
    { key: "cpm", label: "CPM", align: "right" },
    { key: "leads", label: "Leads", align: "right" },
    { key: "cpl", label: "CPL", align: "right" },
    ...(isGoogle
      ? [
          { key: "ad_strength" as SortKey, label: "Strength", align: "left" },
          { key: "creative_age_days" as SortKey, label: "Age(d)", align: "right" },
        ]
      : [
          { key: "frequency" as SortKey, label: "Freq", align: "right" },
          { key: "creative_age_days" as SortKey, label: "Age(d)", align: "right" },
        ]),
  ];

  const videoColumns: Array<{ key: SortKey; label: string; align: string }> = showMetaVideoColumns ? [
    { key: "thumb_stop_pct", label: "TSR%", align: "right" },
    { key: "hold_rate_pct", label: "VHR%", align: "right" },
    { key: "first_frame_rate", label: "FFR%", align: "right" },
    { key: "avg_watch_sec", label: "Avg Watch", align: "right" },
  ] : [];

  const googleVideoColumns: Array<{ key: SortKey; label: string; align: string }> = (isGoogle && hasDGAds) ? [
    { key: "video_p25" as SortKey, label: "P25%", align: "right" },
    { key: "video_p50" as SortKey, label: "P50%", align: "right" },
    { key: "video_p75" as SortKey, label: "P75%", align: "right" },
    { key: "video_p100" as SortKey, label: "P100%", align: "right" },
  ] : [];

  const columns = [...baseColumns, ...videoColumns, ...googleVideoColumns];
  const totalColSpan = columns.length + 3; // +3 for format badge, signals, and recommended action

  return (
    <div className="p-6 space-y-4 max-w-[1800px]">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-foreground">{isGoogle ? "Ad Copy & Creatives" : "Creatives"}</h1>
          <p className="text-xs text-muted-foreground">
            {allCreatives.length} creatives · {videoCount} video · {staticCount} static
          </p>
        </div>
      </div>

      {/* Tab navigation: All | Video | Static (Meta only) */}
      {!isGoogle && (
      <div className="flex items-center gap-1 border-b border-border/50 pb-0">
        {([
          { key: "all" as CreativeTab, label: "All", count: allCreatives.length },
          { key: "video" as CreativeTab, label: "Video", count: videoCount },
          { key: "static" as CreativeTab, label: "Static", count: staticCount },
        ]).map((tab) => (
          <button
            key={tab.key}
            className={`px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab(tab.key)}
            data-testid={`tab-creatives-${tab.key}`}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>
      )}

      {/* Tab navigation: Search RSAs | DG Creatives | All (Google only) */}
      {isGoogle && (
      <div className="flex items-center gap-1 border-b border-border/50 pb-0">
        {([
          { key: "all" as GoogleTab, label: "All", count: allCreatives.length },
          { key: "search" as GoogleTab, label: "Search RSAs", count: searchCount },
          { key: "dg" as GoogleTab, label: "DG Creatives", count: dgCount },
        ]).map((tab) => (
          <button
            key={tab.key}
            className={`px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
              googleTab === tab.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setGoogleTab(tab.key)}
            data-testid={`tab-google-${tab.key}`}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>
      )}

      {/* GCR-04: Ad Extensions summary card (Google only) */}
      {isGoogle && (() => {
        const extensions = (data as any)?.ad_extensions || (data as any)?.extensions;
        if (!extensions) {
          return (
            <div className="text-xs text-muted-foreground px-1 py-2 italic">
              Ad extensions data will be available after next agent run
            </div>
          );
        }
        const extTypes = [
          { key: "sitelinks", label: "Sitelinks" },
          { key: "callouts", label: "Callouts" },
          { key: "structured_snippets", label: "Structured Snippets" },
        ];
        const hasAny = extTypes.some(({ key }) => extensions[key]);
        if (!hasAny) {
          return (
            <div className="text-xs text-muted-foreground px-1 py-2 italic">
              Ad extensions data will be available after next agent run
            </div>
          );
        }
        return (
          <div className="flex flex-wrap gap-3">
            {extTypes.map(({ key, label }) => {
              const ext = extensions[key];
              if (!ext) return null;
              const count = ext.count ?? (Array.isArray(ext) ? ext.length : 0);
              const active = ext.active ?? (Array.isArray(ext) ? ext.filter((e: any) => e.status === "ACTIVE" || e.enabled).length : null);
              return (
                <Card key={key} className="border border-border/50 min-w-[150px]">
                  <CardContent className="p-3">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
                    <p className="text-sm font-semibold tabular-nums text-foreground">{count} total</p>
                    {active != null && (
                      <p className="text-[10px] text-emerald-400">{active} active</p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        );
      })()}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/50">
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      className={`p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground cursor-pointer select-none whitespace-nowrap ${
                        col.align === "right" ? "text-right" : "text-left"
                      }`}
                      onClick={() => toggleSort(col.key)}
                    >
                      <span className="inline-flex items-center gap-1">
                        {col.label}
                        <SortIcon col={col.key} />
                      </span>
                    </th>
                  ))}
                  <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground text-left min-w-[180px]">Signals</th>
                  <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground text-left min-w-[240px]">Recommended Action</th>
                  <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(pageSize >= filteredCreatives.length ? filteredCreatives : filteredCreatives.slice((page - 1) * pageSize, page * pageSize)).map((c: any) => {
                  const classColor = getClassificationColor(c.classification);
                  const isExpanded = expandedId === c.ad_id;
                  const isPaused = isEntityPaused(c.ad_id);
                  const recommendation = getCreativeRecommendation(c, targetCpl);

                  return (
                    <>
                    <tr
                      key={c.ad_id}
                      className={`border-b border-border/30 hover:bg-muted/30 transition-colors cursor-pointer ${
                        c.should_pause ? "border-l-2 border-l-red-500" : ""
                      } ${isPaused ? "opacity-50" : ""}`}
                      onClick={() => setExpandedId(isExpanded ? null : c.ad_id)}
                      data-testid={`row-creative-${c.ad_id}`}
                    >
                      {/* Creative name + Video/Static badge */}
                      <td className="p-3 max-w-[180px]">
                        <div className="flex items-center gap-1.5">
                          {/* Format badge: Video or Static */}
                          {c.is_video ? (
                            <Badge variant="secondary" className="text-[9px] px-1 py-0 text-blue-400 bg-blue-500/10 shrink-0">
                              <Video className="w-2.5 h-2.5 mr-0.5 inline" />Video
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[9px] px-1 py-0 text-muted-foreground bg-muted/50 shrink-0">
                              <Image className="w-2.5 h-2.5 mr-0.5 inline" />Static
                            </Badge>
                          )}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="truncate block cursor-default text-foreground">
                                {truncate(c.ad_name, 24)}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              <p className="text-xs max-w-xs">{c.ad_name}</p>
                            </TooltipContent>
                          </Tooltip>
                          {isPaused && (
                            <Badge variant="secondary" className="text-[9px] px-1 py-0 text-red-400 shrink-0">PAUSED</Badge>
                          )}
                        </div>
                        {c.should_pause && (
                          <div className="mt-1">
                            <Badge variant="destructive" className="text-[9px] px-1 py-0">
                              Recommended: Pause
                            </Badge>
                          </div>
                        )}
                      </td>
                      {/* Type (Google only) */}
                      {isGoogle && (
                        <td className="p-3">
                          {(() => {
                            const ct = (c as any).campaign_type?.toUpperCase?.() || "";
                            const isDG = ct.includes("DEMAND_GEN") || ct.includes("VIDEO") || ct.includes("DISPLAY");
                            const typeLabel = isDG ? "DEMAND_GEN" : "SEARCH";
                            const typeColor = isDG
                              ? "text-amber-400 bg-amber-500/10"
                              : "text-blue-400 bg-blue-500/10";
                            return (
                              <Badge variant="secondary" className={`text-[9px] px-1.5 py-0 ${typeColor}`}>
                                {typeLabel}
                              </Badge>
                            );
                          })()}
                        </td>
                      )}
                      {/* Campaign */}
                      <td className="p-3 max-w-[140px]">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="truncate block cursor-default text-muted-foreground">
                              {truncate(c.campaign_name, 22)}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            <p className="text-xs max-w-sm">{c.campaign_name}</p>
                          </TooltipContent>
                        </Tooltip>
                      </td>
                      {/* Classification */}
                      <td className="p-3">
                        <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${classColor.bg} ${classColor.text}`}>
                          {c.classification}
                        </span>
                      </td>
                      {/* Health Score */}
                      <td className="p-3">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-2">
                              <div className={`w-12 h-1.5 rounded-full ${getHealthBarBg(c.creative_score)}`}>
                                <div
                                  className={`h-full rounded-full ${getHealthBgColor(c.creative_score)}`}
                                  style={{ width: `${c.creative_score}%` }}
                                />
                              </div>
                              <span className="tabular-nums text-muted-foreground w-6">{c.creative_score}</span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs">
                            <div className="text-xs space-y-1">
                              <p className="font-medium">Score Breakdown</p>
                              {c.score_breakdown && Object.entries(c.score_breakdown).map(([k, v]: [string, any]) => (
                                <div key={k} className="flex items-center justify-between gap-3">
                                  <span className="text-muted-foreground capitalize">{k.replace(/_/g, " ")}</span>
                                  <span className="tabular-nums font-medium">{typeof v === "number" ? v.toFixed(1) : String(v)}</span>
                                </div>
                              ))}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </td>
                      {/* Spend */}
                      <td className="p-3 text-right tabular-nums">{formatINR(c.spend, 0)}</td>
                      {/* Impressions */}
                      <td className="p-3 text-right tabular-nums">{formatNumber(c.impressions)}</td>
                      {/* Clicks */}
                      <td className="p-3 text-right tabular-nums">{formatNumber(c.clicks)}</td>
                      {/* CTR */}
                      <td className={`p-3 text-right tabular-nums ${getCtrColor(c.ctr)}`}>
                        {formatPct(c.ctr)}
                      </td>
                      {/* CPC */}
                      <td className="p-3 text-right tabular-nums">{formatINR(c.cpc, 2)}</td>
                      {/* CPM */}
                      <td className="p-3 text-right tabular-nums">{formatINR(c.cpm, 0)}</td>
                      {/* Leads */}
                      <td className="p-3 text-right tabular-nums">{c.leads}</td>
                      {/* CPL */}
                      <td className={`p-3 text-right tabular-nums ${c.cpl > 0 ? getCplColor(c.cpl, thresholds) : "text-foreground"}`}>
                        {c.cpl > 0 ? formatINR(c.cpl, 0) : "—"}
                      </td>
                      {/* Frequency / Ad Strength (platform-conditional) */}
                      {isGoogle ? (
                        <>
                          <td className="p-3">
                            {(c as any).ad_strength ? (
                              <Badge variant="secondary" className={`text-[10px] ${
                                (c as any).ad_strength === "EXCELLENT" ? "text-emerald-400 bg-emerald-500/10" :
                                (c as any).ad_strength === "GOOD" ? "text-blue-400 bg-blue-500/10" :
                                (c as any).ad_strength === "AVERAGE" ? "text-amber-400 bg-amber-500/10" :
                                "text-red-400 bg-red-500/10"
                              }`}>
                                {(c as any).ad_strength}
                              </Badge>
                            ) : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className={`p-3 text-right tabular-nums ${(c.creative_age_days ?? 0) > 45 ? "text-red-400" : (c.creative_age_days ?? 0) > 30 ? "text-amber-400" : "text-foreground"}`}>
                            {c.creative_age_days != null ? c.creative_age_days : "—"}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className={`p-3 text-right tabular-nums ${getFrequencyColor(c.frequency)}`}>
                            {c.frequency?.toFixed?.(2) ?? "—"}
                          </td>
                          <td className={`p-3 text-right tabular-nums ${(c.creative_age_days ?? 0) > 45 ? "text-red-400" : (c.creative_age_days ?? 0) > 30 ? "text-amber-400" : "text-foreground"}`}>
                            {c.creative_age_days != null ? c.creative_age_days : "—"}
                          </td>
                        </>
                      )}
                      {/* Meta Video metrics */}
                      {showMetaVideoColumns && (
                        <>
                          <td className={`p-3 text-right tabular-nums ${c.is_video ? getVideoMetricColor("tsr", c.thumb_stop_pct) : "text-muted-foreground"}`}>
                            {c.is_video && c.thumb_stop_pct ? `${c.thumb_stop_pct.toFixed(1)}%` : "—"}
                          </td>
                          <td className={`p-3 text-right tabular-nums ${c.is_video ? getVideoMetricColor("vhr", c.hold_rate_pct) : "text-muted-foreground"}`}>
                            {c.is_video && c.hold_rate_pct ? `${c.hold_rate_pct.toFixed(1)}%` : "—"}
                          </td>
                          <td className={`p-3 text-right tabular-nums ${c.is_video ? getVideoMetricColor("ffr", c.first_frame_rate) : "text-muted-foreground"}`}>
                            {c.is_video && c.first_frame_rate ? `${c.first_frame_rate.toFixed(1)}%` : "—"}
                          </td>
                          <td className="p-3 text-right tabular-nums text-muted-foreground">
                            {c.is_video && c.avg_watch_sec ? `${c.avg_watch_sec.toFixed(1)}s` : "—"}
                          </td>
                        </>
                      )}
                      {/* Google DG video quartile columns */}
                      {isGoogle && hasDGAds && (
                        <>
                          <td className="p-3 text-right tabular-nums text-muted-foreground">
                            {(c as any).video_p25 != null ? `${((c as any).video_p25 * 100).toFixed(1)}%` : "—"}
                          </td>
                          <td className="p-3 text-right tabular-nums text-muted-foreground">
                            {(c as any).video_p50 != null ? `${((c as any).video_p50 * 100).toFixed(1)}%` : "—"}
                          </td>
                          <td className="p-3 text-right tabular-nums text-muted-foreground">
                            {(c as any).video_p75 != null ? `${((c as any).video_p75 * 100).toFixed(1)}%` : "—"}
                          </td>
                          <td className="p-3 text-right tabular-nums text-muted-foreground">
                            {(c as any).video_p100 != null ? `${((c as any).video_p100 * 100).toFixed(1)}%` : "—"}
                          </td>
                        </>
                      )}
                      {/* Health signals — wider with tooltip for full text */}
                      <td className="p-3 min-w-[180px] max-w-[220px]">
                        {c.health_signals.length > 0 ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex flex-wrap gap-1 cursor-default">
                                {c.health_signals.slice(0, 3).map((s: any, i: number) => (
                                  <Badge key={i} variant="secondary" className="text-[9px] px-1 py-0 whitespace-nowrap">
                                    {truncate(s, 25)}
                                  </Badge>
                                ))}
                                {c.health_signals.length > 3 && (
                                  <Badge variant="secondary" className="text-[9px] px-1 py-0 cursor-default">
                                    +{c.health_signals.length - 3}
                                  </Badge>
                                )}
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="left" className="max-w-sm">
                              <ul className="text-xs space-y-1">
                                {c.health_signals.map((s: any, i: number) => (
                                  <li key={i} className="text-foreground">{s}</li>
                                ))}
                              </ul>
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="text-[10px] text-emerald-400">Healthy</span>
                        )}
                      </td>
                      {/* Recommended Action */}
                      <td className="p-3 min-w-[240px]" onClick={(e) => e.stopPropagation()}>
                        {recommendation ? (
                          <div className="space-y-1.5">
                            <p className={`text-[10px] leading-relaxed ${
                              recommendation.severity === "high" ? "text-red-400" :
                              recommendation.severity === "medium" ? "text-amber-400" :
                              "text-muted-foreground"
                            }`}>
                              {recommendation.text}
                            </p>
                            <UnifiedActionsInline
                              entityId={c.ad_id}
                              entityName={c.ad_name}
                              entityType="ad"
                              actionType={recommendation.actionType}
                              isAutoExecutable={recommendation.actionType === "PAUSE_AD"}
                              recommendation={recommendation.text}
                              currentMetrics={{ spend: c.spend, leads: c.leads, cpl: c.cpl, ctr: c.ctr }}
                            />
                          </div>
                        ) : (
                          <span className="text-[10px] text-emerald-400">No action needed</span>
                        )}
                      </td>
                      {/* Actions */}
                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1 justify-center">
                          {!isPaused ? (
                            <ExecutionButton
                              action="PAUSE_AD"
                              entityId={c.ad_id}
                              entityName={c.ad_name}
                              entityType="ad"
                              label=""
                              variant={c.should_pause ? "destructive" : "ghost"}
                              size="icon"
                              icon={<Pause className="w-3.5 h-3.5" />}
                              confirmMessage={`Pause ad "${c.ad_name}"?${c.auto_pause_reasons?.length ? `\n\nReasons: ${c.auto_pause_reasons.join(", ")}` : ""}`}
                              params={{ reason: c.should_pause ? c.auto_pause_reasons?.join("; ") : `Manual pause from ${isGoogle ? "Ad Copy" : "Creatives"} page` }}
                              className="h-7 w-7"
                              data-testid={`button-pause-ad-${c.ad_id}`}
                            />
                          ) : (
                            <ExecutionButton
                              action={isGoogle ? "ENABLE_AD" : "UNPAUSE_AD"}
                              entityId={c.ad_id}
                              entityName={c.ad_name}
                              entityType="ad"
                              label=""
                              variant="ghost"
                              size="icon"
                              icon={<Play className="w-3.5 h-3.5 text-emerald-400" />}
                              confirmMessage={`Activate ad "${c.ad_name}"?`}
                              params={{ reason: `Manual activation from ${isGoogle ? "Ad Copy" : "Creatives"} page` }}
                              className="h-7 w-7"
                              data-testid={`button-activate-ad-${c.ad_id}`}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                    {/* Expanded score breakdown row */}
                    {isExpanded && (
                      <tr key={`${c.ad_id}-expanded`} className="border-b border-border/30 bg-muted/20">
                        <td colSpan={totalColSpan} className="p-4">
                          <div className="space-y-4">
                            {/* Score breakdown (all platforms) */}
                            {c.score_breakdown && Object.keys(c.score_breakdown).length > 0 && (
                              <div className="space-y-3">
                                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                                  Creative Score Breakdown — {c.ad_name}
                                </p>
                                <div className="flex flex-wrap gap-3">
                                  {Object.entries(c.score_breakdown).map(([metric, score]: [string, any]) => {
                                    const band = (c.score_bands as Record<string, string>)?.[metric] || "unknown";
                                    const bandUpper = band.toUpperCase();
                                    const bandColor =
                                      bandUpper === "EXCELLENT" || bandUpper === "GOOD" ? "text-emerald-400 bg-emerald-500/10" :
                                      bandUpper === "WATCH" ? "text-amber-400 bg-amber-500/10" :
                                      bandUpper === "POOR" ? "text-red-400 bg-red-500/10" :
                                      "text-muted-foreground bg-muted/50";
                                    return (
                                      <div key={metric} className="flex items-center gap-2 p-2 rounded-md bg-card border border-border/30 min-w-[140px]">
                                        <div className="flex-1">
                                          <p className="text-[10px] text-muted-foreground capitalize">{metric.replace(/_/g, " ")}</p>
                                          <p className="text-sm font-semibold tabular-nums text-foreground">{typeof score === "number" ? score.toFixed(1) : String(score)}</p>
                                        </div>
                                        <Badge variant="secondary" className={`text-[9px] ${bandColor}`}>
                                          {bandUpper}
                                        </Badge>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* GCR-02: Search RSA Headlines & Descriptions */}
                            {isGoogle && !isDGCampaign(c) && ((c as any).headlines?.length > 0 || (c as any).descriptions?.length > 0) && (
                              <div className="space-y-3">
                                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                                  RSA Assets — {(c as any).ad_type_detail || "RSA"}
                                </p>
                                <div className="flex flex-wrap gap-6">
                                  {(c as any).headlines?.length > 0 && (
                                    <div className="min-w-[260px]">
                                      <p className="text-[10px] font-medium text-muted-foreground mb-2 uppercase tracking-wider">Headlines</p>
                                      <ul className="space-y-1">
                                        {(c as any).headlines.map((h: any, i: number) => {
                                          const text = typeof h === "string" ? h : h.text || h.asset || String(h);
                                          const perf = typeof h === "object" ? (h.performance_label || h.performance || "") : "";
                                          const perfUpper = perf.toUpperCase();
                                          const perfColor =
                                            perfUpper === "BEST" ? "text-emerald-400 bg-emerald-500/10" :
                                            perfUpper === "GOOD" ? "text-blue-400 bg-blue-500/10" :
                                            perfUpper === "LOW" ? "text-red-400 bg-red-500/10" :
                                            "text-muted-foreground bg-muted/50";
                                          return (
                                            <li key={i} className="flex items-center gap-2">
                                              <span className="text-xs text-foreground">{text}</span>
                                              {perfUpper && (
                                                <Badge variant="secondary" className={`text-[9px] px-1 py-0 shrink-0 ${perfColor}`}>
                                                  {perfUpper}
                                                </Badge>
                                              )}
                                            </li>
                                          );
                                        })}
                                      </ul>
                                    </div>
                                  )}
                                  {(c as any).descriptions?.length > 0 && (
                                    <div className="min-w-[260px]">
                                      <p className="text-[10px] font-medium text-muted-foreground mb-2 uppercase tracking-wider">Descriptions</p>
                                      <ul className="space-y-1">
                                        {(c as any).descriptions.map((d: any, i: number) => {
                                          const text = typeof d === "string" ? d : d.text || d.asset || String(d);
                                          const perf = typeof d === "object" ? (d.performance_label || d.performance || "") : "";
                                          const perfUpper = perf.toUpperCase();
                                          const perfColor =
                                            perfUpper === "BEST" ? "text-emerald-400 bg-emerald-500/10" :
                                            perfUpper === "GOOD" ? "text-blue-400 bg-blue-500/10" :
                                            perfUpper === "LOW" ? "text-red-400 bg-red-500/10" :
                                            "text-muted-foreground bg-muted/50";
                                          return (
                                            <li key={i} className="flex items-center gap-2">
                                              <span className="text-xs text-foreground">{text}</span>
                                              {perfUpper && (
                                                <Badge variant="secondary" className={`text-[9px] px-1 py-0 shrink-0 ${perfColor}`}>
                                                  {perfUpper}
                                                </Badge>
                                              )}
                                            </li>
                                          );
                                        })}
                                      </ul>
                                    </div>
                                  )}
                                </div>
                                <p className="text-[10px] text-amber-400 italic">
                                  Consider replacing bottom 25% performing assets per SOP
                                </p>
                              </div>
                            )}

                            {/* GCR-03: DG Video Quartile Funnel */}
                            {isGoogle && isDGCampaign(c) && (
                              (c as any).video_p25 != null ||
                              (c as any).video_p50 != null ||
                              (c as any).video_p75 != null ||
                              (c as any).video_p100 != null
                            ) && (
                              <div className="space-y-2">
                                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                                  Video Quartile Funnel
                                </p>
                                <div className="space-y-1.5 max-w-[360px]">
                                  {([
                                    { label: "P25", value: (c as any).video_p25 },
                                    { label: "P50", value: (c as any).video_p50 },
                                    { label: "P75", value: (c as any).video_p75 },
                                    { label: "P100", value: (c as any).video_p100 },
                                  ] as Array<{ label: string; value: number | null }>).map(({ label, value }) => {
                                    const pct = value != null ? value * 100 : null;
                                    const barColor =
                                      pct == null ? "bg-muted" :
                                      pct > 20 ? "bg-emerald-500" :
                                      pct >= 10 ? "bg-amber-500" :
                                      "bg-red-500";
                                    return (
                                      <div key={label} className="flex items-center gap-2">
                                        <span className="text-[10px] text-muted-foreground w-8 shrink-0">{label}</span>
                                        <div className="flex-1 h-3 bg-muted/40 rounded-full overflow-hidden">
                                          <div
                                            className={`h-full rounded-full ${barColor} transition-all`}
                                            style={{ width: pct != null ? `${Math.min(pct, 100)}%` : "0%" }}
                                          />
                                        </div>
                                        <span className="text-[10px] tabular-nums text-foreground w-10 text-right">
                                          {pct != null ? `${pct.toFixed(1)}%` : "—"}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* GCR-05: Creative Refresh note */}
                            {isGoogle && (() => {
                              const age = c.creative_age_days;
                              if (age == null) return null;
                              const isDG = isDGCampaign(c);
                              const threshold = isDG ? 21 : 40;
                              if (age <= threshold) return null;
                              const hasCtrDecline = (c.health_signals || []).some((s: string) => {
                                const lower = s.toLowerCase();
                                return lower.includes("ctr") && (lower.includes("declin") || lower.includes("drop"));
                              });
                              return (
                                <div className="space-y-1 p-2 rounded-md bg-amber-500/5 border border-amber-500/20">
                                  <p className="text-[10px] text-amber-400">
                                    {isDG
                                      ? `Creative is ${age} days old. SOP recommends refreshing DG creatives every 21-40 days.`
                                      : `RSA is ${age} days old. SOP recommends asset refresh every 21-40 days.`}
                                  </p>
                                  {hasCtrDecline && (
                                    <p className="text-[10px] text-red-400 font-medium">
                                      CTR decline detected — prioritize refresh
                                    </p>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        </td>
                      </tr>
                    )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
          <DataTablePagination
            totalItems={filteredCreatives.length}
            pageSize={pageSize}
            currentPage={page}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </CardContent>
      </Card>
    </div>
  );
}
