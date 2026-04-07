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
  TooltipProvider,
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

const META_COLUMN_CONFIG = [
  {
    column: "Dimension",
    source: "Meta API",
    type: "API",
    description: "Breakdown value (age, gender, placement, device, region)",
    green: "-",
    yellow: "-",
    red: "-",
    action: "Per active tab"
  },
  {
    column: "Score",
    source: "Agent",
    type: "COMPUTED",
    description: "Composite score = CPL (50) + CTR (20) + Volume (20) + Spend Util (10)",
    green: ">= 70",
    yellow: "40–69",
    red: "< 40",
    action: "Click to expand breakdown"
  },
  {
    column: "Spend",
    source: "Meta API",
    type: "API",
    description: "Spend for this segment",
    green: "-",
    yellow: "-",
    red: "-",
    action: "-"
  },
  {
    column: "Spend %",
    source: "Agent",
    type: "COMPUTED",
    description: "% contribution to total spend",
    green: "-",
    yellow: "-",
    red: "-",
    action: "Render as progress bar"
  },
  {
    column: "Impressions",
    source: "Meta API",
    type: "API",
    description: "Impressions for segment",
    green: "-",
    yellow: "-",
    red: "-",
    action: "-"
  },
  {
    column: "Clicks",
    source: "Meta API",
    type: "API",
    description: "Clicks for segment",
    green: "-",
    yellow: "-",
    red: "-",
    action: "-"
  },
  {
    column: "CTR",
    source: "Meta API",
    type: "API",
    description: "Click-through rate",
    green: "-",
    yellow: "-",
    red: "-",
    action: "-"
  },
  {
    column: "Leads",
    source: "Meta API",
    type: "API",
    description: "Conversions for segment",
    green: "-",
    yellow: "-",
    red: "-",
    action: "-"
  },
  {
    column: "CPL",
    source: "Meta API",
    type: "COMPUTED",
    description: "Cost per lead = Spend / Leads",
    green: "<= Target",
    yellow: "Near target",
    red: "> Alert threshold",
    action: "Color code vs thresholds"
  },
  {
    column: "Recommendation",
    source: "Agent",
    type: "COMPUTED",
    description: "Action based on score + CPL + volume",
    green: "Scale budget",
    yellow: "Monitor / Review",
    red: "Reduce spend / Exclude",
    action: "Geo alerts for region tab"
  }
];

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
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <div className="p-3 rounded-xl bg-background/40 border border-border/50 shadow-sm">
        <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider mb-1">CPL Efficiency (50)</p>
        <div className="flex items-end gap-2">
          <p className="text-sm font-bold">{score.cplScore}</p>
          <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden mb-1">
            <div className={`h-full ${score.cplScore >= 35 ? 'bg-emerald-500' : 'bg-red-500'}`} style={{ width: `${(score.cplScore/50)*100}%` }} />
          </div>
        </div>
      </div>
      <div className="p-3 rounded-xl bg-background/40 border border-border/50 shadow-sm">
        <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider mb-1">CTR Impact (20)</p>
        <div className="flex items-end gap-2">
          <p className="text-sm font-bold">{score.ctrScore}</p>
          <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden mb-1">
            <div className={`h-full ${score.ctrScore >= 14 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${(score.ctrScore/20)*100}%` }} />
          </div>
        </div>
      </div>
      <div className="p-3 rounded-xl bg-background/40 border border-border/50 shadow-sm">
        <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider mb-1">Lead Volume (20)</p>
        <div className="flex items-end gap-2">
          <p className="text-sm font-bold">{score.volumeScore}</p>
          <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden mb-1">
            <div className={`h-full bg-primary`} style={{ width: `${(score.volumeScore/20)*100}%` }} />
          </div>
        </div>
      </div>
      <div className="p-3 rounded-xl bg-background/40 border border-border/50 shadow-sm">
        <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider mb-1">Spend Util (10)</p>
        <div className="flex items-end gap-2">
          <p className="text-sm font-bold">{score.efficiencyScore}</p>
          <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden mb-1">
            <div className={`h-full bg-blue-500`} style={{ width: `${(score.efficiencyScore/10)*100}%` }} />
          </div>
        </div>
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
    cplScore = Math.min(50, Math.max(0, ratio * 35)); // High weight on CPL
  } else if (row.spend > 1000) {
    cplScore = 5;
  } else {
    cplScore = 25; // neutral
  }

  let ctrScore = 0;
  if (row.ctr > 0) {
    const ratio = row.ctr / ctrBenchmark;
    ctrScore = Math.min(20, Math.max(0, ratio * 15));
  }

  let volumeScore = 0;
  if (totalLeads > 0) {
    volumeScore = Math.min(20, (row.leads / totalLeads) * 40);
  }

  let efficiencyScore = 0;
  if (totalSpend > 0) {
    const spendPct = (row.spend / totalSpend) * 100;
    efficiencyScore = Math.min(10, spendPct > 15 ? 10 : spendPct);
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
    return { type: "exclude", text: "Exclude Segment", color: "text-red-400", reason: "Outside target geography" };
  }
  if (score >= 75) return { type: "scale", text: "Scale Budget", color: "text-emerald-400", reason: "Top tier performance" };
  if (score >= 60) return { type: "monitor", text: "Monitor Pacing", color: "text-emerald-300", reason: "Healthy efficiency" };
  if (score >= 40) return { type: "flag", text: "Optimization Needed", color: "text-amber-400", reason: "Average performance" };
  if (score > 0) return { type: "reduce", text: "Reduce Spend", color: "text-red-400", reason: "Severe inefficiency" };
  return { type: "none", text: "Needs Data", color: "text-muted-foreground", reason: "Insufficient impressions" };
}

