import { useState, useMemo, useEffect, Fragment, Component, type ReactNode, type ErrorInfo } from "react";
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
  Pause,
  Play,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { ExecutionButton } from "@/components/execution-button";
import { useExecution } from "@/hooks/use-execution";
import {
  formatINR,
  formatPct,
  formatNumber,
  getCplColor,
  getCtrColor,
  truncate,
} from "@/lib/format";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { ScoreIndicator } from "@/components/score-indicator";
import { calculatePerformanceScore, calculateFinalAdScore, getClassification } from "@shared/scoring";

// ─── Types ──────────────────────────────────────────────────────────

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  errorLocation?: string;
}

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
};

type SortKey = keyof AdsPanelCreative;
type SortDir = "asc" | "desc";

// ─── Error Boundary ─────────────────────────────────────────────────

class AnalyticsErrorBoundary extends Component<{ children: ReactNode, location?: string }, State> {
  state: State = { hasError: false, error: null, errorInfo: null, errorLocation: this.props.location };
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  componentDidCatch(error: Error, errorInfo: ErrorInfo) { this.setState({ error, errorInfo }); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 border border-destructive/20 bg-destructive/5 rounded-lg">
          <h2 className="text-lg font-bold text-foreground">
            Something went wrong {this.state.errorLocation ? `in ${this.state.errorLocation}` : ""}
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {this.state.error?.message}
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Health score methodology tooltip ───────────────────────────────
function HealthMethodology() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="w-3 h-3 text-muted-foreground cursor-help inline-block ml-1" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <div className="text-xs space-y-1">
          <p className="font-medium text-primary">Ads Panel Standard Scoring</p>
          <p className="font-bold">Final Score = 0.6 * Performance + 0.4 * Age</p>
          <p className="text-muted-foreground">Performance includes CPL (35%), CPM (20%), CTR (15%), CVR (15%), and Frequency (15%). Age penalty applies after 30 days unless performance is exceptional.</p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export default function AnalyticsAdsPage() {
  const clientContext = useClient();
  const { analysisData: data, isLoadingAnalysis: isLoading, activePlatform } = clientContext ?? {};
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  const executionContext = useExecution();
  const { executeBatch, isExecuting: isBatchExecuting } = executionContext ?? {};

  const creatives = useMemo<AdsPanelCreative[]>(() => {
    if (!data) return [];

    let list: AdsPanelCreative[] = [];
    
    // Normalize source data
    const source = (data as any)?.creative_health || [];
    const campaigns = ((data as any)?.campaign_audit || (data as any)?.campaigns || []) as any[];

    const perfTargets = {
      cpl: (data as any)?.dynamic_thresholds?.cpl_target || 850,
      cpm: (data as any)?.dynamic_thresholds?.cpm_target || 800,
      ctr: (data as any)?.dynamic_thresholds?.ctr_min || 1.0,
      cvr: (data as any)?.dynamic_thresholds?.cvr_min || 2.0,
      frequency: 3.0
    };

    const processAd = (ad: any, campaignName: string, adsetName: string) => {
      const perfMetrics = {
        cpl: ad.cpl || 0,
        cpm: ad.cpm || ad.avg_cpm || ad.cost_per_mille || 0,
        ctr: ad.ctr || 0,
        cvr: ad.cvr || 0,
        frequency: ad.frequency || 1.0
      };
      
      const perf = calculatePerformanceScore(perfMetrics, perfTargets);
      const finalScore = calculateFinalAdScore(perf.score, ad.age_days || 0);
      const classification = getClassification(finalScore);

      return {
        id: ad.id || ad.ad_id || `${campaignName}-${adsetName}-${ad.name}`,
        name: ad.name || ad.ad_name || ad.headline || "Untitled Ad",
        campaignName: campaignName || "Unassigned Campaign",
        adsetName: adsetName || "Unassigned Group",
        isVideo: !!(ad.is_video || ad.ad_type === "VIDEO" || ad.thumb_stop_pct),
        status: (ad.status || "ACTIVE").toUpperCase(),
        classification,
        health_score: finalScore,
        spend: ad.spend || ad.cost || 0,
        impressions: ad.impressions || 0,
        leads: ad.leads || ad.conversions || 0,
        ctr: ad.ctr || 0,
        cpl: ad.cpl || 0,
        tsr: (ad.thumb_stop_pct !== undefined ? ad.thumb_stop_pct : ad.tsr) || 0,
        vhr: (ad.hold_rate_pct !== undefined ? ad.hold_rate_pct : ad.vhr) || 0,
        cpm: ad.cpm || ad.avg_cpm || ad.cost_per_mille,
        cpc: ad.cpc,
        frequency: ad.frequency,
        score_breakdown: perf.breakdown,
      };
    };

    if (source.length > 0) {
      list = source.map((c: any) => processAd(c, c.campaign_name, c.adset_name || c.ad_group_name));
    } else {
      campaigns.forEach((campaign) => {
        const groups = campaign.ad_sets || campaign.ad_groups || [];
        groups.forEach((group: any) => {
          (group.ads || []).forEach((ad: any) => {
            list.push(processAd(ad, campaign.campaign_name || campaign.name, group.name || group.ad_group_name));
          });
        });
      });
    }

    // Apply Filters
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

  const totalSpend = useMemo(() => creatives.reduce((sum, c) => sum + (c.spend || 0), 0), [creatives]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 opacity-30" />;
    return sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  }

  const formatCPM = (val: any) => {
    if (val === undefined || val === null || val === 0) return "—";
    const num = Number(val);
    if (isNaN(num)) return "—";
    return formatINR(num, 0);
  };

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
    { key: "cpm" as SortKey, label: "CPM", align: "right" },
  ];

  return (
    <AnalyticsErrorBoundary location="Ads Panel Main">
      <div className="p-6 space-y-4 max-w-[1800px]">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              <h1 className="text-xl font-bold text-foreground">Ads Panel</h1>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {creatives.length} creatives · {formatINR(totalSpend, 0)} total spend in view
            </p>
          </div>
          
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 bg-primary/10 border border-primary/20 px-3 py-1.5 rounded-full animate-in fade-in slide-in-from-top-2">
              <span className="text-xs font-bold text-primary">{selectedIds.size} Selected</span>
              <div className="h-4 w-px bg-primary/20 mx-1" />
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-7 text-[10px] font-bold uppercase tracking-tight text-primary hover:bg-primary/20"
                onClick={async () => {
                  const actions = Array.from(selectedIds).map(id => {
                    const c = creatives.find(item => item.id === id);
                    return {
                      action: isGoogle ? "PAUSE_AD" : "PAUSE_AD",
                      entityId: id,
                      entityName: c?.name || id,
                      entityType: "ad" as const,
                      strategicCall: "Bulk pause from Ads Panel"
                    };
                  });
                  if (executeBatch) await executeBatch(actions);
                  setSelectedIds(new Set());
                }}
                disabled={isBatchExecuting}
              >
                {isBatchExecuting ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Pause className="w-3 h-3 mr-1" />}
                Pause All
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-7 text-[10px] font-bold uppercase tracking-tight text-emerald-500 hover:bg-emerald-500/10"
                onClick={async () => {
                  const actions = Array.from(selectedIds).map(id => {
                    const c = creatives.find(item => item.id === id);
                    return {
                      action: isGoogle ? "ENABLE_AD" : "UNPAUSE_AD",
                      entityId: id,
                      entityName: c?.name || id,
                      entityType: "ad" as const,
                      strategicCall: "Bulk resume from Ads Panel"
                    };
                  });
                  if (executeBatch) await executeBatch(actions);
                  setSelectedIds(new Set());
                }}
                disabled={isBatchExecuting}
              >
                <Play className="w-3 h-3 mr-1" />
                Resume All
              </Button>
            </div>
          )}

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
          <CardContent className="card-content-premium p-0">
            <div className="overflow-x-auto">
              <table className="t-table w-full">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="p-3 w-8">
                      <div className="flex items-center gap-2">
                        <Checkbox 
                          checked={selectedIds.size === paginatedCreatives.length && paginatedCreatives.length > 0}
                          onCheckedChange={(checked) => {
                            if (checked) setSelectedIds(new Set(paginatedCreatives.map(c => c.id)));
                            else setSelectedIds(new Set());
                          }}
                        />
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
                      </div>
                    </th>
                    {columns.map((col) => (
                      <th
                        key={col.key}
                        className={`px-4 py-4 t-label font-bold uppercase tracking-widest text-muted-foreground/80 cursor-pointer select-none whitespace-nowrap ${
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
                    <th className="px-4 py-4 t-label font-bold uppercase tracking-widest text-muted-foreground/80 text-center whitespace-nowrap">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedCreatives.map((c) => {
                    const isPaused = c.status === "PAUSED";
                    const isExpanded = expandedIds.has(c.id);

                    return (
                      <Fragment key={c.id}>
                        <tr
                          className={`border-b border-border/30 hover:bg-muted/30 transition-colors cursor-pointer ${isPaused ? "opacity-50" : ""} ${c.classification === "UNDERPERFORMER" ? "border-l-2 border-l-red-500" : ""}`}
                          onClick={() => {
                            setExpandedIds(prev => {
                              const next = new Set(prev);
                              if (next.has(c.id)) next.delete(c.id);
                              else next.add(c.id);
                              return next;
                            });
                          }}
                        >
                          <td className="p-3 w-10" onClick={(e) => e.stopPropagation()}>
                             <div className="flex items-center gap-2">
                               <Checkbox 
                                 checked={selectedIds.has(c.id)}
                                 onCheckedChange={(checked) => {
                                    setSelectedIds(prev => {
                                      const next = new Set(prev);
                                      if (checked) next.add(c.id);
                                      else next.delete(c.id);
                                      return next;
                                    });
                                 }}
                               />
                               {isExpanded ? (
                                 <ChevronUp className="h-4 w-4 text-muted-foreground/50" />
                               ) : (
                                 <ChevronDown className="h-4 w-4 text-muted-foreground/20" />
                               )}
                             </div>
                          </td>
                          <td className={`p-3 transition-all duration-200 ${
                            columnSize === "compact" ? "max-w-[120px]" : 
                            columnSize === "normal" ? "max-w-[200px]" : "max-w-[400px]"
                          }`}>
                            <div className="font-medium text-foreground truncate">{c.name}</div>
                            <div className="text-[10px] text-muted-foreground uppercase tracking-tight truncate mt-0.5">
                              {truncate(c.campaignName, 20)} · {truncate(c.adsetName, 20)}
                            </div>
                          </td>
                          <td className="p-3">
                             <Badge variant={c.isVideo ? "default" : "secondary"} className="text-[9px] px-1 py-0 uppercase">
                                 {c.isVideo ? "Video" : "Static"}
                             </Badge>
                          </td>
                          <td className="p-3">
                            <StatusBadge classification={c.classification} />
                          </td>
                          <td className="p-3">
                            <ScoreIndicator 
                              score={c.health_score} 
                              breakdown={c.score_breakdown} 
                              label="Creative Health"
                              description="Performance (60%) + Age (40%)"
                            />
                          </td>
                          <td className="p-3 text-right tabular-nums text-foreground font-medium">{formatINR(c.spend, 0)}</td>
                          <td className="p-3 text-right tabular-nums text-foreground">{formatNumber(c.leads)}</td>
                          <td className={`p-3 text-right tabular-nums font-bold ${getCplColor(c.cpl, (data as any)?.dynamic_thresholds)}`}>
                            {c.cpl > 0 ? formatINR(c.cpl, 0) : "—"}
                          </td>
                          <td className={`p-3 text-right tabular-nums ${getCtrColor(c.ctr)}`}>
                            {formatPct(c.ctr)}
                          </td>
                          <td className="p-3 text-right tabular-nums text-muted-foreground italic">
                             {formatCPM(c.cpm)}
                          </td>
                          <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                             <ExecutionButton
                               action={isPaused ? (isGoogle ? "ENABLE_AD" : "UNPAUSE_AD") : "PAUSE_AD"}
                               entityId={c.id}
                               entityName={c.name}
                               entityType="ad"
                               label=""
                               variant="ghost"
                               size="icon"
                               icon={isPaused ? <Play className="w-3.5 h-3.5 text-emerald-500" /> : <Pause className="w-3.5 h-3.5 text-muted-foreground" />}
                               confirmMessage={`${isPaused ? 'Resume' : 'Pause'} ad "${c.name}"?`}
                               className="h-8 w-8 hover:bg-muted"
                               currentMetrics={{
                                 spend: c.spend,
                                 leads: c.leads,
                                 cpl: c.cpl,
                                 ctr: c.ctr,
                                 impressions: c.impressions
                               }}
                             />
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="border-b border-border/30 bg-muted/20 animate-in fade-in duration-300">
                            <td colSpan={11} className="p-5">
                              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                                 <div className="p-3 rounded-xl bg-card border border-border/50 shadow-sm">
                                    <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-1">Impressions</p>
                                    <p className="text-lg font-black tabular-nums">{formatNumber(c.impressions)}</p>
                                 </div>
                                 <div className="p-3 rounded-xl bg-card border border-border/50 shadow-sm">
                                    <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-1">Clicks</p>
                                    <p className="text-lg font-black tabular-nums">{formatNumber(Math.round(c.impressions * ((c.ctr || 0) / 100)))}</p>
                                 </div>
                                 <div className="p-3 rounded-xl bg-card border border-border/50 shadow-sm">
                                    <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-1">CPC</p>
                                    <p className="text-lg font-black tabular-nums">{c.cpc ? formatINR(c.cpc, 2) : "—"}</p>
                                 </div>
                                 <div className="p-3 rounded-xl bg-card border border-border/50 shadow-sm">
                                    <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-1">Frequency</p>
                                    <p className="text-lg font-black tabular-nums">{c.frequency ? c.frequency.toFixed(2) : "—"}</p>
                                 </div>
                                 {c.isVideo && (
                                   <>
                                     <div className="p-3 rounded-xl bg-card border border-border/50 shadow-sm">
                                        <p className="text-[10px] uppercase font-bold text-amber-500 tracking-wider mb-1 flex items-center gap-1.5 underline decoration-amber-500/30">
                                          Thumb Stop <AlertCircle className="w-2.5 h-2.5" />
                                        </p>
                                        <p className="text-lg font-black tabular-nums text-amber-500">{formatPct(c.tsr || 0)}</p>
                                     </div>
                                     <div className="p-3 rounded-xl bg-card border border-border/50 shadow-sm">
                                        <p className="text-[10px] uppercase font-bold text-emerald-500 tracking-wider mb-1 flex items-center gap-1.5 underline decoration-emerald-500/30">
                                          Hold Rate <AlertCircle className="w-2.5 h-2.5" />
                                        </p>
                                        <p className="text-lg font-black tabular-nums text-emerald-500">{formatPct(c.vhr || 0)}</p>
                                     </div>
                                   </>
                                 )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {creatives.length === 0 && (
                    <tr>
                      <td colSpan={11} className="p-20 text-center">
                         <div className="flex flex-col items-center gap-2 opacity-50">
                           <BarChart3 className="w-8 h-8" />
                           <p className="text-sm font-medium">No creatives found matching your current filters</p>
                         </div>
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
              onPageChange={(p) => { setPage(p); setSelectedIds(new Set()); }}
              onPageSizeChange={(s) => { setPageSize(s); setPage(1); setSelectedIds(new Set()); }}
            />
          </CardContent>
        </Card>
      </div>
    </AnalyticsErrorBoundary>
  );
}
