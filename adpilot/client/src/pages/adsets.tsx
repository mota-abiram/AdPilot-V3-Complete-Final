import { useState, useMemo, useEffect } from "react";
import { useClient } from "@/lib/client-context";
import { DataTablePagination } from "@/components/data-table-pagination";
import type { AdsetAnalysis } from "@shared/schema";
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
import { ArrowUpDown, ChevronDown, ChevronUp, AlertCircle, Pause, Play, TrendingUp, TrendingDown, Loader2, SlidersHorizontal } from "lucide-react";
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
  truncate,
} from "@/lib/format";
import { useExecution } from "@/hooks/use-execution";
import { ExecutionButton } from "@/components/execution-button";
import { usePausedEntities } from "@/hooks/use-paused-entities";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type SortKey = keyof AdsetAnalysis;
type SortDir = "asc" | "desc";

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
      <TooltipContent side="top" className="text-xs">
        {label || "Benchmark"}: {formatINR(benchmark, 0)} — {isAbove ? "Above" : "Within"} benchmark
      </TooltipContent>
    </Tooltip>
  );
}

export default function AdsetsPage() {
  const { analysisData: data, isLoadingAnalysis: isLoading, activePlatform, benchmarks } = useClient();
  const { executeBatch, isExecuting } = useExecution();
  const { isPaused: isEntityPaused } = usePausedEntities();
  const isGoogle = activePlatform === "google";
  const entityLabel = isGoogle ? "Ad Group" : "Adset";
  const entityLabelPlural = isGoogle ? "Ad Groups" : "Adsets";

  const [sortKey, setSortKey] = useState<SortKey>("health_score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  
  // URL Parameter Handling
  const queryParams = new URLSearchParams(window.location.hash.split("?")[1] || "");
  const initialFilter = queryParams.get("filter")?.toUpperCase() || "ALL";
  const initialCampaignId = queryParams.get("campaignId") || "ALL";

  const [filterLayer, setFilterLayer] = useState<string>("ALL");
  const [filterClassification, setFilterClassification] = useState<string>(initialFilter);
  const [filterLearning, setFilterLearning] = useState<string>("ALL");
  const [filterCampaign, setFilterCampaign] = useState<string>(initialCampaignId);
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
  
  // Force classification filter sync if URL brand changes
  useEffect(() => {
    const q = new URLSearchParams(window.location.hash.split("?")[1] || "");
    const f = q.get("filter")?.toUpperCase();
    if (f && f !== filterClassification) setFilterClassification(f);
    const cid = q.get("campaignId");
    if (cid && cid !== filterCampaign) setFilterCampaign(cid);
  }, [window.location.hash]);

  // Reset page when filters change
  useEffect(() => { setPage(1); setSearchPage(1); setDgPage(1); }, [filterLayer, filterClassification, filterLearning, filterCampaign]);

  // For Google: use ad_group_analysis (normalized by server transform layer)
  const googleAdGroups = useMemo(() => {
    if (!isGoogle || !data) return [];
    // ad_group_analysis is now always populated by the server normalization layer
    return (data as any)?.ad_group_analysis || [];
  }, [data, isGoogle]);

  // Campaign list for dropdown (Google only)
  const campaignList = useMemo(() => {
    if (!isGoogle || !data) return [];
    const campaigns = (data as any)?.campaigns || [];
    return campaigns.map((c: any) => ({
      id: c.id || c.campaign_id,
      name: c.name || c.campaign_name,
      type: c.campaign_type,
    }));
  }, [data, isGoogle]);

  const adsets = useMemo(() => {
    const source = isGoogle ? googleAdGroups : data?.adset_analysis;
    if (!source) return [];
    let list = [...source];

    // Filter to ACTIVE/ENABLED, or PAUSED with spend > 0 in current cadence window
    list = list.filter((a: any) => {
      const status = (a.status || "").toUpperCase();
      if (status === "ACTIVE" || status === "ENABLED" || !status) return true;
      if (status === "PAUSED" && (a.spend || a.cost || 0) > 0) return true;
      return false;
    });
    if (isGoogle && filterCampaign !== "ALL") {
      list = list.filter((a: any) => (a.campaign_id || a.campaign_name) === filterCampaign);
    }

    if (filterLayer !== "ALL") list = list.filter((a) => a.layer === filterLayer);
    if (filterClassification !== "ALL") list = list.filter((a) => a.classification === filterClassification);
    if (filterLearning !== "ALL") list = list.filter((a) => a.learning_status === filterLearning);
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
  }, [data, googleAdGroups, sortKey, sortDir, filterLayer, filterClassification, filterLearning, filterCampaign, isGoogle]);

  // Google: separate search and DG ad groups
  const searchAdGroups = useMemo(() => {
    if (!isGoogle) return [];
    return adsets.filter((a: any) => a.campaign_type === "branded" || a.campaign_type === "location");
  }, [adsets, isGoogle]);

  const dgAdGroups = useMemo(() => {
    if (!isGoogle) return [];
    return adsets.filter((a: any) => a.campaign_type === "demand_gen");
  }, [adsets, isGoogle]);

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
    if (selectedIds.size === adsets.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(adsets.map((a: any) => isGoogle ? a.ad_group_id : a.adset_id)));
    }
  }

  async function handleBulkAction(action: "pause" | "activate") {
    setBulkConfirm({ open: false, action: "pause" });
    const getId = (a: any) => isGoogle ? a.ad_group_id : a.adset_id;
    const getName = (a: any) => isGoogle ? a.ad_group_name : a.adset_name;
    const selectedAdsets = adsets.filter((a: any) => selectedIds.has(getId(a)));
    const pauseAction = isGoogle ? "PAUSE_AD_GROUP" : "PAUSE_ADSET";
    const activateAction = isGoogle ? "ENABLE_AD_GROUP" : "UNPAUSE_ADSET";
    const entityType = isGoogle ? "ad_group" : "adset";
    const actions = selectedAdsets.map((a: any) => ({
      action: action === "pause" ? pauseAction : activateAction,
      entityId: getId(a),
      entityName: getName(a),
      entityType: entityType as any,
      params: { reason: `Bulk ${action} from ${entityLabelPlural} page` },
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

  const sourceCheck = isGoogle ? googleAdGroups : data?.adset_analysis;
  if (!sourceCheck || sourceCheck.length === 0) {
    return (
      <div className="p-6 space-y-4 max-w-[1600px]">
        <div>
          <h1 className="text-lg font-semibold text-foreground">{entityLabelPlural}</h1>
          <p className="text-xs text-muted-foreground">No {entityLabel.toLowerCase()} data available for this analysis period.</p>
        </div>
      </div>
    );
  }

  const thresholds = data.dynamic_thresholds;
  const hasSelection = selectedIds.size > 0;

  // Google ad group columns
  const googleAgColumns = [
    { key: ("ad_group_name") as SortKey, label: "Ad Group", align: "left" },
    { key: "campaign_name" as SortKey, label: "Campaign", align: "left" },
    { key: "campaign_type" as SortKey, label: "Type", align: "left" },
    { key: "impressions" as SortKey, label: "Impr", align: "right" },
    { key: "clicks" as SortKey, label: "Clicks", align: "right" },
    { key: "cost" as SortKey, label: "Spend", align: "right" },
    { key: "conversions" as SortKey, label: "Conv", align: "right" },
    { key: "ctr" as SortKey, label: "CTR", align: "right" },
    { key: "cvr" as SortKey, label: "CVR", align: "right" },
    { key: "cpc" as SortKey, label: "CPC", align: "right" },
    { key: "cpl" as SortKey, label: "CPL", align: "right" },
    { key: "quality_score" as SortKey, label: "QS", align: "right" },
    { key: "health_score" as SortKey, label: "Score", align: "left" },
  ];

  // Meta columns (original)
  const metaColumns = [
    { key: ("adset_name") as SortKey, label: entityLabel, align: "left" },
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

  // ─── Render Google ad group row ───────────────────────────────────
  function renderGoogleAgRow(a: any) {
    const entityId = a.ad_group_id || a.id;
    const entityName = a.ad_group_name || a.name;
    const isPaused = isEntityPaused(entityId);
    const isSelected = selectedIds.has(entityId);
    const typeBadge = a.campaign_type === "branded"
      ? { bg: "bg-purple-500/15", text: "text-purple-400" }
      : a.campaign_type === "demand_gen"
      ? { bg: "bg-amber-500/15", text: "text-amber-400" }
      : { bg: "bg-blue-500/15", text: "text-blue-400" };

    return (
      <tr
        key={entityId}
        className={`border-b border-border/30 hover:bg-muted/30 transition-colors ${
          isSelected ? "bg-primary/5" : ""
        } ${isPaused ? "opacity-50" : ""} ${a.should_pause || a.classification === "LOSER" ? "border-l-2 border-l-red-500" : ""}`}
        data-testid={`row-adgroup-${entityId}`}
      >
        <td className="p-3" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => toggleSelect(entityId)}
            data-testid={`checkbox-adgroup-${entityId}`}
          />
        </td>
        <td className={`p-3 transition-all duration-200 ${
          columnSize === "compact" ? "max-w-[120px]" : 
          columnSize === "normal" ? "max-w-[180px]" : "max-w-[400px]"
        }`}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="truncate block cursor-default text-foreground">{truncate(entityName, 28)}</span>
            </TooltipTrigger>
            <TooltipContent side="top"><p className="text-xs max-w-sm">{entityName}</p></TooltipContent>
          </Tooltip>
          {(a.should_pause || a.classification === "LOSER") && (
            <div className="mt-1">
              <Badge variant="destructive" className="text-[9px] px-1 py-0">
                Recommended: Pause
              </Badge>
            </div>
          )}
        </td>
        <td className="p-3 max-w-[150px]">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="truncate block cursor-default text-muted-foreground">{truncate(a.campaign_name, 22)}</span>
            </TooltipTrigger>
            <TooltipContent side="top"><p className="text-xs max-w-sm">{a.campaign_name}</p></TooltipContent>
          </Tooltip>
        </td>
        <td className="p-3">
          <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${typeBadge.bg} ${typeBadge.text}`}>
            {a.campaign_type || "—"}
          </span>
        </td>
        <td className="p-3 text-right tabular-nums text-muted-foreground">{formatNumber(a.impressions || 0)}</td>
        <td className="p-3 text-right tabular-nums">{formatNumber(a.clicks || 0)}</td>
        <td className="p-3 text-right tabular-nums">{formatINR(a.cost || a.spend || 0, 0)}</td>
        <td className="p-3 text-right tabular-nums">{a.conversions ?? a.leads ?? 0}</td>
        <td className="p-3 text-right tabular-nums">
          <span className={(a.ctr || 0) < 1 ? "text-red-400" : "text-foreground"}>
            {formatPct(a.ctr || 0)}
          </span>
        </td>
        <td className="p-3 text-right tabular-nums">
          {a.cvr != null ? formatPct(a.cvr) : "—"}
        </td>
        <td className="p-3 text-right tabular-nums">{formatINR(a.cpc || 0, 2)}</td>
        <td className={`p-3 text-right tabular-nums ${(a.cpl || 0) > 0 ? getCplColor(a.cpl, thresholds) : "text-foreground"}`}>
          {(a.cpl || 0) > 0 ? formatINR(a.cpl, 0) : "—"}
          {(a.cpl || 0) > 0 && benchmarks?.cpl && (
            <BenchmarkBadge value={a.cpl} benchmark={benchmarks.cpl} label="CPL Target" />
          )}
        </td>
        <td className="p-3 text-right tabular-nums">
          {(() => {
            const qs = a.quality_score ?? a.avg_quality_score;
            if (qs == null) return "—";
            const color = qs >= 7 ? "text-emerald-400" : qs >= 4 ? "text-amber-400" : "text-red-400";
            return <span className={color}>{qs}</span>;
          })()}
        </td>
        <td className="p-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-2">
                {(a.health_score != null) ? (
                  <>
                    <div className={`w-10 h-1.5 rounded-full ${a.health_score >= 70 ? "bg-emerald-500/20" : a.health_score >= 40 ? "bg-amber-500/20" : "bg-red-500/20"}`}>
                      <div className={`h-full rounded-full ${a.health_score >= 70 ? "bg-emerald-500" : a.health_score >= 40 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${Math.min(a.health_score, 100)}%` }} />
                    </div>
                    <span className="tabular-nums text-muted-foreground w-5 text-[10px]">{a.health_score}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              <div className="text-xs space-y-1">
                <p className="font-medium">Google Ad Group Scoring</p>
                <p className="text-muted-foreground">CPL: 30% · QS: 20% · CVR: 20%</p>
                <p className="text-muted-foreground">CTR: 15% · IS: 15%</p>
              </div>
            </TooltipContent>
          </Tooltip>
        </td>
        <td className="p-3" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1 justify-center">
            {!isPaused ? (
              <ExecutionButton
                action="PAUSE_AD_GROUP"
                entityId={entityId}
                entityName={entityName}
                entityType="ad_group"
                label=""
                variant="ghost"
                size="icon"
                icon={<Pause className="w-3.5 h-3.5" />}
                confirmMessage={`Pause ad group "${entityName}"?`}
                params={{ reason: "Manual pause from Ad Groups page" }}
                className="h-7 w-7"
                data-testid={`button-pause-adgroup-${entityId}`}
              />
            ) : (
              <ExecutionButton
                action="ENABLE_AD_GROUP"
                entityId={entityId}
                entityName={entityName}
                entityType="ad_group"
                label=""
                variant="ghost"
                size="icon"
                icon={<Play className="w-3.5 h-3.5 text-emerald-400" />}
                confirmMessage={`Activate ad group "${entityName}"?`}
                params={{ reason: "Manual activation from Ad Groups page" }}
                className="h-7 w-7"
                data-testid={`button-activate-adgroup-${entityId}`}
              />
            )}
            {!isPaused && (
              <ExecutionButton
                action="SCALE_BUDGET_UP"
                entityId={entityId}
                entityName={entityName}
                entityType="ad_group"
                label=""
                variant="ghost"
                size="icon"
                icon={<TrendingUp className="w-3.5 h-3.5 text-emerald-400" />}
                confirmMessage={`Scale up budget by 25% on ad group "${entityName}"?`}
                params={{ scalePercent: 25, reason: "Manual scale up from Ad Groups page" }}
                className="h-7 w-7"
                data-testid={`button-scaleup-adgroup-${entityId}`}
              />
            )}
            {!isPaused && (
              <ExecutionButton
                action="SCALE_BUDGET_DOWN"
                entityId={entityId}
                entityName={entityName}
                entityType="ad_group"
                label=""
                variant="ghost"
                size="icon"
                icon={<TrendingDown className="w-3.5 h-3.5 text-orange-400" />}
                confirmMessage={`Scale down budget by 25% on ad group "${entityName}"?`}
                params={{ scalePercent: -25, reason: "Manual scale down from Ad Groups page" }}
                className="h-7 w-7"
                data-testid={`button-scaledown-adgroup-${entityId}`}
              />
            )}
          </div>
        </td>
      </tr>
    );
  }

  // ─── Render Google ad group table ─────────────────────────────────
  function renderGoogleAgTable(rows: any[], sectionId: string, pg: number, pgSize: number, setPg: (p: number) => void, setPgSize: (s: number) => void) {
    const paginatedRows = pgSize >= rows.length ? rows : rows.slice((pg - 1) * pgSize, pg * pgSize);
    return (
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid={`table-${sectionId}`}>
              <thead>
                <tr className="border-b border-border/50">
                  <th className="p-3 w-8">
                    <div className="flex flex-col gap-2">
                       <Checkbox
                        checked={rows.length > 0 && rows.every((a: any) => selectedIds.has(a.ad_group_id || a.id))}
                        onCheckedChange={() => {
                          const ids = rows.map((a: any) => a.ad_group_id || a.id);
                          const allSelected = ids.every((id) => selectedIds.has(id));
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            ids.forEach((id) => allSelected ? next.delete(id) : next.add(id));
                            return next;
                          });
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
                  {googleAgColumns.map((col) => (
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
                {paginatedRows.map((a: any) => renderGoogleAgRow(a))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={15} className="p-8 text-center text-xs text-muted-foreground">
                      No ad groups in this section.
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
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {bulkConfirm.action === "pause" ? "Pause" : "Activate"} {selectedIds.size} {entityLabelPlural}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will {bulkConfirm.action === "pause" ? "pause" : "activate"} {selectedIds.size} selected {entityLabel.toLowerCase()}{selectedIds.size !== 1 ? "s" : ""} on {isGoogle ? "Google Ads" : "Meta Ads"}.
              {bulkConfirm.action === "pause" && (
                <span className="block mt-1 text-amber-500">Paused {entityLabel.toLowerCase()}s will stop delivering immediately.</span>
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

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-foreground">{entityLabelPlural}</h1>
          <p className="text-xs text-muted-foreground">
            {adsets.length} active {entityLabel.toLowerCase()}s{isGoogle ? " (paused/removed filtered out)" : ` · ${sourceCheck.length} total`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Google: Campaign dropdown filter */}
          {isGoogle && campaignList.length > 0 && (
            <select
              className="px-2 py-1.5 text-xs rounded-md bg-muted/50 border border-border/50 text-foreground"
              value={filterCampaign}
              onChange={(e) => setFilterCampaign(e.target.value)}
              data-testid="select-filter-campaign"
            >
              <option value="ALL">All Campaigns</option>
              {campaignList.map((c: any) => (
                <option key={c.id} value={c.id || c.name}>
                  {truncate(c.name, 35)} ({c.type})
                </option>
              ))}
            </select>
          )}

          {/* Meta: Layer/Classification/Learning filters */}
          {!isGoogle && (
            <>
              <select
                className="px-2 py-1.5 text-xs rounded-md bg-muted/50 border border-border/50 text-foreground"
                value={filterLayer}
                onChange={(e) => setFilterLayer(e.target.value)}
                data-testid="select-filter-layer"
              >
                <option value="ALL">All Layers</option>
                <option value="TOFU">TOFU</option>
                <option value="MOFU">MOFU</option>
                <option value="BOFU">BOFU</option>
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
                <option value="NEW">New</option>
              </select>
              <select
                className="px-2 py-1.5 text-xs rounded-md bg-muted/50 border border-border/50 text-foreground"
                value={filterLearning}
                onChange={(e) => setFilterLearning(e.target.value)}
                data-testid="select-filter-learning"
              >
                <option value="ALL">All Learning Status</option>
                <option value="ACTIVE">Active</option>
                <option value="LEARNING_LIMITED">Learning Limited</option>
              </select>
            </>
          )}
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

      {/* ─── Google: Split into Search + DG ──────────────────────── */}
      {isGoogle ? (
        <div className="space-y-6">
          {/* Search Ad Groups */}
          <div>
            <h2 className="text-sm font-semibold text-foreground mb-3">
              Search Ad Groups
              <span className="text-[10px] text-muted-foreground font-normal ml-2">{searchAdGroups.length} ad groups</span>
            </h2>
            {renderGoogleAgTable(searchAdGroups, "search-adgroups", searchPage, searchPageSize, setSearchPage, setSearchPageSize)}
          </div>

          {/* DG Ad Groups */}
          <div>
            <h2 className="text-sm font-semibold text-foreground mb-3">
              Demand Gen Ad Groups
              <span className="text-[10px] text-muted-foreground font-normal ml-2">{dgAdGroups.length} ad groups</span>
            </h2>
            {renderGoogleAgTable(dgAdGroups, "dg-adgroups", dgPage, dgPageSize, setDgPage, setDgPageSize)}
          </div>
        </div>
      ) : (
        /* ─── Meta: Original table ─────────────────────────────── */
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="p-3 w-8">
                      <div className="flex flex-col gap-2">
                        <Checkbox
                          checked={adsets.length > 0 && selectedIds.size === adsets.length}
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
                  {(pageSize >= adsets.length ? adsets : adsets.slice((page - 1) * pageSize, page * pageSize)).map((a: any) => {
                    const layer = getLayerColor(a.layer);
                    const classColor = getClassificationColor(a.classification);
                    const learningColor = getLearningStatusColor(a.learning_status);
                    const entityId = a.adset_id;
                    const entityName = a.adset_name;
                    const isPaused = a.delivery_status === "NOT_DELIVERING" || a.delivery_status === "PAUSED" || a.status === "PAUSED" || isEntityPaused(entityId);
                    const isSelected = selectedIds.has(entityId);
                    const isExpanded = expandedIds.has(entityId);

                    return (
                      <>
                      <tr
                        key={entityId}
                        className={`border-b border-border/30 hover:bg-muted/30 transition-colors cursor-pointer ${
                          a.should_pause ? "border-l-2 border-l-red-500" : ""
                        } ${isSelected ? "bg-primary/5" : ""} ${isPaused ? "opacity-50" : ""}`}
                        onClick={() => {
                          setExpandedIds(prev => {
                            const next = new Set(prev);
                            if (next.has(entityId)) next.delete(entityId);
                            else next.add(entityId);
                            return next;
                          });
                        }}
                        data-testid={`row-adset-${entityId}`}
                      >
                        <td className="p-3" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleSelect(entityId)}
                            data-testid={`checkbox-adset-${entityId}`}
                          />
                        </td>
                        <td className={`p-3 transition-all duration-200 ${
                          columnSize === "compact" ? "max-w-[120px]" : 
                          columnSize === "normal" ? "max-w-[180px]" : "max-w-[400px]"
                        }`}>
                          <div className="flex items-center gap-1.5">
                            {a.should_pause && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <AlertCircle className="w-3 h-3 text-red-400 shrink-0" />
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                  <div className="text-xs max-w-xs space-y-1">
                                    <p className="font-medium text-red-400">Should Pause</p>
                                    {(a.auto_pause_reasons as string[] | undefined)?.map((r: string, i: number) => (
                                      <p key={i}>{r}</p>
                                    ))}
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            )}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="truncate block cursor-default text-foreground">
                                  {truncate(entityName, 30)}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top">
                                <p className="text-xs max-w-sm">{entityName}</p>
                              </TooltipContent>
                            </Tooltip>
                            {isPaused && (
                              <Badge variant="secondary" className="text-[9px] px-1 py-0 text-red-400 shrink-0">PAUSED</Badge>
                            )}
                          </div>
                          {a.should_pause && (
                            <div className="mt-1">
                              <Badge variant="destructive" className="text-[9px] px-1 py-0">
                                Recommended: Pause
                              </Badge>
                            </div>
                          )}
                        </td>
                        <td className="p-3 max-w-[150px]">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="truncate block cursor-default text-muted-foreground">
                                {truncate(a.campaign_name, 25)}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              <p className="text-xs max-w-sm">{a.campaign_name}</p>
                            </TooltipContent>
                          </Tooltip>
                        </td>
                        <td className="p-3">
                          <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${layer.bg} ${layer.text}`}>
                            {a.layer}
                          </span>
                        </td>
                        <td className="p-3">
                          <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${classColor.bg} ${classColor.text}`}>
                            {a.classification}
                          </span>
                        </td>
                        <td className="p-3">
                          <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${learningColor.bg} ${learningColor.text}`}>
                            {a.learning_status}
                          </span>
                        </td>
                        <td className="p-3">
                          <span className={`text-[10px] ${a.delivery_status === "NOT_DELIVERING" ? "text-red-400" : "text-foreground"}`}>
                            {a.delivery_status}
                          </span>
                        </td>
                        <td className="p-3">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex items-center gap-2">
                                <div className={`w-14 h-1.5 rounded-full ${getHealthBarBg(a.health_score)}`}>
                                  <div
                                    className={`h-full rounded-full ${getHealthBgColor(a.health_score)}`}
                                    style={{ width: `${a.health_score}%` }}
                                  />
                                </div>
                                <span className="tabular-nums text-muted-foreground w-6">{a.health_score}</span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs">
                              <div className="text-xs space-y-1">
                                <p className="font-medium">Score Breakdown</p>
                                {a.score_breakdown && Object.entries(a.score_breakdown).map(([k, v]) => (
                                  <div key={k} className="flex items-center justify-between gap-3">
                                    <span className="text-muted-foreground capitalize">{k.replace(/_/g, " ")}</span>
                                    <span className="tabular-nums font-medium">{typeof v === "number" ? v.toFixed(1) : String(v)}</span>
                                  </div>
                                ))}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </td>
                        <td className="p-3 text-right tabular-nums">{formatINR(a.spend, 0)}</td>
                        <td className="p-3 text-right tabular-nums">{a.leads}</td>
                        <td className={`p-3 text-right tabular-nums ${a.cpl > 0 ? getCplColor(a.cpl, thresholds) : "text-foreground"}`}>
                          {a.cpl > 0 ? formatINR(a.cpl, 0) : "—"}
                        </td>
                        <td className={`p-3 text-right tabular-nums ${a.ctr < 0.7 ? "text-red-400" : "text-foreground"}`}>
                          {formatPct(a.ctr)}
                        </td>
                        <td className="p-3 text-right tabular-nums">{formatINR(a.cpc, 2)}</td>
                        <td className="p-3 text-right tabular-nums">{formatINR(a.cpm, 0)}</td>
                        <td className={`p-3 text-right tabular-nums ${a.frequency > 2.5 ? "text-amber-400" : "text-foreground"}`}>
                          {a.frequency.toFixed(2)}
                        </td>
                        <td className="p-3 text-right tabular-nums">{formatINR(a.daily_budget, 0)}</td>
                        <td className="p-3 text-right tabular-nums">{a.budget_utilization_pct.toFixed(1)}%</td>
                        <td className="p-3">
                          <div className="flex items-center gap-1 justify-center">
                            {!isPaused ? (
                              <ExecutionButton
                                action="PAUSE_ADSET"
                                entityId={entityId}
                                entityName={entityName}
                                entityType="adset"
                                label=""
                                variant={a.should_pause ? "destructive" : "ghost"}
                                size="icon"
                                icon={<Pause className="w-3.5 h-3.5" />}
                                confirmMessage={`Pause adset "${entityName}"?${a.auto_pause_reasons?.length ? `\n\nReasons: ${a.auto_pause_reasons.join(", ")}` : ""}`}
                                params={{ reason: a.should_pause ? a.auto_pause_reasons?.join("; ") : "Manual pause from Adsets page" }}
                                className="h-7 w-7"
                                data-testid={`button-pause-adset-${entityId}`}
                              />
                            ) : (
                              <ExecutionButton
                                action="UNPAUSE_ADSET"
                                entityId={entityId}
                                entityName={entityName}
                                entityType="adset"
                                label=""
                                variant="ghost"
                                size="icon"
                                icon={<Play className="w-3.5 h-3.5 text-emerald-400" />}
                                confirmMessage={`Activate adset "${entityName}"?`}
                                params={{ reason: "Manual activation from Adsets page" }}
                                className="h-7 w-7"
                                data-testid={`button-activate-adset-${entityId}`}
                              />
                            )}
                            {!isPaused && (
                              <ExecutionButton
                                action="SCALE_BUDGET_UP"
                                entityId={entityId}
                                entityName={entityName}
                                entityType="adset"
                                label=""
                                variant="ghost"
                                size="icon"
                                icon={<TrendingUp className="w-3.5 h-3.5 text-emerald-400" />}
                                confirmMessage={`Scale up budget by 25% on "${entityName}"?\nCurrent daily budget: ${formatINR(a.daily_budget, 0)}`}
                                params={{ scalePercent: 25, reason: "Manual scale up from Adsets page" }}
                                className="h-7 w-7"
                                data-testid={`button-scaleup-adset-${entityId}`}
                              />
                            )}
                            {!isPaused && (
                              <ExecutionButton
                                action="SCALE_BUDGET_DOWN"
                                entityId={entityId}
                                entityName={entityName}
                                entityType="adset"
                                label=""
                                variant="ghost"
                                size="icon"
                                icon={<TrendingDown className="w-3.5 h-3.5 text-orange-400" />}
                                confirmMessage={`Scale down budget by 25% on "${entityName}"?\nCurrent daily budget: ${formatINR(a.daily_budget, 0)}`}
                                params={{ scalePercent: -25, reason: "Manual scale down from Adsets page" }}
                                className="h-7 w-7"
                                data-testid={`button-scaledown-adset-${entityId}`}
                              />
                            )}
                          </div>
                        </td>
                      </tr>
                      {isExpanded && a.score_breakdown && (
                        <tr key={`${entityId}-expanded`} className="border-b border-border/30 bg-muted/20">
                          <td colSpan={17} className="p-4">
                            <div className="space-y-3">
                              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                                Health Score Breakdown — {entityName}
                              </p>
                              <div className="flex flex-wrap gap-3">
                                {Object.entries(a.score_breakdown).map(([metric, score]) => {
                                  const band = (a.score_bands as Record<string, string>)?.[metric] || "unknown";
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
              totalItems={adsets.length}
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
