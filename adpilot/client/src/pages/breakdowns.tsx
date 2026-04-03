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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { UnifiedActions, type UnifiedActionItem, type ActionState } from "@/components/unified-actions";

// ─── Constants & Types ──────────────────────────────────────────────

const ACCOUNT_OVERVIEW = "all";
const META_TABS = ["Age", "Gender", "Placement", "Device", "Region"] as const;
type MetaTabType = (typeof META_TABS)[number];

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

function ScoreExpansion({ score, row, cplTarget, ctrTarget }: any) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
      <div className="p-2 rounded-md bg-background border border-border/50">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">CPL vs Target</p>
        <p className="text-xs font-semibold">{score.cplScore}/50</p>
      </div>
      <div className="p-2 rounded-md bg-background border border-border/50">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">CTR Efficiency</p>
        <p className="text-xs font-semibold">{score.ctrScore}/20</p>
      </div>
      <div className="p-2 rounded-md bg-background border border-border/50">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Lead Volume</p>
        <p className="text-xs font-semibold">{score.volumeScore}/20</p>
      </div>
      <div className="p-2 rounded-md bg-background border border-border/50">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Spend Util</p>
        <p className="text-xs font-semibold">{score.efficiencyScore}/10</p>
      </div>
    </div>
  );
}

function getScoreBg(s: number) {
  if (s >= 70) return "bg-emerald-500/10 border-emerald-500/30";
  if (s >= 40) return "bg-amber-500/10 border-amber-500/30";
  return "bg-red-500/10 border-red-500/30";
}

function getScoreColor(s: number) {
  if (s >= 70) return "text-emerald-400";
  if (s >= 40) return "text-amber-400";
  return "text-red-400";
}

function computeBreakdownScore(row: any, target: number, ctrBenchmark: number, totalLeads: number, totalSpend: number) {
  let cplScore = 0;
  if (row.leads > 0) {
    const ratio = target / row.cpl;
    cplScore = Math.min(50, Math.max(0, ratio * 25));
  } else if (row.spend > 500) {
    cplScore = 5;
  } else {
    cplScore = 20; // neutral if low spend / no data
  }

  let ctrScore = 0;
  if (row.ctr > 0) {
    const ratio = row.ctr / ctrBenchmark;
    ctrScore = Math.min(20, Math.max(0, ratio * 10));
  }

  let volumeScore = 0;
  if (totalLeads > 0) {
    volumeScore = Math.min(20, (row.leads / totalLeads) * 100);
  }

  let efficiencyScore = 0;
  if (totalSpend > 0) {
    const spendPct = (row.spend / totalSpend) * 100;
    efficiencyScore = Math.min(10, spendPct > 10 ? 10 : spendPct);
  }

  return {
    total: Math.round(cplScore + ctrScore + volumeScore + efficiencyScore),
    cplScore: Math.round(cplScore),
    ctrScore: Math.round(ctrScore),
    volumeScore: Math.round(volumeScore),
    efficiencyScore: Math.round(efficiencyScore),
  };
}

function getRecommendationType(row: any, score: number, tabName: string, isTarget?: boolean) {
  if (tabName === "Region" && isTarget === false && row.spend > 0) {
    return { type: "exclude", text: "OUTSIDE TARGET LOCATION", color: "text-red-400" };
  }
  if (score >= 75) return { type: "scale", text: "SCALE BUDGET", color: "text-emerald-400" };
  if (score >= 60) return { type: "monitor", text: "MONITOR & OPTIMIZE", color: "text-emerald-300" };
  if (score >= 40) return { type: "flag", text: "NEEDS REVIEW", color: "text-amber-400" };
  if (score > 0) return { type: "reduce", text: "REDUCE SPEND", color: "text-red-400" };
  return { type: "none", text: "INSUFFICIENT DATA", color: "text-muted-foreground" };
}

// ─── Main Component ────────────────────────────────────────────────

