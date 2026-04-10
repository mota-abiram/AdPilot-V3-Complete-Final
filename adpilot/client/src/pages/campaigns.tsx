import { useState, useMemo, useEffect, Fragment } from "react";
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
import { ArrowUpDown, ChevronDown, ChevronUp, AlertCircle, AlertTriangle, Pause, Play, TrendingUp, TrendingDown, Loader2, SlidersHorizontal, BarChart3, Info } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { ScoreIndicator } from "@/components/score-indicator";
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
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

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

// ─── Benchmark comparison badge ─────────────────────────────────────
function BenchmarkBadge({ value, benchmark, label }: { value: number; benchmark: number; label?: string }) {
  if (!benchmark || !value) return null;
  const pct = ((value - benchmark) / benchmark) * 100;
  const isAbove = value > benchmark;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`inline-flex items-center text-[9px] font-medium px-1 py-0 rounded ml-1 cursor-default ${isAbove ? "text-red-400 bg-red-500/10" : "text-emerald-400 bg-emerald-500/10"}`}>
          {isAbove ? "▲" : "▼"} {Math.abs(Math.round(pct))}%
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="t-caption">
        {label || "Benchmark"}: {formatINR(benchmark, 0)} — {isAbove ? "Above" : "Within"} benchmark
      </TooltipContent>
    </Tooltip>
  );
}

