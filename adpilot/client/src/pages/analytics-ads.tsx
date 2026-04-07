import { useState, useMemo, useEffect, Fragment } from "react";
import { useClient } from "@/lib/client-context";
import { DataTablePagination } from "@/components/data-table-pagination";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Info,
  SlidersHorizontal,
  BarChart3,
} from "lucide-react";
import {
  formatINR,
  formatPct,
  formatNumber,
  getHealthBgColor,
  getHealthBarBg,
  getClassificationColor,
  getCplColor,
  getCtrColor,
  truncate,
} from "@/lib/format";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

// ─── Types ──────────────────────────────────────────────────────────

type AdsPanelCreative = {
  id: string;
  name: string;
  campaignName: string;
  adsetName: string;
  isVideo: boolean;
  status: string;
  classification: string;
  health_score: number;
  spend: number;
  impressions: number;
  leads: number;
  ctr: number;
  cpl: number;
  tsr?: number;
  vhr?: number;
  cpm?: number;
  cpc?: number;
  frequency?: number;
  score_breakdown?: Record<string, number>;
  score_bands?: Record<string, string>;
};

type SortKey = keyof AdsPanelCreative;
type SortDir = "asc" | "desc";

// ─── Health score methodology tooltip ───────────────────────────────
function HealthMethodology() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="w-3 h-3 text-muted-foreground cursor-help inline-block ml-1" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <div className="text-xs space-y-1">
          <p className="font-medium">Creative Health Scoring</p>
          <p>Calculated based on CPL vs target, CTR performance, and engagement metrics (TSR/Hold Rate for videos).</p>
          <p className="text-muted-foreground">Winners are scaled, while underperformers are flagged for replacement.</p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export default function AnalyticsAdsPage() {
  const { analysisData: data, isLoadingAnalysis: isLoading, activePlatform, benchmarks } = useClient();
  const isGoogle = activePlatform === "google";

  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filterType, setFilterType] = useState<string>("ALL");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [filterClassification, setFilterClassification] = useState<string>("ALL");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [columnSize, setColumnSize] = useState<"compact" | "normal" | "wide">("normal");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const creatives = useMemo<AdsPanelCreative[]>(() => {
    if (!data) return [];

    let list: any[] = [];
    const source = (data as any).creative_health || [];
    
    if (source.length > 0) {
      list = source.map((c: any) => ({
        id: c.ad_id || c.id || c.ad_name,
        name: c.ad_name || c.name || "Untitled Ad",
        campaignName: c.campaign_name || "Unassigned Campaign",
        adsetName: c.adset_name || c.ad_group_name || "Unassigned Group",
        isVideo: !!c.is_video,
        status: (c.status || "ACTIVE").toUpperCase(),
        classification: c.classification || "WATCH",
        health_score: c.creative_score || c.health_score || 0,
        spend: c.spend || 0,
        impressions: c.impressions || 0,
        leads: c.leads || 0,
        ctr: c.ctr || 0,
        cpl: c.cpl || 0,
        tsr: (c.thumb_stop_pct !== undefined ? c.thumb_stop_pct * 100 : c.tsr) || 0,
        vhr: (c.hold_rate_pct !== undefined ? c.hold_rate_pct * 100 : c.vhr) || 0,
        cpm: c.cpm,
        cpc: c.cpc,
        frequency: c.frequency,
        score_breakdown: c.score_breakdown,
        score_bands: c.score_bands
      }));
    } else {
      // Fallback extraction
      const campaigns = ((data as any).campaign_audit || (data as any).campaigns || []) as any[];
      campaigns.forEach((campaign) => {
        const groups = campaign.ad_sets || campaign.ad_groups || [];
        groups.forEach((group: any) => {
          (group.ads || []).forEach((ad: any) => {
             list.push({
                id: ad.id || ad.ad_id || `${campaign.campaign_name}-${group.name}-${ad.name}`,
                name: ad.name || ad.headline || "Untitled Ad",
                campaignName: campaign.campaign_name || "Unassigned Campaign",
                adsetName: group.name || "Unassigned Group",
                isVideo: ad.is_video || ad.ad_type === "VIDEO",
                status: (ad.status || "ACTIVE").toUpperCase(),
                classification: ad.classification || "WATCH",
                health_score: ad.creative_score || ad.health_score || 0,
                spend: ad.spend || ad.cost || 0,
                impressions: ad.impressions || 0,
                leads: ad.leads || ad.conversions || 0,
                ctr: ad.ctr || 0,
                cpl: ad.cpl || 0,
                tsr: (ad.thumb_stop_pct !== undefined ? ad.thumb_stop_pct * 100 : ad.tsr) || 0,
                vhr: (ad.hold_rate_pct !== undefined ? ad.hold_rate_pct * 100 : ad.vhr) || 0,
                cpm: ad.cpm || ad.avg_cpm,
                cpc: ad.cpc,
                frequency: ad.frequency,
                score_breakdown: ad.score_breakdown,
                score_bands: ad.score_bands
             });
          });
        });
      });
    }

    // Filtering
    if (filterType !== "ALL") {
      const wantVideo = filterType === "VIDEO";
      list = list.filter(c => c.isVideo === wantVideo);
    }
    if (filterStatus !== "ALL") {
      list = list.filter(c => c.status === filterStatus);
    }
    if (filterClassification !== "ALL") {
      list = list.filter(c => c.classification === filterClassification);
    }

    // Sorting
    list.sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      return sortDir === "asc" ? String(aVal).localeCompare(String(bVal)) : String(bVal).localeCompare(String(aVal));
    });

    return list;
  }, [data, filterType, filterStatus, filterClassification, sortKey, sortDir]);

  useEffect(() => { setPage(1); }, [filterType, filterStatus, filterClassification]);

  const paginatedCreatives = useMemo(() => {
    return creatives.slice((page - 1) * pageSize, page * pageSize);
  }, [creatives, page, pageSize]);

  const formatCPM = (val: any) => {
    if (val === undefined || val === null || val === 0) return "—";
    const num = Number(val);
    if (isNaN(num)) return "—";
    return formatINR(num, 0);
  };

  const totalSpend = useMemo(() => creatives.reduce((sum, c) => sum + c.spend, 0), [creatives]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
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

  const columns = [
    { key: "name" as SortKey, label: "Creative", align: "left" },
    { key: "isVideo" as SortKey, label: "Type", align: "left" },
    { key: "classification" as SortKey, label: "Class", align: "left" },
    { key: "health_score" as SortKey, label: "Health", align: "left" },
    { key: "spend" as SortKey, label: "Spend", align: "right" },
    { key: "leads" as SortKey, label: "Leads", align: "right" },
    { key: "cpl" as SortKey, label: "CPL", align: "right" },
    { key: "ctr" as SortKey, label: "CTR", align: "right" },
    { key: "tsr" as SortKey, label: "TSR", align: "right" },
    { key: "vhr" as SortKey, label: "VHR", align: "right" },
    { key: "cpm" as SortKey, label: "CPM", align: "right" },
  ];

  return (
    <div className="p-6 space-y-4 max-w-[1800px]">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-bold text-foreground">Ads Panel</h1>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {creatives.length} creatives · {formatINR(totalSpend, 0)} total spend in current view
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            className="px-2 py-1.5 text-xs rounded-md bg-muted/50 border border-border/50 text-foreground"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
          >
            <option value="ALL">All Mixed</option>
            <option value="VIDEO">Videos Only</option>
            <option value="STATIC">Statics Only</option>
          </select>
          <select
            className="px-2 py-1.5 text-xs rounded-md bg-muted/50 border border-border/50 text-foreground"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="ALL">All Status</option>
            <option value="ACTIVE">Active</option>
            <option value="PAUSED">Paused</option>
          </select>
          <select
            className="px-2 py-1.5 text-xs rounded-md bg-muted/50 border border-border/50 text-foreground"
            value={filterClassification}
            onChange={(e) => setFilterClassification(e.target.value)}
          >
            <option value="ALL">All Classifications</option>
            <option value="WINNER">Winner</option>
            <option value="WATCH">Watch</option>
            <option value="UNDERPERFORMER">Underperformer</option>
          </select>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="p-3 w-8">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-4 w-4 opacity-50 hover:opacity-100">
                           <SlidersHorizontal className="h-3 w-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem onClick={() => setColumnSize("compact")}>Compact Width</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setColumnSize("normal")}>Normal Width</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setColumnSize("wide")}>Wide Width</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </th>
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
                        {col.label === "Health" && <HealthMethodology />}
                        <SortIcon col={col.key} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginatedCreatives.map((c) => {
                  const classColor = getClassificationColor(c.classification);
                  const isPaused = c.status === "PAUSED";
                  const isExpanded = expandedIds.has(c.id);

                  return (
                    <Fragment key={c.id}>
                      <tr
                        className={`border-b border-border/30 hover:bg-muted/30 transition-colors cursor-pointer ${isPaused ? "opacity-50" : ""} ${c.classification === "LOSER" || c.classification === "UNDERPERFORMER" ? "border-l-2 border-l-red-500" : ""}`}
                        onClick={() => {
                          setExpandedIds(prev => {
                            const next = new Set(prev);
                            if (next.has(c.id)) next.delete(c.id);
                            else next.add(c.id);
                            return next;
                          });
                        }}
                      >
                        <td className="p-3 w-8">
                           {isExpanded ? (
                             <ChevronUp className="h-4 w-4 text-muted-foreground/50" />
                           ) : (
                             <ChevronDown className="h-4 w-4 text-muted-foreground/20" />
                           )}
                        </td>
                        <td className="p-3 max-w-[250px]">
                          <div className="font-medium text-foreground truncate">{c.name}</div>
                          <div className="text-[10px] text-muted-foreground uppercase tracking-tight truncate mt-0.5">
                            {c.campaignName} · {c.adsetName}
                          </div>
                        </td>
                        <td className="p-3">
                           <Badge variant={c.isVideo ? "default" : "secondary"} className="text-[9px] px-1 py-0 uppercase">
                              {c.isVideo ? "Video" : "Static"}
                           </Badge>
                        </td>
                        <td className="p-3">
                          <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${classColor.bg} ${classColor.text}`}>
                            {c.classification}
                          </span>
                        </td>
                        <td className="p-3">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex items-center gap-2">
                                <div className={`w-14 h-1.5 rounded-full ${getHealthBarBg(c.health_score)}`}>
                                  <div className={`h-full rounded-full ${getHealthBgColor(c.health_score)}`} style={{ width: `${Math.min(c.health_score || 0, 100)}%` }} />
                                </div>
                                <span className="tabular-nums text-muted-foreground w-6">{Math.round(c.health_score)}</span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs p-3">
                                <div className="text-xs space-y-1.5">
                                  <p className="font-bold border-b border-border/50 pb-1.5">Score Breakdown</p>
                                  {c.score_breakdown ? (
                                    Object.entries(c.score_breakdown).map(([k, v]) => {
                                      let band = (c.score_bands?.[k] || "UNKNOWN").toUpperCase();
                                      if (band === "UNKNOWN" && typeof v === "number") {
                                        if (v >= 85) band = "EXCELLENT";
                                        else if (v >= 70) band = "GOOD";
                                        else if (v >= 40) band = "WATCH";
                                        else band = "POOR";
                                      }

                                      const bColor = 
                                        band === "EXCELLENT" ? "text-emerald-400" :
                                        band === "GOOD" ? "text-emerald-400" :
                                        band === "WATCH" ? "text-amber-400" :
                                        band === "POOR" ? "text-red-400" : 
                                        "text-muted-foreground";

                                      return (
                                        <div key={k} className="flex justify-between gap-4">
                                          <span className="uppercase text-muted-foreground">{k.replace(/_/g, ' ')}</span>
                                          <div className="flex items-center gap-1.5">
                                            <span className={`text-[9px] font-bold ${bColor}`}>{band}</span>
                                            <span className="font-bold tabular-nums">{Math.round(Number(v))}</span>
                                          </div>
                                        </div>
                                      );
                                    })
                                  ) : (
                                    <p className="text-muted-foreground italic">Breakdown data unavailable</p>
                                  )}
                                </div>
                            </TooltipContent>
                          </Tooltip>
                        </td>
                        <td className="p-3 text-right tabular-nums">{formatINR(c.spend, 0)}</td>
                        <td className="p-3 text-right tabular-nums">{formatNumber(c.leads)}</td>
                        <td className={`p-3 text-right tabular-nums ${getCplColor(c.cpl, data.dynamic_thresholds)}`}>
                          {c.cpl > 0 ? formatINR(c.cpl, 0) : "—"}
                        </td>
                        <td className={`p-3 text-right tabular-nums ${getCtrColor(c.ctr)}`}>
                          {formatPct(c.ctr)}
                        </td>
                        <td className="p-3 text-right tabular-nums text-amber-400">
                           {c.isVideo && c.tsr !== undefined ? formatPct(c.tsr) : "—"}
                        </td>
                        <td className="p-3 text-right tabular-nums text-emerald-400">
                           {c.isVideo && c.vhr !== undefined ? formatPct(c.vhr) : "—"}
                        </td>
                        <td className="p-3 text-right tabular-nums">
                           {formatCPM(c.cpm)}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="border-b border-border/30 bg-muted/20">
                          <td colSpan={12} className="p-4">
                            <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
                               <div className="p-2.5 rounded-lg bg-card border border-border/50">
                                  <p className="text-[10px] uppercase font-bold text-muted-foreground">Impressions</p>
                                  <p className="text-lg font-extrabold tabular-nums mt-0.5">{formatNumber(c.impressions)}</p>
                               </div>
                               <div className="p-2.5 rounded-lg bg-card border border-border/50">
                                  <p className="text-[10px] uppercase font-bold text-muted-foreground">Clicks</p>
                                  <p className="text-lg font-extrabold tabular-nums mt-0.5">{formatNumber(Math.round(c.impressions * (c.ctr / 100)))}</p>
                               </div>
                               <div className="p-2.5 rounded-lg bg-card border border-border/50">
                                  <p className="text-[10px] uppercase font-bold text-muted-foreground">CPC</p>
                                  <p className="text-lg font-extrabold tabular-nums mt-0.5">{c.cpc ? formatINR(c.cpc, 1) : "—"}</p>
                               </div>
                               <div className="p-2.5 rounded-lg bg-card border border-border/50">
                                  <p className="text-[10px] uppercase font-bold text-muted-foreground">CPM</p>
                                  <p className="text-lg font-extrabold tabular-nums mt-0.5">{formatCPM(c.cpm)}</p>
                               </div>
                               <div className="p-2.5 rounded-lg bg-card border border-border/50">
                                  <p className="text-[10px] uppercase font-bold text-muted-foreground">Freq (28d)</p>
                                  <p className="text-lg font-extrabold tabular-nums mt-0.5">{c.frequency ? c.frequency.toFixed(2) : "—"}</p>
                               </div>
                               <div className="p-2.5 rounded-lg bg-card border border-border/50">
                                  <p className="text-[10px] uppercase font-bold text-muted-foreground">Ad ID</p>
                                  <code className="text-[9px] text-muted-foreground block mt-1 truncate">{c.id}</code>
                               </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {creatives.length === 0 && (
                  <tr>
                    <td colSpan={12} className="p-12 text-center text-muted-foreground">
                       No creatives found matching the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <DataTablePagination
            totalItems={creatives.length}
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