export default function BreakdownsPage() {
  const { activeClient: client, activeCadence: globalCadence } = useClient();
  const [activeTab, setActiveTab] = useState<"Meta" | "Google">("Meta");
  
  const clientId = client?.id || "amara";
  const apiBase = `/api/clients/${clientId}`;

  const { data: analysisData, isLoading: isLoadingAnalysis } = useQuery({
    queryKey: [apiBase, activeTab.toLowerCase(), "analysis", globalCadence],
    queryFn: async () => {
      const url = `${apiBase}/${activeTab.toLowerCase()}/analysis?cadence=${globalCadence}`;
      const res = await apiRequest("GET", url);
      return res.json();
    },
  });

  const activeCadence = analysisData?.active_cadence || globalCadence;

  return (
    <div className="min-h-screen bg-background">
      <div className="flex items-center gap-1 p-6 border-b border-border/50">
        <button
          onClick={() => setActiveTab("Meta")}
          className={cn(
            "px-4 py-2 text-sm font-semibold rounded-md transition-all",
            activeTab === "Meta" ? "bg-primary text-primary-foreground shadow-lg" : "text-muted-foreground hover:bg-muted"
          )}
        >
          Meta Ads
        </button>
        <button
          onClick={() => setActiveTab("Google")}
          className={cn(
            "px-4 py-2 text-sm font-semibold rounded-md transition-all",
            activeTab === "Google" ? "bg-[#F0BC00] text-black shadow-lg" : "text-muted-foreground hover:bg-muted"
          )}
        >
          Google Ads
        </button>
      </div>

      {activeTab === "Meta" ? (
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
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});
  const [columnSize, setColumnSize] = useState<"compact" | "normal" | "wide">("normal");
  const [sortKey, setSortKey] = useState<string>("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const thresholds = analysisData?.dynamic_thresholds;
  const cplTarget = thresholds?.cpl_target ?? 0;
  const ctrTarget = thresholds?.ctr_min ?? 0.7;

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
      }))
      .sort((a: any, b: any) => b.spend - a.spend);
  }, [analysisData]);

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

  const tabKey = activeTab.toLowerCase();
  
  const rawRows: BreakdownRow[] = useMemo(() => {
    const source = data?.available && data.breakdowns?.[tabKey] ? data.breakdowns[tabKey] : [];
    if (selectedCampaign !== ACCOUNT_OVERVIEW) return source;
    const aggregated: Record<string, BreakdownRow> = {};
    source.forEach(row => {
      const dim = row.dimension || "Unknown";
      if (!aggregated[dim]) { aggregated[dim] = { ...row }; }
      else {
        const agg = aggregated[dim];
        agg.spend += row.spend;
        agg.impressions += row.impressions;
        agg.clicks += row.clicks;
        agg.leads += row.leads;
        agg.cpl = agg.leads > 0 ? agg.spend / agg.leads : 0;
        agg.ctr = agg.impressions > 0 ? (agg.clicks / agg.impressions) * 100 : 0;
        agg.cpc = agg.clicks > 0 ? agg.spend / agg.clicks : 0;
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

  const geoAlerts = data?.geo_alerts || [];
  const targetLocations = data?.target_locations || [];
  const totalSpend = rows.reduce((s, r) => s + r.spend, 0);
  const totalLeads = rows.reduce((s, r) => s + r.leads, 0);
  
  const rowsWithLeads = rows.filter(r => r.leads > 0);
  const best = rowsWithLeads.length > 0 ? rowsWithLeads.reduce((a, b) => (a.cpl < b.cpl ? a : b)) : null;
  const worst = rowsWithLeads.length > 0 ? rowsWithLeads.reduce((a, b) => (a.cpl > b.cpl ? a : b)) : null;

  const scoredRows = useMemo(() => {
    return rows.map((row) => ({
      row,
      score: computeBreakdownScore(row, cplTarget, ctrTarget, totalLeads, totalSpend),
      recommendation: getRecommendationType(row, computeBreakdownScore(row, cplTarget, ctrTarget, totalLeads, totalSpend).total, activeTab, row.is_target_location),
    }));
  }, [rows, cplTarget, ctrTarget, totalLeads, totalSpend, activeTab]);

  if (isLoading) return <div className="p-12 text-center text-muted-foreground"><Clock className="w-8 h-8 mx-auto mb-2 animate-spin opacity-20" /><p>Analyzing demographics...</p></div>;

  if (!data?.available) {
    return (
      <Card className="m-6 bg-muted/20 border-border/50">
        <CardContent className="p-12 text-center">
          <Clock className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">
            {data?.message || "Demographic data is currently being synthesized for this account. Check back after the next agent run."}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card className="m-6 bg-muted/20 border-border/50">
        <CardContent className="p-12 text-center">
          <Clock className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">
            No {activeTab.toLowerCase()} breakdown data available for this selection.
          </p>
        </CardContent>
      </Card>
    );
  }

  const columns = [
    { key: "dimension", label: activeTab, align: "left" },
    { key: "score", label: "Score", align: "center" },
    { key: "spend", label: "Spend", align: "right" },
    { key: "spendPct", label: "Spend %", align: "right" },
    { key: "impressions", label: "Impr.", align: "right" },
    { key: "clicks", label: "Clicks", align: "right" },
    { key: "ctr", label: "CTR", align: "right" },
    { key: "leads", label: "Leads", align: "right" },
    { key: "cpl", label: "CPL", align: "right" },
    { key: "actions", label: "Standard Actions", align: "center" },
  ];

  return (
    <div className="p-6 space-y-4 max-w-[1600px]">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-6 h-6 text-primary" />
          <h2 className="text-xl font-bold tracking-tight">Meta Breakdown Intelligence</h2>
        </div>
        <Select value={selectedCampaign} onValueChange={setSelectedCampaign}>
          <SelectTrigger className="w-[340px] h-10 bg-card border-border/50">
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

      <div className="grid grid-cols-4 gap-4">
         <MetricCard icon={IndianRupee} label="Total Spend" value={formatINR(totalSpend, 0)} color="text-primary" />
         <MetricCard icon={Trophy} label="Best Performance" value={best ? best.dimension : "—"} subValue={best ? `CPL ${formatINR(best.cpl, 0)}` : ""} color="text-emerald-400" />
         <MetricCard icon={ThumbsDown} label="Worst Performance" value={worst ? worst.dimension : "—"} subValue={worst ? `CPL ${formatINR(worst.cpl, 0)}` : ""} color="text-red-400" />
         <MetricCard icon={MapPin} label="Geo Accuracy" value={geoAlerts.length === 0 ? "Targeted" : "Alert"} subValue={geoAlerts.length > 0 ? `${formatINR(geoAlerts.reduce((s, a) => s + a.spend, 0),0)} leakage` : "Clean"} color={geoAlerts.length > 0 ? "text-red-400" : "text-emerald-400"} />
      </div>

      <div className="flex items-center gap-1 border-b border-border/50">
        {META_TABS.map(tab => (
          <button key={tab} onClick={() => { setActiveTab(tab); setExpandedIds(new Set()); }}
            className={cn("px-4 py-2.5 text-xs font-bold uppercase tracking-widest border-b-2 transition-all", activeTab === tab ? "text-primary border-primary bg-primary/5" : "text-muted-foreground border-transparent hover:text-foreground hover:bg-muted/50")}>
            {tab}
          </button>
        ))}
      </div>

      <Card className="border-border/40 shadow-sm overflow-hidden bg-card/30">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/20 border-b border-border/50">
                <th className="p-3 w-10">
                   <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6"><SlidersHorizontal className="h-3.5 w-3.5" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem onClick={() => setColumnSize("compact")}>Compact Width</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setColumnSize("normal")}>Regular Width</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setColumnSize("wide")}>Wide View</DropdownMenuItem>
                      </DropdownMenuContent>
                   </DropdownMenu>
                </th>
                {columns.map(col => (
                  <th key={col.key} onClick={() => col.key !== "actions" && toggleSort(col.key)}
                    className={cn("p-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground cursor-pointer select-none", 
                    col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left",
                    columnSize === "compact" ? "px-1" : columnSize === "wide" ? "px-6" : "px-3")}>
                    <div className="flex items-center gap-1">{col.label} {sortKey === col.key && (sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scoredRows.map(({ row, score, recommendation: rec }, i) => {
                const isExpanded = expandedIds.has(row.dimension);
                const spendPct = totalSpend > 0 ? (row.spend / totalSpend) * 100 : 0;
                const itemId = `meta-${activeTab}-${row.dimension}`;
                return (
                  <React.Fragment key={i}>
                    <tr className={cn("border-b border-border/30 hover:bg-muted/20 transition-all cursor-pointer", isExpanded && "bg-primary/5")} onClick={() => toggleExpand(row.dimension)}>
                       <td className="p-3"><Button variant="ghost" size="sm" className="h-6 w-6 p-0">{isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</Button></td>
                       <td className={cn("p-3 font-semibold text-foreground", columnSize === "compact" ? "px-1" : columnSize === "wide" ? "px-6" : "px-3")}>
                          {row.dimension}
                          {row.classification && <Badge variant="outline" className={cn("ml-2 text-[9px] font-black tracking-tighter", row.classification === "WINNER" ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/5" : "border-red-500/30 text-red-400 bg-red-500/5")}>{row.classification}</Badge>}
                       </td>
                       <td className="p-3 text-center">
                          <Tooltip>
                             <TooltipTrigger asChild><span className={cn("inline-flex items-center justify-center w-7 h-7 rounded font-black text-[11px] border", getScoreBg(score.total), getScoreColor(score.total))}>{score.total}</span></TooltipTrigger>
                             <TooltipContent side="left" className="p-2 space-y-1 text-[10px]">
                               <p className="font-bold border-b border-border/50 pb-1 mb-1">Score Anatomy ({score.total})</p>
                               <div className="flex justify-between gap-4"><span>CPL Score:</span> <span>{score.cplScore}/50</span></div>
                               <div className="flex justify-between gap-4"><span>CTR Score:</span> <span>{score.ctrScore}/20</span></div>
                               <div className="flex justify-between gap-4"><span>Volume:</span> <span>{score.volumeScore}/20</span></div>
                             </TooltipContent>
                          </Tooltip>
                       </td>
                       <td className="p-3 text-right tabular-nums font-medium">{formatINR(row.spend, 0)}</td>
                       <td className="p-3 text-right"><ProgressBar pct={spendPct} color="bg-primary/60" /></td>
                       <td className="p-3 text-right tabular-nums text-muted-foreground">{formatNumber(row.impressions)}</td>
                       <td className="p-3 text-right tabular-nums text-muted-foreground">{formatNumber(row.clicks)}</td>
                       <td className="p-3 text-right tabular-nums">{formatPct(row.ctr)}</td>
                       <td className="p-3 text-right tabular-nums font-bold text-foreground">{row.leads}</td>
                       <td className={cn("p-3 text-right tabular-nums font-bold", getCplColor(row.cpl, thresholds))}>{row.cpl > 0 ? formatINR(row.cpl,0) : "—"}</td>
                       <td className="p-3">
                          <UnifiedActions compact item={{ id: itemId, description: `Scale ${activeTab}: ${row.dimension}`, autoExecutable: false }}
                            entityId={itemId} entityName={`${activeTab}: ${row.dimension}`} entityType="adset" actionType="MANUAL_ACTION"
                            recommendation={rec.text} onStateChange={() => {}} />
                       </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-muted/10">
                        <td colSpan={11} className="p-6 border-b border-primary/20">
                           <div className="max-w-[700px] space-y-4">
                              <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-primary">Strategic Analysis Breakdown</h4>
                              <ScoreExpansion score={score} row={row} cplTarget={cplTarget} ctrTarget={ctrTarget} />
                              <div className="p-4 rounded border border-border/50 bg-background/50 space-y-2">
                                 <p className="text-xs text-foreground leading-relaxed">Intelligence layer indicates <strong>{rec.text}</strong>. Performance efficiency is {score.total >= 70 ? "high" : "suboptimal"}. CPL variance vs account benchmark: {row.cpl > 0 ? `${((row.cpl/cplTarget - 1)*100).toFixed(0)}%` : "N/A"}.</p>
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
  const [activeTab, setActiveTab] = useState<GoogleTabType>("Age");
  const [selectedCampaign, setSelectedCampaign] = useState(ACCOUNT_OVERVIEW);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [columnSize, setColumnSize] = useState<"compact" | "normal" | "wide">("normal");
  const [sortKey, setSortKey] = useState<string>("cost");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

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
    
    // Google usually sends breakdowns organized by campaign ID
    const source = data.breakdowns;
    const aggregated: Record<string, GoogleBreakdownRow> = {};
    
    const resolveAndAdd = (campBreakdowns: any) => {
      const rows = campBreakdowns[tabKey] || [];
      rows.forEach((r: any) => {
        const dim = r.age_range || r.gender || r.device || r.region || r.dimension || "Unknown";
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
    };

    if (selectedCampaign === ACCOUNT_OVERVIEW) {
      if (Array.isArray(source)) source.forEach(c => resolveAndAdd(c.breakdowns || {}));
      else Object.values(source).forEach((v: any) => typeof v === 'object' && resolveAndAdd(v.breakdowns || v));
    } else {
      const target = Array.isArray(source) ? source.find(c => c.campaign_id === selectedCampaign) : source[selectedCampaign];
      if (target) resolveAndAdd(target.breakdowns || target);
    }

    return Object.values(aggregated).map(r => ({
      ...r,
      ctr: r.impressions > 0 ? (r.clicks / r.impressions) * 100 : 0,
      cpc: r.clicks > 0 ? r.cost / r.clicks : 0,
      cpl: r.conversions > 0 ? r.cost / r.conversions : 0,
      cvr: r.clicks > 0 ? (r.conversions / r.clicks) * 100 : 0,
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

  if (isLoading) return <div className="p-12 text-center text-muted-foreground"><Clock className="w-8 h-8 mx-auto mb-2 animate-spin opacity-20" /><p>Scanning Google demographics...</p></div>;

  if (!data?.available) {
    return (
      <Card className="m-6 bg-muted/20 border-border/50">
        <CardContent className="p-12 text-center">
          <Clock className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">
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
          <Clock className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">
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
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/20 border-b border-border/50">
                <th className="p-3 w-10"></th>
                <th className="p-3 text-left font-bold uppercase tracking-widest text-muted-foreground">Dimension</th>
                <th className="p-3 text-right font-bold uppercase tracking-widest text-muted-foreground">Cost</th>
                <th className="p-3 text-right font-bold uppercase tracking-widest text-muted-foreground">Clicks</th>
                <th className="p-3 text-right font-bold uppercase tracking-widest text-muted-foreground">CTR</th>
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
                       <td className="p-3 text-right tabular-nums font-bold text-foreground">{row.conversions}</td>
                       <td className={cn("p-3 text-right tabular-nums font-bold", row.cpl > 0 && row.cpl < 850 ? "text-emerald-400" : "text-foreground")}>{row.cpl > 0 ? formatINR(row.cpl, 0) : "—"}</td>
                       <td className="p-3 text-center">
                         <UnifiedActions compact item={{ id: itemId, description: `Google ${activeTab}: ${row.dimension}`, autoExecutable: false }}
                            entityId={itemId} entityName={`${activeTab}: ${row.dimension}`} entityType="adset" actionType="MANUAL_ACTION"
                            recommendation="Monitor segment" onStateChange={() => {}} />
                       </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-[#F0BC00]/5">
                        <td colSpan={8} className="p-4 border-b border-[#F0BC00]/20 text-xs text-muted-foreground">
                          Strategic analysis for Google segment <strong>{row.dimension}</strong>. Cost efficiency is tracking and conversions are being qualified. Adjust bids if CPA drift exceeds 20%.
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
  
  function toggleExpand(id: string) { setExpandedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
}

// ─── Shared UI Components ──────────────────────────────────────────

function MetricCard({ icon: Icon, label, value, subValue, color }: any) {
  return (
    <Card className="bg-card/50 border-border/40">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <Icon className={cn("w-4 h-4", color)} />
          <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label}</span>
        </div>
        <p className="text-lg font-black tracking-tight">{value}</p>
        {subValue && <p className="text-[10px] text-muted-foreground mt-1">{subValue}</p>}
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
      <span className="text-[10px] text-muted-foreground w-8 text-right font-medium">{pct.toFixed(0)}%</span>
    </div>
  );
}