export default function CampaignsPage() {
  const { 
    analysisData: data, 
    isLoadingAnalysis: isLoading, 
    activePlatform, 
    activeClient,
    benchmarks 
  } = useClient();
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
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [columnSize, setColumnSize] = useState<"compact" | "normal" | "wide">("normal");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [searchPage, setSearchPage] = useState(1);
  const [searchPageSize, setSearchPageSize] = useState(25);
  const [dgPage, setDgPage] = useState(1);
  const [dgPageSize, setDgPageSize] = useState(25);

  const getTargetCpl = (c: any) => {
    if (activePlatform === "google") {
      return (benchmarks as any)?.google?.cpl_target || 1500;
    }
    return (benchmarks as any)?.meta?.cpl_target || 800;
  };

  // campaign classification is now derived from the unified intelligence pipeline
  const getClassification = (c: any) => {
    return c.classification || "WATCH";
  };

  const campaigns = useMemo(() => {
    if (!data) return [];
    const source = (data as any).campaign_audit || (data as any).campaigns || [];
    if (!source) return [];
    let list = source.map((c: any) => ({ ...c }));

    if (filterLayer !== "ALL") {
      const fl = filterLayer.toLowerCase();
      list = list.filter((c: any) => {
        const l = (c.layer || "").toLowerCase();
        const ct = (c.campaign_type || "").toLowerCase();
        return l.includes(fl) || ct.includes(fl);
      });
    }
    if (filterStatus !== "ALL") {
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
      const t = (c.theme || c.layer || c.campaign_type || "").toLowerCase();
      return t.includes("branded") || t.includes("location") || t === "search";
    });
  }, [campaigns, isGoogle]);

  const getScoreColor = (c: any, metric: string, rawValColor?: string) => {
    const score = c.score_breakdown?.[metric];
    if (score == null) return rawValColor || "text-foreground";
    if (score >= 85) return "text-emerald-400";
    if (score >= 70) return "text-emerald-400";
    if (score >= 40) return "text-amber-400";
    return "text-red-400";
  };

  const dgCampaigns = useMemo(() => {
    if (!isGoogle) return [];
    return campaigns.filter((c: any) => {
      const t = (c.theme || c.layer || c.campaign_type || "").toLowerCase();
      return t.includes("demand") || t.includes("dg") || t.includes("demand_gen");
    });
  }, [campaigns, isGoogle]);

  const { data: pipelineData } = useQuery<{ insights: any[] }>({
    queryKey: ["/api/intelligence", activeClient?.id, activePlatform, "insights"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/intelligence/${activeClient?.id}/${activePlatform}/insights`);
      return res.json();
    },
    enabled: !!activeClient?.id && !!activePlatform,
  });

  const alerts = useMemo(() => {
     if (!pipelineData?.insights) return [];
     return pipelineData.insights.filter(i => i.priority === "CRITICAL" || i.priority === "HIGH");
  }, [pipelineData]);

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

  // ─── Google: search-specific columns (AdCortex Spec) ────────────────
  const googleSearchColumns = [
    { key: "campaign_name" as SortKey, label: "Campaign", align: "left", group: "Identity" },
    { key: "campaign_type" as SortKey, label: "Type", align: "left", group: "Identity" },
    { key: "classification" as SortKey, label: "Class", align: "left", group: "Identity" },
    { key: "health_score" as SortKey, label: "Health", align: "left", group: "Health" },
    { key: "status" as SortKey, label: "Status", align: "left", group: "Health" },
    { key: "bidding_strategy" as SortKey, label: "Bidding", align: "left", group: "Bidding & Budget" },
    { key: "target_cpa" as SortKey, label: "tCPA", align: "right", group: "Bidding & Budget" },
    { key: "daily_budget" as SortKey, label: "Budget", align: "right", group: "Bidding & Budget" },
    { key: "spend" as SortKey, label: "Spend", align: "right", group: "Performance" },
    { key: "impressions" as SortKey, label: "Impr.", align: "right", group: "Performance" },
    { key: "clicks" as SortKey, label: "Clicks", align: "right", group: "Performance" },
    { key: "leads" as SortKey, label: "Leads", align: "right", group: "Performance" },
    { key: "ctr" as SortKey, label: "CTR", align: "right", group: "Efficiency" },
    { key: "cvr" as SortKey, label: "CVR", align: "right", group: "Efficiency" },
    { key: "cpl" as SortKey, label: "CPL", align: "right", group: "Efficiency" },
    { key: "search_impression_share" as SortKey, label: "Imp. Share", align: "right", group: "Delivery" },
    { key: "search_rank_lost_is" as SortKey, label: "Rank Lost", align: "right", group: "Delivery" },
    { key: "search_budget_lost_is" as SortKey, label: "Budg. Lost", align: "right", group: "Delivery" },
  ];

  // ─── Google: DG-specific columns (AdCortex Spec) ────────────────────
  const googleDgColumns = [
    { key: "campaign_name" as SortKey, label: "Campaign", align: "left", group: "Identity" },
    { key: "campaign_type" as SortKey, label: "Type", align: "left", group: "Identity" },
    { key: "classification" as SortKey, label: "Class", align: "left", group: "Identity" },
    { key: "health_score" as SortKey, label: "Health", align: "left", group: "Health" },
    { key: "status" as SortKey, label: "Status", align: "left", group: "Health" },
    { key: "bidding_strategy" as SortKey, label: "Bidding", align: "left", group: "Bidding & Budget" },
    { key: "daily_budget" as SortKey, label: "Budget", align: "right", group: "Bidding & Budget" },
    { key: "spend" as SortKey, label: "Spend", align: "right", group: "Performance" },
    { key: "leads" as SortKey, label: "Leads", align: "right", group: "Performance" },
    { key: "tsr" as SortKey, label: "TSR", align: "right", group: "Performance" },
    { key: "vhr" as SortKey, label: "VHR", align: "right", group: "Performance" },
    { key: "ctr" as SortKey, label: "CTR", align: "right", group: "Efficiency" },
    { key: "cvr" as SortKey, label: "CVR", align: "right", group: "Efficiency" },
    { key: "cpl" as SortKey, label: "CPL", align: "right", group: "Efficiency" },
  ];


  const metaColumns = [
    { key: "campaign_name" as SortKey, label: "Campaign", align: "left", group: "Identity" },
    { key: "layer" as SortKey, label: "Layer", align: "left", group: "Identity" },
    { key: "classification" as SortKey, label: "Class", align: "left", group: "Identity" },
    { key: "learning_status" as SortKey, label: "Learn", align: "left", group: "Identity" },
    { key: "delivery_status" as SortKey, label: "Deliv", align: "left", group: "Identity" },
    { key: "health_score" as SortKey, label: "Health", align: "left", group: "Health" },
    { key: "daily_budget" as SortKey, label: "Budget", align: "right", group: "Bidding & Budget" },
    { key: "spend" as SortKey, label: "Spend", align: "right", group: "Performance" },
    { key: "leads" as SortKey, label: "Leads", align: "right", group: "Performance" },
    { key: "cpl" as SortKey, label: "CPL", align: "right", group: "Performance" },
    { key: "ctr" as SortKey, label: "CTR", align: "right", group: "Efficiency" },
    { key: "cpc" as SortKey, label: "CPC", align: "right", group: "Efficiency" },
    { key: "cpm" as SortKey, label: "CPM", align: "right", group: "Efficiency" },
    { key: "frequency" as SortKey, label: "Freq", align: "right", group: "Delivery" },
    { key: "budget_utilization_pct" as SortKey, label: "Utility", align: "right", group: "Delivery" },
  ];

  // ─── Render a campaign table cell (reusable helper) ───────────────
  function renderCell(c: any, col: { key: SortKey, align: string, label: string }, sectionType: "search" | "dg") {
    const isSearch = sectionType === "search";

    const val = c[col.key];

    // Edge case handling
    const impressions = c.impressions || 0;
    const health = c.health_score || 0;

    if (col.key === "campaign_type") {
      const typeInfo = getCampaignTypeBadge(val);
      return (
        <td key={col.key} className="p-3">
          <Badge variant="outline" className={`${typeInfo.bg} ${typeInfo.text} border-transparent text-[10px] uppercase font-bold`}>
            {typeInfo.label}
          </Badge>
        </td>
      );
    }

    if (col.key === "status") {
      const isActive = val === "ENABLED" || val === "ACTIVE";
      return (
        <td key={col.key} className="p-3">
          <Badge variant={isActive ? "outline" : "secondary"} className={`text-[9px] px-1 py-0 ${isActive ? "text-emerald-400 border-emerald-500/30" : "text-red-400"}`}>
            {val}
          </Badge>
        </td>
      );
    }

    if (col.key === "classification") return <td key={col.key} className="p-3"><StatusBadge classification={val} /></td>;

    if (col.key === "health_score") return (
      <td key={col.key} className="p-3">
        <ScoreIndicator
          score={health}
          breakdown={c.score_breakdown}
          label={isSearch ? "Search Health" : "DG Health"}
        />
      </td>
    );

    if (col.key === "bidding_strategy") return <td key={col.key} className="p-3 text-[10px] text-muted-foreground uppercase">{val || "—"}</td>;

    const rowIsPct = ["ctr", "cvr", "search_impression_share", "search_rank_lost_is", "search_budget_lost_is", "top_is", "tsr", "vhr", "ptr"].includes(col.key as string);
    const rowIsINR = ["daily_budget", "cost", "spend", "cpl", "avg_cpc", "average_cpm", "target_cpa", "cpsv"].includes(col.key as string);

    let displayVal: React.ReactNode = val ?? "—";
    let colorClass = "";

    if (rowIsPct) {
      if (impressions === 0 && ["ctr", "cvr"].includes(col.key as string)) return <td key={col.key} className="p-3 text-right text-muted-foreground/40 italic text-[10px]">No Delivery</td>;
      
      if (typeof val === "number") {
        const pctValue = val < 1 && val > 0 ? val * 100 : val;
        displayVal = `${pctValue.toFixed(col.key === "ctr" ? 2 : 1)}%`;
        
        if (col.key === "ctr") {
          const rawCtr = val < 1 ? val : val / 100;
          colorClass = rawCtr >= (isSearch ? 0.015 : 0.008) ? "text-emerald-400" : rawCtr >= 0.004 ? "text-amber-400" : "text-red-400";
        } else if (col.key === "search_budget_lost_is") {
          colorClass = pctValue > 30 ? "text-red-400" : pctValue > 10 ? "text-amber-400" : "text-emerald-400";
        }
      }
    } else if (rowIsINR) {
      if (col.key === "cpl" && (c.leads || c.conversions || 0) === 0 && (c.spend || c.cost || 0) > 0) {
        displayVal = "∞";
        colorClass = "text-red-400";
      } else {
        displayVal = formatINR(val ?? 0, (col.key === "avg_cpc" || col.key === "average_cpm") ? 2 : 0);
        if (col.key === "cpl") {
          colorClass = getCplColor(val, thresholds);
        }
      }
    } else if (typeof val === "number") {
      displayVal = formatNumber(val);
    }

    return (
      <td key={col.key} className={`p-3 tabular-nums ${col.align === "right" ? "text-right" : "text-left"} ${colorClass}`}>
        {displayVal}
      </td>
    );
  }


  function renderGoogleRow(c: any, sectionType: "search" | "dg") {
    const isPaused = c.status === "PAUSED" || c.delivery_status === "NOT_DELIVERING" || isEntityPaused(c.campaign_id);
    const isSelected = selectedIds.has(c.campaign_id);
    const isExpanded = expandedIds.has(c.campaign_id);
    const columns = sectionType === "search" ? googleSearchColumns : googleDgColumns;

    return (
      <Fragment key={c.campaign_id || c.id}>
        <tr
          key={c.campaign_id}
          className={`border-b border-border/30 hover:bg-muted/30 transition-colors cursor-pointer ${isSelected ? "bg-primary/5" : ""
            } ${isPaused ? "opacity-50" : ""} ${getClassification(c) === "UNDERPERFORMER" ? "border-l-4 border-l-red-500" : ""}`}
          onClick={() => {
            setExpandedIds(prev => {
              const next = new Set(prev);
              if (next.has(c.campaign_id)) next.delete(c.campaign_id);
              else next.add(c.campaign_id);
              return next;
            });
          }}
          data-testid={`row-campaign-${c.campaign_id}`}
        >
          <td className="p-3" onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => toggleSelect(c.campaign_id)}
              data-testid={`checkbox-campaign-${c.campaign_id}`}
            />
          </td>

          {/* Main Table Body: Render all columns via renderCell */}
          {columns.map(col => {
            if (col.key === "campaign_name") {
              return (
                <td key={col.key} className="p-3 max-w-[200px]">
                  <div className="flex items-center gap-1.5">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="truncate block cursor-default text-foreground font-bold">
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
                </td>
              );
            }
            return renderCell(c, col, sectionType);
          })}

          {/* Execution Actions Cell */}
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
            </div>
          </td>
        </tr>
        {isExpanded && (
          <tr key={`${c.campaign_id}-expanded`} className="border-b border-border/30 bg-muted/20">
            <td colSpan={columns.length + 2} className="p-4">
              <div className="space-y-3">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Health Score Breakdown — {c.campaign_name || c.name}
                </p>
                {c.score_breakdown ? (
                  <div className="flex flex-wrap gap-3">
                    {Object.entries(c.score_breakdown).map(([metric, score]) => {
                      let band = (c.score_bands?.[metric] || "UNKNOWN").toUpperCase();

                      if (band === "UNKNOWN" && typeof score === "number") {
                        if (score >= 85) band = "EXCELLENT";
                        else if (score >= 70) band = "GOOD";
                        else if (score >= 40) band = "WATCH";
                        else band = "POOR";
                      }

                      const bandColor =
                        band === "EXCELLENT" ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30" :
                          band === "GOOD" ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" :
                            band === "WATCH" ? "text-amber-400 bg-amber-500/10 border-amber-500/20" :
                              band === "POOR" ? "text-red-400 bg-red-500/10 border-red-500/20" :
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
      </Fragment>
    );
  }

  // ─── Google campaign table (used for each section) ────────────────
  function renderGoogleTable(rows: any[], sectionId: string, sectionType: "search" | "dg", pg: number, pgSize: number, setPg: (p: number) => void, setPgSize: (s: number) => void) {
    const columns = sectionType === "search" ? googleSearchColumns : googleDgColumns;
    const paginatedRows = pgSize >= rows.length ? rows : rows.slice((pg - 1) * pgSize, pg * pgSize);

    // Group columns for header
    const groups: Record<string, number> = {};
    columns.forEach(c => {
      const g = (c as any).group || "Other";
      groups[g] = (groups[g] || 0) + 1;
    });

    return (
      <Card>
        <CardContent className="card-content-premium p-0">
          <div className="overflow-x-auto">
            <table className="t-table w-full" data-testid={`table-${sectionId}`}>
              <thead>
                {/* Group Labels Header Row */}
                <tr className="border-b border-border/10 bg-muted/5">
                  <th className="p-1 w-8"></th>
                  {Object.entries(groups).map(([name, span]) => (
                    <th key={name} colSpan={span} className="px-4 py-1.5 text-[9px] font-black uppercase tracking-[0.1em] text-muted-foreground/60 border-r border-border/20 last:border-0 text-center">
                      {name}
                    </th>
                  ))}
                  <th className="p-1"></th>
                </tr>
                <tr className="border-b border-border/50 bg-muted/20">
                  <th className="p-3 w-8">
                    <div className="flex flex-col gap-2">
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
                    </div>
                  </th>
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      className={`px-4 py-3 t-label font-bold uppercase tracking-widest text-muted-foreground/80 cursor-pointer select-none whitespace-nowrap border-r border-border/5 last:border-0 ${col.align === "right" ? "text-right" : "text-left"
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
                  <th className="px-4 py-3 t-label font-bold uppercase tracking-widest text-muted-foreground/80 text-center whitespace-nowrap">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginatedRows.map((c: any) => renderGoogleRow(c, sectionType))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={columns.length + 2} className="p-8 text-center text-xs text-muted-foreground">
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
            <AlertDialogDescription className="t-body">
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

      {/* ─── Unified Pipeline Alerts ──────────────────────────────────── */}
      {alerts.length > 0 && (
        <Card className="border-red-500/30 bg-red-500/5" data-testid="card-alerts-banner">
          <CardContent className="card-content-premium space-y-2">
            <p className="t-label font-semibold text-red-400 flex items-center gap-1.5 uppercase tracking-widest text-[10px]">
              <AlertTriangle className="w-4 h-4" />
              {alerts.length} Intelligence Pipeline Alert{alerts.length !== 1 ? "s" : ""}
            </p>
            <div className="space-y-1.5">
              {alerts.map((alert: any, idx: number) => (
                <div key={idx} className="flex items-start gap-2 t-caption">
                  <span className={cn("mt-0.5 shrink-0 px-1 py-0 rounded text-[9px] font-black", alert.priority === "CRITICAL" ? "bg-red-500/20 text-red-400" : "bg-amber-500/20 text-amber-400")}>
                    {alert.priority}
                  </span>
                  <div className="min-w-0">
                    <p className="text-red-300 font-bold">{alert.issue}</p>
                    <p className="text-red-400/80 text-[10px]">{alert.impact} → <span className="text-primary font-bold">{alert.recommendation}</span></p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="t-page-title text-foreground">Campaigns</h1>
          <p className="t-caption text-muted-foreground">
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
            className="t-caption"
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
            className="t-caption"
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
            {renderGoogleTable(searchCampaigns, "search-campaigns", "search", searchPage, searchPageSize, setSearchPage, setSearchPageSize)}
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
            {renderGoogleTable(dgCampaigns, "dg-campaigns", "dg", dgPage, dgPageSize, setDgPage, setDgPageSize)}
          </div>
        </div>
      ) : (
        /* ─── Meta: Original single table ──────────────────────────── */
        <Card>
          <CardContent className="card-content-premium p-0">
            <div className="overflow-x-auto">
              <table className="t-table w-full">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="p-3 w-8">
                      <div className="flex flex-col gap-2">
                        <Checkbox
                          checked={campaigns.length > 0 && selectedIds.size === campaigns.length}
                          onCheckedChange={toggleSelectAll}
                          data-testid="checkbox-select-all"
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
                    {metaColumns.map((col) => (
                      <th
                        key={col.key}
                        className={`px-4 py-4 t-label font-bold uppercase tracking-widest text-muted-foreground/80 cursor-pointer select-none whitespace-nowrap ${col.align === "right" ? "text-right" : "text-left"
                          }`}
                        onClick={() => toggleSort(col.key)}
                      >
                        <span className="inline-flex items-center gap-1">
                          {col.label}
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
                  {(pageSize >= campaigns.length ? campaigns : campaigns.slice((page - 1) * pageSize, page * pageSize)).map((c: any) => {
                    const isPaused = c.status === "PAUSED" || c.delivery_status === "NOT_DELIVERING" || isEntityPaused(c.campaign_id);
                    const isSelected = selectedIds.has(c.campaign_id);
                    const isExpanded = expandedIds.has(c.campaign_id);
                    const activateAction = "UNPAUSE_CAMPAIGN";

                    return (
                      <Fragment key={c.campaign_id}>
                        <tr
                          key={c.campaign_id}
                          className={`border-b border-border/30 hover:bg-muted/30 transition-colors cursor-pointer ${isSelected ? "bg-primary/5" : ""
                            } ${isPaused ? "opacity-50" : ""}`}
                          onClick={() => {
                            setExpandedIds(prev => {
                              const next = new Set(prev);
                              if (next.has(c.campaign_id)) next.delete(c.campaign_id);
                              else next.add(c.campaign_id);
                              return next;
                            });
                          }}
                          data-testid={`row-campaign-${c.campaign_id}`}
                        >
                          <td className="p-3" onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleSelect(c.campaign_id)}
                              data-testid={`checkbox-campaign-${c.campaign_id}`}
                            />
                          </td>

                      {metaColumns.map((col) => {
                        if (col.key === "campaign_name") {
                            return (
                                <td key={col.key} className="p-3 max-w-[200px]">
                                    <div className="flex items-center gap-1.5">
                                        <span className="truncate block cursor-default text-foreground font-bold">
                                            {(c.campaign_name || c.name || "Unknown").substring(0, 30)}
                                        </span>
                                        {c.status === "PAUSED" && (
                                            <Badge variant="secondary" className="text-[9px] px-1 py-0 text-red-400">PAUSED</Badge>
                                        )}
                                    </div>
                                </td>
                            );
                        }
                        
                        const val = c[col.key];
                        if (col.key === "health_score") return (
                            <td key={col.key} className="p-3">
                                <ScoreIndicator 
                                    score={val} 
                                    breakdown={c.score_breakdown} 
                                    label="Meta Health"
                                />
                            </td>
                        );
                        if (col.key === "classification") return <td key={col.key} className="p-3"><StatusBadge classification={val} /></td>;
                        if (["layer", "learning_status", "delivery_status"].includes(col.key as string)) return <td key={col.key} className="p-3"><Badge variant="outline" className="text-[9px] px-1 py-0 text-muted-foreground">{val || "—"}</Badge></td>;

                        const rowIsINR = ["spend", "cpl", "cpc", "cpm", "daily_budget"].includes(col.key as string);
                        const rowIsPct = ["ctr", "budget_utilization_pct"].includes(col.key as string);
                        
                        return (
                            <td key={col.key} className={`p-3 tabular-nums ${col.align === "right" ? "text-right" : "text-left"}`}>
                                {rowIsINR ? formatINR(val || 0, col.key === "cpc" ? 2 : 0) : 
                                 rowIsPct ? `${(val || 0).toFixed(col.key === "ctr" ? 2 : 1)}%` : 
                                 typeof val === "number" ? val.toFixed(2) : val || "—"}
                            </td>
                        );
                      })}
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
                                    let band = (c.score_bands?.[metric] || "UNKNOWN").toUpperCase();

                                    // Fallback: Calculate band from score if unknown
                                    if (band === "UNKNOWN" && typeof score === "number") {
                                      if (score >= 85) band = "EXCELLENT";
                                      else if (score >= 70) band = "GOOD";
                                      else if (score >= 40) band = "WATCH";
                                      else band = "POOR";
                                    }

                                    const bandColor =
                                      band === "EXCELLENT" ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30" :
                                        band === "GOOD" ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" :
                                          band === "WATCH" ? "text-amber-400 bg-amber-500/10 border-amber-500/20" :
                                            band === "POOR" ? "text-red-400 bg-red-500/10 border-red-500/20" :
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
                      </Fragment>
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