// ─── Main Component ────────────────────────────────────────────────

export default function BreakdownsPage() {
  const { activeClient: client, activeCadence: globalCadence, activePlatform } = useClient();

  const clientId = client?.id || "amara";
  const platformKey = activePlatform === "google" ? "google" : "meta";
  const apiBase = `/api/clients/${clientId}`;

  const { data: analysisData, isLoading: isLoadingAnalysis } = useQuery({
    queryKey: [apiBase, platformKey, "analysis", globalCadence],
    queryFn: async () => {
      const url = `${apiBase}/${platformKey}/analysis?cadence=${globalCadence}`;
      const res = await apiRequest("GET", url);
      return res.json();
    },
  });

  const activeCadence = analysisData?.active_cadence || globalCadence;

  return (
    <div className="min-h-screen bg-background">
      {platformKey === "meta" ? (
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
  const [sortKey, setSortKey] = useState<string>("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function toggleSort(key: string) {
    if (sortKey === key) { setSortDir(d => d === "asc" ? "desc" : "asc"); }
    else { setSortKey(key); setSortDir("desc"); }
  }

  function toggleExpand(id: string) { setExpandedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }

  const thresholds = analysisData?.dynamic_thresholds;
  const cplTarget = thresholds?.cpl_target ?? 1000;
  const ctrTarget = thresholds?.ctr_min ?? 0.8;

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
    source.forEach((row: any) => {
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

  const totalSpend = rows.reduce((s, r) => s + r.spend, 0);
  const totalLeads = rows.reduce((s, r) => s + r.leads, 0);

  const scoredRows = useMemo(() => {
    return rows.map((row) => {
      const score = computeBreakdownScore(row, cplTarget, ctrTarget, totalLeads, totalSpend);
      const rec = getRecommendationType(row, score.total, activeTab, row.is_target_location);
      return { row, score, rec };
    });
  }, [rows, cplTarget, ctrTarget, totalLeads, totalSpend, activeTab]);

  if (isLoading) return <div className="p-12 text-center text-muted-foreground"><Clock className="w-8 h-8 mx-auto mb-2 animate-spin opacity-20" /><p>Synthesizing Meta Ads Breakdowns...</p></div>;

  return (
    <div className="p-6 space-y-6 max-w-[1600px]">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
            <BarChart3 className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight">Meta Breakdowns Engine</h2>
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">Performance Audit Layer</p>
          </div>
        </div>
        <Select value={selectedCampaign} onValueChange={setSelectedCampaign}>
          <SelectTrigger className="w-[340px] h-11 bg-card border-border/60 shadow-md">
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

      <div className="flex items-center gap-1 bg-muted/20 p-1 rounded-xl border border-border/40 w-fit">
        {META_TABS.map(tab => (
          <button key={tab} onClick={() => { setActiveTab(tab); setExpandedIds(new Set()); }}
            className={cn("px-6 py-2 text-[10px] font-bold uppercase tracking-widest rounded-lg transition-all", activeTab === tab ? "bg-primary text-primary-foreground shadow-lg" : "text-muted-foreground hover:text-foreground")}>
            {tab}
          </button>
        ))}
      </div>

      <Card className="border-border/60 shadow-2xl overflow-hidden bg-card/40 backdrop-blur-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/30 border-b border-border/60">
                {META_COLUMN_CONFIG.map((col, idx) => (
                  <th key={idx} className={cn("p-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground text-left")}>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger className="flex items-center gap-1.5 hover:text-foreground transition-colors">
                          {col.column} <Info className="w-3 h-3 opacity-40" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[200px] p-3 space-y-2 bg-card border-border shadow-2xl">
                          <p className="font-bold border-b border-border/50 pb-1">{col.column} SOP</p>
                          <p className="text-[10px] leading-relaxed text-muted-foreground">{col.description}</p>
                          <div className="grid grid-cols-3 gap-1 pt-1 border-t border-border/50">
                            <div className="text-emerald-400 font-bold">G: {col.green}</div>
                            <div className="text-amber-400 font-bold">Y: {col.yellow}</div>
                            <div className="text-red-400 font-bold">R: {col.red}</div>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scoredRows.map(({ row, score, rec }, i) => {
                const isExpanded = expandedIds.has(row.dimension);
                const spendPct = totalSpend > 0 ? (row.spend / totalSpend) * 100 : 0;
                return (
                  <React.Fragment key={i}>
                    <tr className={cn("border-b border-border/20 hover:bg-muted/30 transition-all cursor-pointer group", isExpanded && "bg-primary/5")} onClick={() => toggleExpand(row.dimension)}>
                      <td className="p-4 font-bold text-foreground text-sm tracking-tight">{row.dimension}</td>
                      <td className="p-4">
                        <span className={cn("inline-flex items-center justify-center min-w-[32px] h-8 rounded-lg font-bold text-xs border shadow-sm", getScoreBg(score.total), getScoreColor(score.total))}>
                          {score.total}
                        </span>
                      </td>
                      <td className="p-4 tabular-nums font-bold text-foreground/80">{formatINR(row.spend, 0)}</td>
                      <td className="p-4"><ProgressBar pct={spendPct} color="bg-primary" /></td>
                      <td className="p-4 tabular-nums text-muted-foreground font-medium">{formatNumber(row.impressions)}</td>
                      <td className="p-4 tabular-nums text-muted-foreground font-medium">{formatNumber(row.clicks)}</td>
                      <td className="p-4 tabular-nums font-bold text-foreground/70">{formatPct(row.ctr)}</td>
                      <td className="p-4 tabular-nums font-bold text-foreground">{row.leads}</td>
                      <td className={cn("p-4 tabular-nums font-bold", getCplColor(row.cpl, thresholds))}>{row.cpl > 0 ? formatINR(row.cpl, 0) : "—"}</td>
                      <td className="p-4">
                        <div className={cn("flex items-center gap-2 font-bold uppercase text-[9px] tracking-wider", rec.color)}>
                          <div className={cn("w-1.5 h-1.5 rounded-full animate-pulse", rec.type === 'scale' ? 'bg-emerald-500' : rec.type === 'monitor' ? 'bg-emerald-300' : rec.type === 'flag' ? 'bg-amber-400' : 'bg-red-500')} />
                          {rec.text}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-muted/10">
                        <td colSpan={10} className="p-8 border-b border-primary/20 space-y-6">
                          <div className="space-y-4">
                            <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary underline underline-offset-8">AI Strategic Audit Breakdown</h4>
                            <ScoreExpansion score={score} row={row} cplTarget={cplTarget} ctrTarget={ctrTarget} />
                            <div className="p-5 rounded-2xl border border-primary/20 bg-background/80 shadow-inner space-y-2">
                              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Expert Recommendation:</p>
                              <p className="text-sm font-bold text-foreground leading-relaxed">
                                System indicates <span className={cn("font-bold", rec.color)}>{rec.text}</span> because {rec.reason.toLowerCase()}. 
                                Efficiency Score of <span className="text-primary font-bold">{score.total}/100</span> suggests this segment is 
                                {score.total >= 70 ? " prime for budget acceleration." : " currently underperforming relative to account-wide benchmarks."}
                              </p>
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

  function toggleSort(key: string) {
    if (sortKey === key) { setSortDir(d => d === "asc" ? "desc" : "asc"); }
    else { setSortKey(key); setSortDir("desc"); }
  }

  function toggleExpand(id: string) { setExpandedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }

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

    // Google demographic_breakdowns is a global object with keys like 'age', 'gender', 'device'
    // Each key contains a flat array of records for ALL campaigns.
    const allRecords = data.breakdowns[tabKey] || [];

    // 1. Filter by selected campaign if not ACCOUNT_OVERVIEW
    const filtered = selectedCampaign === ACCOUNT_OVERVIEW
      ? allRecords
      : allRecords.filter((r: any) => r.campaign_id === selectedCampaign);

    // 2. Aggregate by dimension
    const aggregated: Record<string, GoogleBreakdownRow> = {};

    filtered.forEach((r: any) => {
      // Handle the various field names Google uses for dimensions
      const dim = r.age_range || r.gender || r.device || r.region || r.location || r.dimension || "Unknown";

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

    // 3. Final metric derivation
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
                          recommendation="Monitor segment" onStateChange={() => { }} />
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
