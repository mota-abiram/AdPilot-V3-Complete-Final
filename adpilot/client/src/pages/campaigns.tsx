import { useState, useMemo, useEffect } from "react";
import { useClient } from "@/lib/client-context";
import { DataTablePagination } from "@/components/data-table-pagination";
import type { CampaignAudit } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowUpDown, ChevronDown, ChevronUp, Pause, Play, TrendingUp, TrendingDown, Loader2, AlertTriangle, Info } from "lucide-react";
import {
  formatINR,
  formatPct,
  formatNumber,
  getHealthBgColor,
  getHealthBarBg,
  getLayerColor,
  getClassificationColor,
  getLearningStatusColor,
  getCplColor,
  getCtrColor,
  getFrequencyColor,
  truncate,
} from "@/lib/format";
import { useExecution } from "@/hooks/use-execution";
import { ExecutionButton } from "@/components/execution-button";
import { UnifiedActions } from "@/components/unified-actions";
import { usePausedEntities } from "@/hooks/use-paused-entities";

type SortKey = keyof CampaignAudit;
type SortDir = "asc" | "desc";

// ─── Google campaign type badge colors ──────────────────────────────
function getCampaignTypeBadge(type: string): { bg: string; text: string; label: string } {
  const t = (type || "").toLowerCase();
  if (t === "branded") return { bg: "bg-amber-500/15", text: "text-amber-400", label: "Branded" };
  if (t === "location" || t.startsWith("location")) return { bg: "bg-emerald-500/15", text: "text-emerald-400", label: "Location" };
  if (t === "demand_gen" || t === "dg") return { bg: "bg-purple-500/15", text: "text-purple-400", label: "Demand Gen" };
  if (t === "search") return { bg: "bg-blue-500/15", text: "text-blue-400", label: "Search" };
  return { bg: "bg-gray-500/15", text: "text-gray-400", label: type || "—" };
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
          <p className="font-medium">Health Score Methodology</p>
          <p>Weighted composite of CTR vs benchmark (30%), CVR vs benchmark (30%), CPL vs target (25%), and budget utilization (15%).</p>
          <p className="text-muted-foreground">Benchmarks differ by campaign type (branded/location/demand_gen).</p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export default function CampaignsPage() {
  const { analysisData: data, isLoadingAnalysis: isLoading, activePlatform } = useClient();
  const { executeBatch, isExecuting } = useExecution();
  const { isPaused: isEntityPaused } = usePausedEntities();
  const isGoogle = activePlatform === "google";

  const [sortKey, setSortKey] = useState<SortKey>("health_score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filterLayer, setFilterLayer] = useState<string>("ALL");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [filterClassification, setFilterClassification] = useState<string>("ALL");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState<{ open: boolean; action: "pause" | "activate" }>({ open: false, action: "pause" });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [searchPage, setSearchPage] = useState(1);
  const [searchPageSize, setSearchPageSize] = useState(25);
  const [dgPage, setDgPage] = useState(1);
  const [dgPageSize, setDgPageSize] = useState(25);

  const campaigns = useMemo(() => {
    if (!data) return [];
    const source = isGoogle ? ((data as any).campaigns || (data as any).campaign_analysis || (data as any).campaign_audit) : data.campaign_audit;
    if (!source) return [];
    let list = [...source];
    // Only show ACTIVE campaigns, or PAUSED campaigns with spend > 0 in the window
    list = list.filter((c: any) => {
      const status = (c.status || "").toUpperCase();
      if (status === "ACTIVE" || status === "ENABLED") return true;
      if (status === "PAUSED" && (c.spend || c.cost || 0) > 0) return true;
      return false;
    });
    if (filterLayer !== "ALL") {
      if (isGoogle) {
        list = list.filter((c: any) => c.campaign_type === filterLayer || c.theme === filterLayer);
      } else {
        list = list.filter((c) => c.layer === filterLayer);
      }
    }
    if (filterStatus !== "ALL") {
      // Normalize "ENABLED" to "ACTIVE" for filtering purposes
      list = list.filter((c) => {
        const s = (c.status || "").toUpperCase();
        if (filterStatus === "ACTIVE") return s === "ACTIVE" || s === "ENABLED";
        return s === filterStatus;
      });
    }
    if (filterClassification !== "ALL") list = list.filter((c) => c.classification === filterClassification);
    list.sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      return sortDir === "asc"
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });
    return list;
  }, [data, sortKey, sortDir, filterLayer, filterStatus, filterClassification]);

  // Google-specific: split campaigns into Search and DG
  const searchCampaigns = useMemo(() => {
    if (!isGoogle) return [];
    return campaigns.filter((c: any) => {
      const t = c.theme || c.layer || c.campaign_type || "";
      return t === "branded" || t === "location" || t.startsWith?.("location");
    });
  }, [campaigns, isGoogle]);

  const dgCampaigns = useMemo(() => {
    if (!isGoogle) return [];
    return campaigns.filter((c: any) => {
      const t = c.theme || c.layer || c.campaign_type || "";
      return t === "demand_gen" || t.startsWith?.("demand_gen") || t === "DEMAND_GEN";
    });
  }, [campaigns, isGoogle]);

  // Google-specific: critical alerts from account_pulse
  const alerts = useMemo(() => {
    if (!isGoogle || !data) return [];
    const pulse = (data as any).account_pulse;
    return pulse?.alerts || [];
  }, [data, isGoogle]);

  // Search and DG summaries
  const searchSummary = isGoogle ? (data as any)?.search_summary : null;
  const dgSummary = isGoogle ? (data as any)?.dg_summary : null;

  // Reset page to 1 when filters change
  useEffect(() => { setPage(1); setSearchPage(1); setDgPage(1); }, [filterLayer, filterStatus, filterClassification]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 opacity-30" />;
    return sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === campaigns.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(campaigns.map((c) => c.campaign_id)));
    }
  }

  async function handleBulkAction(action: "pause" | "activate") {
    setBulkConfirm({ open: false, action: "pause" });
    const selected = campaigns.filter((c) => selectedIds.has(c.campaign_id));
    const activateAction = isGoogle ? "ENABLE_CAMPAIGN" : "UNPAUSE_CAMPAIGN";
    const actions = selected.map((c) => ({
      action: action === "pause" ? "PAUSE_CAMPAIGN" : activateAction,
      entityId: c.campaign_id,
      entityName: c.campaign_name,
      entityType: "campaign" as const,
      params: { reason: `Bulk ${action} from Campaigns page` },
    }));
    await executeBatch(actions);
    setSelectedIds(new Set());
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
  const hasSelection = selectedIds.size > 0;

  // ─── Google: sortable columns ─────────────────────────────────────
  const googleColumns = [
    { key: "campaign_name" as SortKey, label: "Campaign", align: "left" },
    { key: "campaign_type" as SortKey, label: "Type", align: "left" },
    { key: "classification" as SortKey, label: "Class", align: "left" },
    { key: "health_score" as SortKey, label: "Health", align: "left" },
    { key: "spend" as SortKey, label: "Spend", align: "right" },
    { key: "leads" as SortKey, label: "Leads", align: "right" },
    { key: "cpl" as SortKey, label: "CPL", align: "right" },
    { key: "ctr" as SortKey, label: "CTR", align: "right" },
    { key: "cvr" as SortKey, label: "CVR", align: "right" },
    { key: "cpc" as SortKey, label: "CPC", align: "right" },
    { key: "search_impression_share" as SortKey, label: "IS %", align: "right" },
    { key: "is_lost_rank" as SortKey, label: "IS Lost Rank", align: "right" },
    { key: "is_lost_budget" as SortKey, label: "IS Lost Budget", align: "right" },
    { key: "bidding_strategy" as SortKey, label: "Bidding", align: "left" },
    { key: "daily_budget" as SortKey, label: "Budget/d", align: "right" },
  ];

  const metaColumns = [
    { key: "campaign_name" as SortKey, label: "Campaign", align: "left" },
    { key: "layer" as SortKey, label: "Layer", align: "left" },
    { key: "classification" as SortKey, label: "Class", align: "left" },
    { key: "learning_status" as SortKey, label: "Learning", align: "left" },
    { key: "delivery_status" as SortKey, label: "Delivery", align: "left" },
    { key: "health_score" as SortKey, label: "Health", align: "left" },
    { key: "spend" as SortKey, label: "Spend", align: "right" },
    { key: "leads" as SortKey, label: "Leads", align: "right" },
    { key: "cpl" as SortKey, label: "CPL", align: "right" },
    { key: "ctr" as SortKey, label: "CTR", align: "right" },
    { key: "cpc" as SortKey, label: "CPC", align: "right" },
    { key: "cpm" as SortKey, label: "CPM", align: "right" },
    { key: "frequency" as SortKey, label: "Freq", align: "right" },
    { key: "daily_budget" as SortKey, label: "Budget/d", align: "right" },
    { key: "budget_utilization_pct" as SortKey, label: "Util %", align: "right" },
  ];

  // ─── Render a campaign table (reusable for Search/DG sections) ────
  function renderGoogleRow(c: any) {
    const classColor = getClassificationColor(c.classification);
    const typeBadge = getCampaignTypeBadge(c.theme || c.layer || c.campaign_type);
    const isPaused = c.status === "PAUSED" || c.delivery_status === "NOT_DELIVERING" || isEntityPaused(c.campaign_id);
    const isSelected = selectedIds.has(c.campaign_id);
    const isExpanded = expandedId === c.campaign_id;

    return (
      <>
        <tr
          key={c.campaign_id}
          className={`border-b border-border/30 hover:bg-muted/30 transition-colors cursor-pointer ${
            isSelected ? "bg-primary/5" : ""
          } ${isPaused ? "opacity-50" : ""} ${c.should_pause || c.classification === "LOSER" ? "border-l-2 border-l-red-500" : ""}`}
          onClick={() => setExpandedId(isExpanded ? null : c.campaign_id)}
          data-testid={`row-campaign-${c.campaign_id}`}
        >
          <td className="p-3" onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => toggleSelect(c.campaign_id)}
              data-testid={`checkbox-campaign-${c.campaign_id}`}
            />
          </td>
          <td className="p-3 max-w-[200px]">
            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="truncate block cursor-default text-foreground">
                    {truncate(c.campaign_name || c.name, 30)}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p className="text-xs max-w-sm">{c.campaign_name || c.name}</p>
                </TooltipContent>
              </Tooltip>
              {isPaused && (
                <Badge variant="secondary" className="text-[9px] px-1 py-0 text-red-400 shrink-0">PAUSED</Badge>
              )}
            </div>
            {(c.should_pause || c.classification === "LOSER") && !isPaused && (
              <div className="mt-1">
                <Badge variant="destructive" className="text-[9px] px-1 py-0">
                  Recommended: Pause
                </Badge>
              </div>
            )}
          </td>
          <td className="p-3">
            <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${typeBadge.bg} ${typeBadge.text}`}>
              {typeBadge.label}
            </span>
          </td>
          <td className="p-3">
            <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${classColor.bg} ${classColor.text}`}>
              {c.classification || c.cost_stack?.overall || "—"}
            </span>
          </td>
          <td className="p-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2">
                  <div className={`w-14 h-1.5 rounded-full ${getHealthBarBg(c.health_score)}`}>
                    <div className={`h-full rounded-full ${getHealthBgColor(c.health_score)}`} style={{ width: `${Math.min(c.health_score || 0, 100)}%` }} />
                  </div>
                  <span className="tabular-nums text-muted-foreground w-6">{c.health_score || "—"}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                <div className="text-xs space-y-1">
                  <p className="font-medium">Google Scoring Weights</p>
                  {c.score_breakdown ? (
                    Object.entries(c.score_breakdown).map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground capitalize">{k.replace(/_/g, " ")}</span>
                        <span className="tabular-nums font-medium">{typeof v === "number" ? v.toFixed(1) : String(v)}</span>
                      </div>
                    ))
                  ) : (
                    <>
                      <p className="text-muted-foreground">CPL: 30% · CVR: 25% · CTR: 15%</p>
                      <p className="text-muted-foreground">IS: 15% · QS: 15%</p>
                    </>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          </td>
          <td className="p-3 text-right tabular-nums">{formatINR(c.spend || c.cost || 0, 0)}</td>
          <td className="p-3 text-right tabular-nums">{c.leads ?? c.conversions ?? 0}</td>
          <td className={`p-3 text-right tabular-nums ${(c.cpl || 0) > 0 ? getCplColor(c.cpl, thresholds) : "text-foreground"}`}>
            {(c.cpl || 0) > 0 ? formatINR(c.cpl, 0) : "—"}
          </td>
          <td className={`p-3 text-right tabular-nums ${getCtrColor(c.ctr || 0)}`}>
            {formatPct(c.ctr || 0)}
          </td>
          <td className="p-3 text-right tabular-nums">
            {(() => {
              const val = c.cvr;
              if (val == null) return "—";
              const color = val >= 5 ? "text-emerald-400" : val >= 2 ? "text-amber-400" : "text-red-400";
              return <span className={color}>{formatPct(val)}</span>;
            })()}
          </td>
          <td className="p-3 text-right tabular-nums">{formatINR(c.cpc || 0, 2)}</td>
          <td className="p-3 text-right tabular-nums">
            {(() => {
              const val = c.search_impression_share;
              if (val == null) return "—";
              const color = val >= 70 ? "text-emerald-400" : val >= 40 ? "text-amber-400" : "text-red-400";
              return <span className={color}>{formatPct(val)}</span>;
            })()}
          </td>
          <td className="p-3 text-right tabular-nums">
            {(() => {
              const val = c.is_lost_rank ?? c.search_is_lost_rank ?? c.is_data?.is_lost_rank;
              if (val == null) return "—";
              const color = val > 30 ? "text-red-400" : val > 10 ? "text-amber-400" : "text-emerald-400";
              return <span className={color}>{formatPct(val)}</span>;
            })()}
          </td>
          <td className="p-3 text-right tabular-nums">
            {(() => {
              const val = c.is_lost_budget ?? c.search_is_lost_budget ?? c.is_data?.is_lost_budget;
              if (val == null) return "—";
              const color = val > 30 ? "text-red-400" : val > 10 ? "text-amber-400" : "text-emerald-400";
              return <span className={color}>{formatPct(val)}</span>;
            })()}
          </td>
          <td className="p-3">
            <span className="text-[10px] text-muted-foreground">{c.bidding_strategy || "—"}</span>
          </td>
          <td className="p-3 text-right tabular-nums">{formatINR(c.daily_budget || 0, 0)}</td>
          <td className="p-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-1 justify-center">
              {!isPaused ? (
                <ExecutionButton
                  action="PAUSE_CAMPAIGN"
                  entityId={c.campaign_id || c.id}
                  entityName={c.campaign_name || c.name}
                  entityType="campaign"
                  label=""
                  variant="ghost"
                  size="icon"
                  icon={<Pause className="w-3.5 h-3.5" />}
                  confirmMessage={`Pause campaign "${c.campaign_name || c.name}"?`}
                  params={{ reason: "Manual pause from Campaigns page" }}
                  className="h-7 w-7"
                  data-testid={`button-pause-campaign-${c.campaign_id || c.id}`}
                />
              ) : (
                <ExecutionButton
                  action="ENABLE_CAMPAIGN"
                  entityId={c.campaign_id || c.id}
                  entityName={c.campaign_name || c.name}
                  entityType="campaign"
                  label=""
                  variant="ghost"
                  size="icon"
                  icon={<Play className="w-3.5 h-3.5 text-emerald-400" />}
                  confirmMessage={`Activate campaign "${c.campaign_name || c.name}"?`}
                  params={{ reason: "Manual activation from Campaigns page" }}
                  className="h-7 w-7"
                  data-testid={`button-activate-campaign-${c.campaign_id || c.id}`}
                />
              )}
              {!isPaused && (
                <ExecutionButton
                  action="SCALE_BUDGET_UP"
                  entityId={c.campaign_id || c.id}
                  entityName={c.campaign_name || c.name}
                  entityType="campaign"
                  label=""
                  variant="ghost"
                  size="icon"
                  icon={<TrendingUp className="w-3.5 h-3.5 text-emerald-400" />}
                  confirmMessage={`Scale up budget by 20% on "${c.campaign_name || c.name}"?\nCurrent daily budget: ${formatINR(c.daily_budget || 0, 0)}`}
                  params={{ scalePercent: 20, reason: "Manual scale up from Campaigns page" }}
                  className="h-7 w-7"
                  data-testid={`button-scaleup-campaign-${c.campaign_id || c.id}`}
                />
              )}
              {!isPaused && (
                <ExecutionButton
                  action="SCALE_BUDGET_DOWN"
                  entityId={c.campaign_id || c.id}
                  entityName={c.campaign_name || c.name}
                  entityType="campaign"
                  label=""
                  variant="ghost"
                  size="icon"
                  icon={<TrendingDown className="w-3.5 h-3.5 text-orange-400" />}
                  confirmMessage={`Scale down budget by 20% on "${c.campaign_name || c.name}"?\nCurrent daily budget: ${formatINR(c.daily_budget || 0, 0)}`}
                  params={{ scalePercent: -20, reason: "Manual scale down from Campaigns page" }}
                  className="h-7 w-7"
                  data-testid={`button-scaledown-campaign-${c.campaign_id || c.id}`}
                />
              )}
            </div>
          </td>
        </tr>
        {isExpanded && (
          <tr key={`${c.campaign_id}-expanded`} className="border-b border-border/30 bg-muted/20">
            <td colSpan={17} className="p-4">
              <div className="space-y-3">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Health Score Breakdown — {c.campaign_name || c.name}
                </p>
                {c.score_breakdown ? (
                  <div className="flex flex-wrap gap-3">
                    {Object.entries(c.score_breakdown).map(([metric, score]) => {
                      const band = c.score_bands?.[metric] || "unknown";
                      const bandColor =
                        band === "EXCELLENT" ? "text-emerald-400 bg-emerald-500/10" :
                        band === "GOOD" ? "text-emerald-400 bg-emerald-500/10" :
                        band === "WATCH" ? "text-amber-400 bg-amber-500/10" :
                        band === "POOR" ? "text-red-400 bg-red-500/10" :
                        "text-muted-foreground bg-muted/50";
                      return (
                        <div key={metric} className="flex items-center gap-2 p-2 rounded-md bg-card border border-border/30 min-w-[140px]">
                          <div className="flex-1">
                            <p className="text-[10px] text-muted-foreground capitalize">{metric.replace(/_/g, " ")}</p>
                            <p className="text-sm font-semibold tabular-nums text-foreground">{typeof score === "number" ? score.toFixed(1) : String(score)}</p>
                          </div>
                          <Badge variant="secondary" className={`text-[9px] ${bandColor}`}>
                            {band}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <div className="p-2 rounded-md bg-card border border-border/30">
                      <p className="text-[10px] text-muted-foreground">CTR</p>
                      <p className="text-sm font-semibold tabular-nums">{formatPct(c.ctr || 0)}</p>
                    </div>
                    <div className="p-2 rounded-md bg-card border border-border/30">
                      <p className="text-[10px] text-muted-foreground">CVR</p>
                      <p className="text-sm font-semibold tabular-nums">{c.cvr != null ? formatPct(c.cvr) : "—"}</p>
                    </div>
                    <div className="p-2 rounded-md bg-card border border-border/30">
                      <p className="text-[10px] text-muted-foreground">CPL</p>
                      <p className="text-sm font-semibold tabular-nums">{(c.cpl || 0) > 0 ? formatINR(c.cpl, 0) : "—"}</p>
                    </div>
                    <div className="p-2 rounded-md bg-card border border-border/30">
                      <p className="text-[10px] text-muted-foreground">Cost Stack</p>
                      <p className="text-sm font-semibold">{c.cost_stack?.overall || "—"}</p>
                    </div>
                    <div className="p-2 rounded-md bg-card border border-border/30">
                      <p className="text-[10px] text-muted-foreground">Scoring Weights</p>
                      <div className="text-[9px] text-muted-foreground mt-1 space-y-0.5">
                        <p>CPL: 30% · CVR: 25% · CTR: 15%</p>
                        <p>IS: 15% · QS: 15%</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </td>
          </tr>
        )}
      </>
    );
  }

  // ─── Google campaign table (used for each section) ────────────────
  function renderGoogleTable(rows: any[], sectionId: string, pg: number, pgSize: number, setPg: (p: number) => void, setPgSize: (s: number) => void) {
    const paginatedRows = pgSize >= rows.length ? rows : rows.slice((pg - 1) * pgSize, pg * pgSize);
    return (
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid={`table-${sectionId}`}>
              <thead>
                <tr className="border-b border-border/50">
                  <th className="p-3 w-8">
                    <Checkbox
                      checked={rows.length > 0 && rows.every((c: any) => selectedIds.has(c.campaign_id || c.id))}
                      onCheckedChange={() => {
                        const ids = rows.map((c: any) => c.campaign_id || c.id);
                        const allSelected = ids.every((id) => selectedIds.has(id));
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          ids.forEach((id) => allSelected ? next.delete(id) : next.add(id));
                          return next;
                        });
                      }}
                    />
                  </th>
                  {googleColumns.map((col) => (
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
                  <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground text-center whitespace-nowrap">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginatedRows.map((c: any) => renderGoogleRow(c))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={17} className="p-8 text-center text-xs text-muted-foreground">
                      No campaigns in this section.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <DataTablePagination
            totalItems={rows.length}
            pageSize={pgSize}
            currentPage={pg}
            onPageChange={setPg}
            onPageSizeChange={setPgSize}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="p-6 space-y-4 max-w-[1800px]">
      {/* Bulk Action Confirm */}
      <AlertDialog open={bulkConfirm.open} onOpenChange={(o) => { if (!o) setBulkConfirm({ open: false, action: "pause" }); }}>
        <AlertDialogContent className="sm:max-w-[480px] max-h-[90vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">
              {bulkConfirm.action === "pause" ? "Pause" : "Activate"} {selectedIds.size} Campaigns?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm">
              This will {bulkConfirm.action === "pause" ? "pause" : "activate"} {selectedIds.size} selected campaign{selectedIds.size !== 1 ? "s" : ""} on {isGoogle ? "Google Ads" : "Meta Ads"}.
              {bulkConfirm.action === "pause" && (
                <span className="block mt-1 text-amber-500">Paused campaigns will stop delivering immediately.</span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-bulk-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => handleBulkAction(bulkConfirm.action)} data-testid="button-bulk-confirm">
              {bulkConfirm.action === "pause" ? "Pause All" : "Activate All"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── Google: Alerts Banner ──────────────────────────────────── */}
      {isGoogle && alerts.length > 0 && (
        <Card className="border-red-500/30 bg-red-500/5" data-testid="card-alerts-banner">
          <CardContent className="p-4 space-y-2">
            <p className="text-xs font-semibold text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4" />
              {alerts.length} Critical Alert{alerts.length !== 1 ? "s" : ""}
            </p>
            <div className="space-y-1.5">
              {alerts.map((alert: any, idx: number) => (
                <div key={idx} className="flex items-start gap-2 text-[11px]">
                  <span className="text-red-400 mt-0.5 shrink-0">-</span>
                  <span className="text-red-300">
                    {typeof alert === "string" ? alert : alert.message || alert.detail || JSON.stringify(alert)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Campaigns</h1>
          <p className="text-xs text-muted-foreground">
            {campaigns.length} campaigns · {formatINR((data as any).summary?.total_spend || (data as any).account_pulse?.total_spend || 0, 0)} total spend
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            className="px-2 py-1.5 text-xs rounded-md bg-muted/50 border border-border/50 text-foreground"
            value={filterLayer}
            onChange={(e) => setFilterLayer(e.target.value)}
            data-testid="select-filter-layer"
          >
            {isGoogle ? (
              <>
                <option value="ALL">All Types</option>
                <option value="branded">Branded</option>
                <option value="location">Location</option>
                <option value="demand_gen">Demand Gen</option>
              </>
            ) : (
              <>
                <option value="ALL">All Layers</option>
                <option value="TOFU">TOFU</option>
                <option value="MOFU">MOFU</option>
                <option value="BOFU">BOFU</option>
              </>
            )}
          </select>
          <select
            className="px-2 py-1.5 text-xs rounded-md bg-muted/50 border border-border/50 text-foreground"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            data-testid="select-filter-status"
          >
            <option value="ALL">All Status</option>
            <option value="ACTIVE">Active</option>
            <option value="PAUSED">Paused</option>
          </select>
          <select
            className="px-2 py-1.5 text-xs rounded-md bg-muted/50 border border-border/50 text-foreground"
            value={filterClassification}
            onChange={(e) => setFilterClassification(e.target.value)}
            data-testid="select-filter-classification"
          >
            <option value="ALL">All Classifications</option>
            <option value="WINNER">Winner</option>
            <option value="WATCH">Watch</option>
            <option value="UNDERPERFORMER">Underperformer</option>
          </select>
        </div>
      </div>

      {/* Bulk action toolbar */}
      {hasSelection && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border border-border/50">
          <span className="text-xs font-medium text-foreground">
            {selectedIds.size} selected
          </span>
          <Button
            size="sm"
            variant="destructive"
            className="text-xs"
            onClick={() => setBulkConfirm({ open: true, action: "pause" })}
            disabled={isExecuting}
            data-testid="button-bulk-pause"
          >
            {isExecuting ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Pause className="w-3.5 h-3.5 mr-1" />}
            Pause Selected
          </Button>
          <Button
            size="sm"
            variant="default"
            className="text-xs bg-emerald-600 hover:bg-emerald-700"
            onClick={() => setBulkConfirm({ open: true, action: "activate" })}
            disabled={isExecuting}
            data-testid="button-bulk-activate"
          >
            {isExecuting ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Play className="w-3.5 h-3.5 mr-1" />}
            Activate Selected
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-xs"
            onClick={() => setSelectedIds(new Set())}
            data-testid="button-clear-selection"
          >
            Clear
          </Button>
        </div>
      )}

      {/* ─── Google: Split into Search + DG sections ─────────────── */}
      {isGoogle ? (
        <div className="space-y-6">
          {/* Search Campaigns Section */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Search Campaigns (Branded + Location)</h2>
                {searchSummary && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {searchSummary.campaign_count} campaigns · Spend {formatINR(searchSummary.spend, 0)} · Leads {searchSummary.leads} · CPL {formatINR(searchSummary.cpl, 0)} · CTR {formatPct(searchSummary.ctr)} · CVR {formatPct(searchSummary.cvr)}
                  </p>
                )}
              </div>
            </div>
            {renderGoogleTable(searchCampaigns, "search-campaigns", searchPage, searchPageSize, setSearchPage, setSearchPageSize)}
          </div>

          {/* DG Campaigns Section */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Demand Gen Campaigns</h2>
                {dgSummary && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {dgSummary.campaign_count} campaigns · Spend {formatINR(dgSummary.spend, 0)} · Leads {dgSummary.leads} · CPL {formatINR(dgSummary.cpl, 0)} · CTR {formatPct(dgSummary.ctr)} · CVR {formatPct(dgSummary.cvr)}
                    {dgSummary.video_metrics_aggregate && (
                      <> · TSR {dgSummary.video_metrics_aggregate.tsr_avg}% · VHR {dgSummary.video_metrics_aggregate.vhr_avg}%</>
                    )}
                  </p>
                )}
              </div>
            </div>
            {renderGoogleTable(dgCampaigns, "dg-campaigns", dgPage, dgPageSize, setDgPage, setDgPageSize)}
          </div>
        </div>
      ) : (
        /* ─── Meta: Original single table ──────────────────────────── */
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="p-3 w-8">
                      <Checkbox
                        checked={campaigns.length > 0 && selectedIds.size === campaigns.length}
                        onCheckedChange={toggleSelectAll}
                        data-testid="checkbox-select-all"
                      />
                    </th>
                    {metaColumns.map((col) => (
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
                    <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground text-center whitespace-nowrap">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(pageSize >= campaigns.length ? campaigns : campaigns.slice((page - 1) * pageSize, page * pageSize)).map((c: any) => {
                    const classColor = getClassificationColor(c.classification);
                    const isPaused = c.status === "PAUSED" || c.delivery_status === "NOT_DELIVERING" || isEntityPaused(c.campaign_id);
                    const isSelected = selectedIds.has(c.campaign_id);
                    const isExpanded = expandedId === c.campaign_id;
                    const activateAction = "UNPAUSE_CAMPAIGN";

                    return (
                      <>
                        <tr
                          key={c.campaign_id}
                          className={`border-b border-border/30 hover:bg-muted/30 transition-colors cursor-pointer ${
                            isSelected ? "bg-primary/5" : ""
                          } ${isPaused ? "opacity-50" : ""}`}
                          onClick={() => setExpandedId(isExpanded ? null : c.campaign_id)}
                          data-testid={`row-campaign-${c.campaign_id}`}
                        >
                          <td className="p-3" onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleSelect(c.campaign_id)}
                              data-testid={`checkbox-campaign-${c.campaign_id}`}
                            />
                          </td>
                          <td className="p-3 max-w-[200px]">
                            <div className="flex items-center gap-1.5">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="truncate block cursor-default text-foreground">
                                    {truncate(c.campaign_name, 30)}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                  <p className="text-xs max-w-sm">{c.campaign_name}</p>
                                </TooltipContent>
                              </Tooltip>
                              {isPaused && (
                                <Badge variant="secondary" className="text-[9px] px-1 py-0 text-red-400 shrink-0">PAUSED</Badge>
                              )}
                            </div>
                            {c.classification === "UNDERPERFORMER" && !isPaused && (
                              <div className="mt-1">
                                <Badge variant="destructive" className="text-[9px] px-1 py-0">
                                  Recommended: Pause
                                </Badge>
                              </div>
                            )}
                          </td>
                          <td className="p-3">
                            <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${getLayerColor(c.layer).bg} ${getLayerColor(c.layer).text}`}>
                              {c.layer}
                            </span>
                          </td>
                          <td className="p-3">
                            <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${classColor.bg} ${classColor.text}`}>
                              {c.classification}
                            </span>
                          </td>
                          <td className="p-3">
                            <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${getLearningStatusColor(c.learning_status).bg} ${getLearningStatusColor(c.learning_status).text}`}>
                              {c.learning_status}
                            </span>
                          </td>
                          <td className="p-3">
                            <span className={`text-[10px] ${c.delivery_status === "NOT_DELIVERING" ? "text-red-400" : "text-foreground"}`}>
                              {c.delivery_status}
                            </span>
                          </td>
                          <td className="p-3">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="flex items-center gap-2">
                                  <div className={`w-14 h-1.5 rounded-full ${getHealthBarBg(c.health_score)}`}>
                                    <div className={`h-full rounded-full ${getHealthBgColor(c.health_score)}`} style={{ width: `${c.health_score}%` }} />
                                  </div>
                                  <span className="tabular-nums text-muted-foreground w-6">{c.health_score}</span>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs">
                                <div className="text-xs space-y-1">
                                  <p className="font-medium">Score Breakdown</p>
                                  {c.score_breakdown && Object.entries(c.score_breakdown).map(([k, v]) => (
                                    <div key={k} className="flex items-center justify-between gap-3">
                                      <span className="text-muted-foreground capitalize">{k.replace(/_/g, " ")}</span>
                                      <span className="tabular-nums font-medium">{typeof v === "number" ? v.toFixed(1) : String(v)}</span>
                                    </div>
                                  ))}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </td>
                          <td className="p-3 text-right tabular-nums">{formatINR(c.spend, 0)}</td>
                          <td className="p-3 text-right tabular-nums">{c.leads}</td>
                          <td className={`p-3 text-right tabular-nums ${c.cpl > 0 ? getCplColor(c.cpl, thresholds) : "text-foreground"}`}>
                            {c.cpl > 0 ? formatINR(c.cpl, 0) : "—"}
                          </td>
                          <td className={`p-3 text-right tabular-nums ${getCtrColor(c.ctr)}`}>
                            {formatPct(c.ctr)}
                          </td>
                          <td className="p-3 text-right tabular-nums">{formatINR(c.cpc, 2)}</td>
                          <td className="p-3 text-right tabular-nums">{formatINR(c.cpm, 0)}</td>
                          <td className={`p-3 text-right tabular-nums ${getFrequencyColor(c.frequency)}`}>
                            {c.frequency.toFixed(2)}
                          </td>
                          <td className="p-3 text-right tabular-nums">{formatINR(c.daily_budget, 0)}</td>
                          <td className="p-3 text-right tabular-nums">{c.budget_utilization_pct.toFixed(1)}%</td>
                          <td className="p-3" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-1 justify-center">
                              {!isPaused ? (
                                <ExecutionButton
                                  action="PAUSE_CAMPAIGN"
                                  entityId={c.campaign_id}
                                  entityName={c.campaign_name}
                                  entityType="campaign"
                                  label=""
                                  variant="ghost"
                                  size="icon"
                                  icon={<Pause className="w-3.5 h-3.5" />}
                                  confirmMessage={`Pause campaign "${c.campaign_name}"?`}
                                  params={{ reason: "Manual pause from Campaigns page" }}
                                  className="h-7 w-7"
                                  data-testid={`button-pause-campaign-${c.campaign_id}`}
                                />
                              ) : (
                                <ExecutionButton
                                  action={activateAction}
                                  entityId={c.campaign_id}
                                  entityName={c.campaign_name}
                                  entityType="campaign"
                                  label=""
                                  variant="ghost"
                                  size="icon"
                                  icon={<Play className="w-3.5 h-3.5 text-emerald-400" />}
                                  confirmMessage={`Activate campaign "${c.campaign_name}"?`}
                                  params={{ reason: "Manual activation from Campaigns page" }}
                                  className="h-7 w-7"
                                  data-testid={`button-activate-campaign-${c.campaign_id}`}
                                />
                              )}
                              {!isPaused && (
                                <ExecutionButton
                                  action="SCALE_BUDGET_UP"
                                  entityId={c.campaign_id}
                                  entityName={c.campaign_name}
                                  entityType="campaign"
                                  label=""
                                  variant="ghost"
                                  size="icon"
                                  icon={<TrendingUp className="w-3.5 h-3.5 text-emerald-400" />}
                                  confirmMessage={`Scale up budget by 20% on "${c.campaign_name}"?\nCurrent daily budget: ${formatINR(c.daily_budget, 0)}`}
                                  params={{ scalePercent: 20, reason: "Manual scale up from Campaigns page" }}
                                  className="h-7 w-7"
                                  data-testid={`button-scaleup-campaign-${c.campaign_id}`}
                                />
                              )}
                              {!isPaused && (
                                <ExecutionButton
                                  action="SCALE_BUDGET_DOWN"
                                  entityId={c.campaign_id}
                                  entityName={c.campaign_name}
                                  entityType="campaign"
                                  label=""
                                  variant="ghost"
                                  size="icon"
                                  icon={<TrendingDown className="w-3.5 h-3.5 text-orange-400" />}
                                  confirmMessage={`Scale down budget by 20% on "${c.campaign_name}"?\nCurrent daily budget: ${formatINR(c.daily_budget, 0)}`}
                                  params={{ scalePercent: -20, reason: "Manual scale down from Campaigns page" }}
                                  className="h-7 w-7"
                                  data-testid={`button-scaledown-campaign-${c.campaign_id}`}
                                />
                              )}
                            </div>
                          </td>
                        </tr>
                        {isExpanded && c.score_breakdown && (
                          <tr key={`${c.campaign_id}-expanded`} className="border-b border-border/30 bg-muted/20">
                            <td colSpan={17} className="p-4">
                              <div className="space-y-3">
                                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                                  Health Score Breakdown — {c.campaign_name}
                                </p>
                                <div className="flex flex-wrap gap-3">
                                  {Object.entries(c.score_breakdown).map(([metric, score]) => {
                                    const band = c.score_bands?.[metric] || "unknown";
                                    const bandColor =
                                      band === "EXCELLENT" ? "text-emerald-400 bg-emerald-500/10" :
                                      band === "GOOD" ? "text-emerald-400 bg-emerald-500/10" :
                                      band === "WATCH" ? "text-amber-400 bg-amber-500/10" :
                                      band === "POOR" ? "text-red-400 bg-red-500/10" :
                                      "text-muted-foreground bg-muted/50";
                                    return (
                                      <div key={metric} className="flex items-center gap-2 p-2 rounded-md bg-card border border-border/30 min-w-[140px]">
                                        <div className="flex-1">
                                          <p className="text-[10px] text-muted-foreground capitalize">{metric.replace(/_/g, " ")}</p>
                                          <p className="text-sm font-semibold tabular-nums text-foreground">{typeof score === "number" ? score.toFixed(1) : String(score)}</p>
                                        </div>
                                        <Badge variant="secondary" className={`text-[9px] ${bandColor}`}>
                                          {band}
                                        </Badge>
                                      </div>
                                    );
                                  })}
                                </div>
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
              totalItems={campaigns.length}
              pageSize={pageSize}
              currentPage={page}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
