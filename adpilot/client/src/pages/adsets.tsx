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
import { ArrowUpDown, ChevronDown, ChevronUp, AlertCircle, Pause, Play, TrendingUp, TrendingDown, Loader2, SlidersHorizontal, Info } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { ScoreIndicator } from "@/components/score-indicator";
import { calculatePerformanceScore, getClassification } from "@shared/scoring";
import {
  formatINR,
  formatPct,
  formatNumber,
  getLayerColor,
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
      <TooltipContent side="top" className="t-caption">
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
  
  const queryParams = new URLSearchParams(window.location.hash.split("?")[1] || "");
  const initialFilter = queryParams.get("filter")?.toUpperCase() || "ALL";
  const initialCampaignId = queryParams.get("campaignId") || "ALL";

  const [filterLayer, setFilterLayer] = useState<string>("ALL");
  const [filterClassification, setFilterClassification] = useState<string>(initialFilter);
  const [filterLearning, setFilterLearning] = useState<string>("ALL");
  const [filterCampaign, setFilterCampaign] = useState<string>(initialCampaignId);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const hasSelection = selectedIds.size > 0;
  const [bulkConfirm, setBulkConfirm] = useState<{ open: boolean; action: "pause" | "activate" }>({ open: false, action: "pause" });
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [columnSize, setColumnSize] = useState<"compact" | "normal" | "wide">("normal");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [searchPage, setSearchPage] = useState(1);
  const [searchPageSize, setSearchPageSize] = useState(25);
  const [dgPage, setDgPage] = useState(1);
  const [dgPageSize, setDgPageSize] = useState(25);
  
  useEffect(() => {
    const q = new URLSearchParams(window.location.hash.split("?")[1] || "");
    const f = q.get("filter")?.toUpperCase();
    if (f && f !== filterClassification) setFilterClassification(f);
    const cid = q.get("campaignId");
    if (cid && cid !== filterCampaign) setFilterCampaign(cid);
  }, [window.location.hash]);

  useEffect(() => { setPage(1); setSearchPage(1); setDgPage(1); }, [filterLayer, filterClassification, filterLearning, filterCampaign]);

  const source = useMemo(() => {
    if (!data) return [];
    return isGoogle ? ((data as any)?.ad_group_analysis || []) : (data?.adset_analysis || []);
  }, [data, isGoogle]);

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
    if (!source) return [];
    
    const perfTargets = {
      cpl: (data as any)?.dynamic_thresholds?.cpl_target || 850,
      cpm: (data as any)?.dynamic_thresholds?.cpm_target || 800,
      ctr: (data as any)?.dynamic_thresholds?.ctr_min || 1.0,
      cvr: (data as any)?.dynamic_thresholds?.cvr_min || 2.0,
      frequency: 3.0
    };

    let list = source.map((a: any) => {
      const perfMetrics = {
        cpl: a.cpl || 0,
        cpm: a.cpm || a.avg_cpm || a.cost_per_mille || 0,
        ctr: a.ctr || 0,
        cvr: a.cvr || 0,
        frequency: a.frequency || 1.0
      };
      
      const perf = calculatePerformanceScore(perfMetrics, perfTargets);
      const classification = getClassification(perf.score);

      return {
        ...a,
        classification,
        health_score: perf.score,
        score_breakdown: perf.breakdown
      };
    });

    list = list.filter((a: any) => {
      const status = (a.status || "").toUpperCase();
      if (status === "ACTIVE" || status === "ENABLED" || !status) return true;
      if (status === "PAUSED" && (a.spend || a.cost || 0) > 0) return true;
      return false;
    });

    if (isGoogle && filterCampaign !== "ALL") {
      list = list.filter((a: any) => (a.campaign_id || a.campaign_name) === filterCampaign);
    }

    if (filterLayer !== "ALL") list = list.filter((a: any) => a.layer === filterLayer);
    if (filterClassification !== "ALL") list = list.filter((a: any) => a.classification === filterClassification);
    if (filterLearning !== "ALL") list = list.filter((a: any) => a.learning_status === filterLearning);
    
    list.sort((a: any, b: any) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      return sortDir === "asc" ? String(aVal).localeCompare(String(bVal)) : String(bVal).localeCompare(String(aVal));
    });
    return list;
  }, [source, data, sortKey, sortDir, filterLayer, filterClassification, filterLearning, filterCampaign, isGoogle]);

  const searchAdGroups = useMemo(() => {
    if (!isGoogle) return [];
    return adsets.filter((a: any) => a.campaign_type === "branded" || a.campaign_type === "location");
  }, [adsets, isGoogle]);

  const dgAdGroups = useMemo(() => {
    if (!isGoogle) return [];
    return adsets.filter((a: any) => a.campaign_type === "demand_gen");
  }, [adsets, isGoogle]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 opacity-30" />;
    return sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
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
    const actions = selectedAdsets.map((a: any) => ({
      action: action === "pause" ? pauseAction : activateAction,
      entityId: getId(a),
      entityName: getName(a),
      entityType: (isGoogle ? "ad_group" : "adset") as any,
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

  const googleAgColumns = [
    { key: "ad_group_name" as SortKey, label: "Ad Group", align: "left" },
    { key: "campaign_name" as SortKey, label: "Campaign", align: "left" },
    { key: "campaign_type" as SortKey, label: "Type", align: "left" },
    { key: "impressions" as SortKey, label: "Impr", align: "right" },
    { key: "cost" as SortKey, label: "Spend", align: "right" },
    { key: "conversions" as SortKey, label: "Conv", align: "right" },
    { key: "ctr" as SortKey, label: "CTR", align: "right" },
    { key: "cpl" as SortKey, label: "CPL", align: "right" },
    { key: "health_score" as SortKey, label: "Score", align: "left" },
  ];

  const metaColumns = [
    { key: "adset_name" as SortKey, label: entityLabel, align: "left" },
    { key: "campaign_name" as SortKey, label: "Campaign", align: "left" },
    { key: "layer" as SortKey, label: "Layer", align: "left" },
    { key: "classification" as SortKey, label: "Class", align: "left" },
    { key: "health_score" as SortKey, label: "Health", align: "left" },
    { key: "spend" as SortKey, label: "Spend", align: "right" },
    { key: "leads" as SortKey, label: "Leads", align: "right" },
    { key: "cpl" as SortKey, label: "CPL", align: "right" },
    { key: "ctr" as SortKey, label: "CTR", align: "right" },
  ];

  function renderGoogleAgRow(a: any) {
    const entityId = a.ad_group_id || a.id;
    const entityName = a.ad_group_name || a.name;
    const isPaused = isEntityPaused(entityId);
    const isSelected = selectedIds.has(entityId);
    return (
      <tr key={entityId} className={`border-b border-border/30 hover:bg-muted/3 transition-colors ${isSelected ? "bg-primary/5" : ""} ${isPaused ? "opacity-50" : ""} ${a.classification === "UNDERPERFORMER" ? "border-l-2 border-l-red-500" : ""}`}>
        <td className="p-3"><Checkbox checked={isSelected} onCheckedChange={() => toggleSelect(entityId)} /></td>
        <td className="p-3 font-medium text-foreground truncate max-w-[200px]">{entityName}</td>
        <td className="p-3 text-muted-foreground truncate max-w-[150px]">{a.campaign_name}</td>
        <td className="p-3 text-[10px] font-bold uppercase text-primary/70">{a.campaign_type}</td>
        <td className="p-3 text-right tabular-nums text-muted-foreground">{formatNumber(a.impressions)}</td>
        <td className="p-3 text-right tabular-nums font-bold">{formatINR(a.cost || a.spend || 0, 0)}</td>
        <td className="p-3 text-right tabular-nums">{a.conversions ?? a.leads ?? 0}</td>
        <td className="p-3 text-right tabular-nums">{formatPct(a.ctr || 0)}</td>
        <td className={`p-3 text-right tabular-nums font-black ${getCplColor(a.cpl, data.dynamic_thresholds)}`}>{formatINR(a.cpl || 0, 0)}</td>
        <td className="p-3">
          <ScoreIndicator score={a.health_score} breakdown={a.score_breakdown} label="Ad Group Health" description="Standardized Performance Scoring" />
        </td>
        <td className="p-3 text-center">
            <ExecutionButton action={isPaused ? "ENABLE_AD_GROUP" : "PAUSE_AD_GROUP"} entityId={entityId} entityName={entityName} entityType="ad_group" variant="ghost" size="icon" icon={isPaused ? <Play className="w-3.5 h-3.5 text-emerald-500" /> : <Pause className="w-3.5 h-3.5 text-muted-foreground" />} />
        </td>
      </tr>
    );
  }

  function renderAgTable(rows: any[], id: string, pg: number, ps: number, setPg: any, setPs: any) {
    const paginatedItems = rows.slice((pg - 1) * ps, pg * ps);
    return (
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="t-table w-full">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="p-3 w-8"><Checkbox checked={rows.length > 0 && rows.every(r => selectedIds.has(r.ad_group_id || r.id))} onCheckedChange={(c) => {
                    const ids = rows.map(r => r.ad_group_id || r.id);
                    setSelectedIds(prev => {
                      const next = new Set(prev);
                      ids.forEach(id => c ? next.add(id) : next.delete(id));
                      return next;
                    });
                  }} /></th>
                  {googleAgColumns.map(col => <th key={col.key} className={`p-4 t-label font-bold uppercase tracking-widest text-muted-foreground/80 cursor-pointer ${col.align === "right" ? "text-right" : "text-left"}`} onClick={() => toggleSort(col.key)}>{col.label} <SortIcon col={col.key} /></th>)}
                  <th className="p-4 t-label text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedItems.map(a => renderGoogleAgRow(a))}
                {rows.length === 0 && <tr><td colSpan={10} className="p-8 text-center text-muted-foreground italic text-xs">No entries found</td></tr>}
              </tbody>
            </table>
          </div>
          <DataTablePagination totalItems={rows.length} pageSize={ps} currentPage={pg} onPageChange={setPg} onPageSizeChange={setPs} />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="p-6 space-y-4 max-w-[1800px]">
      <AlertDialog open={bulkConfirm.open} onOpenChange={(o) => !o && setBulkConfirm({ open: false, action: "pause" })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{bulkConfirm.action === "pause" ? "Pause" : "Activate"} {selectedIds.size} {entityLabelPlural}?</AlertDialogTitle>
            <AlertDialogDescription>This will push standard execution to the platform immediately.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => handleBulkAction(bulkConfirm.action)}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-lg font-black text-foreground uppercase tracking-tight">{entityLabelPlural}</h1>
          <p className="text-xs text-muted-foreground">{adsets.length} active entities in current view</p>
        </div>
        <div className="flex items-center gap-2">
            {isGoogle && campaignList.length > 0 && (
              <select className="px-2 py-1.5 text-xs rounded-md bg-muted/50 border border-border/50" value={filterCampaign} onChange={e => setFilterCampaign(e.target.value)}>
                <option value="ALL">All Campaigns</option>
                {campaignList.map((c: any) => <option key={c.id} value={c.id}>{truncate(c.name, 30)}</option>)}
              </select>
            )}
            {!isGoogle && (
              <>
                <select className="px-2 py-1.5 text-xs rounded-md bg-muted/50 border border-border/50" value={filterLayer} onChange={e => setFilterLayer(e.target.value)}>
                  <option value="ALL">All Layers</option>
                  <option value="TOFU">TOFU</option><option value="MOFU">MOFU</option><option value="BOFU">BOFU</option>
                </select>
                <select className="px-2 py-1.5 text-xs rounded-md bg-muted/50 border border-border/50" value={filterClassification} onChange={e => setFilterClassification(e.target.value)}>
                  <option value="ALL">All Scores</option>
                  <option value="WINNER">Winners</option><option value="WATCH">Watch</option><option value="UNDERPERFORMER">Underperformers</option>
                </select>
              </>
            )}
        </div>
      </div>

      {hasSelection && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20 animate-in slide-in-from-top-2">
          <span className="text-xs font-bold text-primary tabular-nums">{selectedIds.size} selected</span>
          <Button size="sm" variant="destructive" className="h-7 text-[10px] uppercase font-black" onClick={() => setBulkConfirm({ open: true, action: "pause" })}>Pause Selection</Button>
          <Button size="sm" variant="default" className="h-7 text-[10px] uppercase font-black bg-emerald-600" onClick={() => setBulkConfirm({ open: true, action: "activate" })}>Activate Selection</Button>
          <Button size="sm" variant="ghost" className="h-7 text-[10px] uppercase font-bold" onClick={() => setSelectedIds(new Set())}>Clear</Button>
        </div>
      )}

      {isGoogle ? (
        <div className="space-y-6">
          <div><h2 className="text-xs font-black uppercase text-foreground mb-2 flex items-center gap-2"><Info className="w-3 h-3 text-primary" /> Search Ad Groups</h2>{renderAgTable(searchAdGroups, "search", searchPage, searchPageSize, setSearchPage, setSearchPageSize)}</div>
          <div><h2 className="text-xs font-black uppercase text-foreground mb-2 flex items-center gap-2"><Info className="w-3 h-3 text-amber-500" /> Demand Gen Ad Groups</h2>{renderAgTable(dgAdGroups, "dg", dgPage, dgPageSize, setDgPage, setDgPageSize)}</div>
        </div>
      ) : (
        <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="t-table w-full"><thead><tr className="border-b border-border/50"><th className="p-3 w-8"><Checkbox checked={adsets.length > 0 && selectedIds.size === adsets.length} onCheckedChange={toggleSelectAll} /></th>{metaColumns.map(col => <th key={col.key} className={`p-4 t-label font-bold uppercase tracking-widest text-muted-foreground/80 cursor-pointer ${col.align === "right" ? "text-right" : "text-left"}`} onClick={() => toggleSort(col.key)}>{col.label} <SortIcon col={col.key} /></th>)}<th className="p-4 t-label text-center font-bold">Actions</th></tr></thead><tbody>{adsets.slice((page - 1) * pageSize, page * pageSize).map((a: any) => (
          <tr key={a.adset_id} className={`border-b border-border/30 hover:bg-muted/3 transition-all ${selectedIds.has(a.adset_id) ? "bg-primary/5" : ""} ${a.delivery_status === "PAUSED" ? "opacity-50" : ""}`}>
            <td className="p-3"><Checkbox checked={selectedIds.has(a.adset_id)} onCheckedChange={() => toggleSelect(a.adset_id)} /></td>
            <td className="p-3 font-medium text-foreground truncate max-w-[200px]">{a.adset_name}</td>
            <td className="p-3 text-muted-foreground truncate max-w-[150px]">{a.campaign_name}</td>
            <td className="p-3"><Badge variant="outline" className="text-[9px] font-black uppercase border-primary/20 text-primary/80">{a.layer}</Badge></td>
            <td className="p-3"><StatusBadge classification={a.classification} /></td>
            <td className="p-3"><ScoreIndicator score={a.health_score} breakdown={a.score_breakdown} label="Adset Performance" description="Weighted methodology" /></td>
            <td className="p-3 text-right tabular-nums font-bold">{formatINR(a.spend, 0)}</td>
            <td className="p-3 text-right tabular-nums">{a.leads}</td>
            <td className={`p-3 text-right tabular-nums font-black ${getCplColor(a.cpl, data.dynamic_thresholds)}`}>{formatINR(a.cpl, 0)}</td>
            <td className={`p-3 text-right tabular-nums font-medium`}>{formatPct(a.ctr)}</td>
            <td className="p-3 text-center">
              <ExecutionButton action={a.delivery_status === "PAUSED" ? "UNPAUSE_ADSET" : "PAUSE_ADSET"} entityId={a.adset_id} entityName={a.adset_name} entityType="adset" variant="ghost" size="icon" icon={a.delivery_status === "PAUSED" ? <Play className="w-3.5 h-3.5 text-emerald-500" /> : <Pause className="w-3.5 h-3.5 text-muted-foreground" />} />
            </td>
          </tr>
        ))}</tbody></table></div><DataTablePagination totalItems={adsets.length} pageSize={pageSize} currentPage={page} onPageChange={setPage} onPageSizeChange={setPageSize} /></CardContent></Card>
      )}
    </div>
  );
}
