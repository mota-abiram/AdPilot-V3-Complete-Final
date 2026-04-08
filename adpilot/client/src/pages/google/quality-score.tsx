import { useState, useMemo, useEffect } from "react";
import { useClient } from "@/lib/client-context";
import { DataTablePagination } from "@/components/data-table-pagination";
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Search,
  AlertTriangle,
  CheckCircle,
  XCircle,
  BarChart2,
  RefreshCcw,
  Info
} from "lucide-react";
import { formatINR, truncate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";
import { Button } from "@/components/ui/button";

// ─── 1. DATA CONTRACT ────────────────────────────────────────────────

interface QsKeyword {
  keyword_id: string;
  keyword_text: string;
  campaign_name: string;
  ad_group_name: string;
  match_type: string;
  quality_score: number;
  expected_ctr: string;
  landing_page_experience: string;
  ad_relevance: string;
  impressions: number;
  clicks: number;
  conversions: number;
  cost: number;
  cpc: number;
  cpl: number;
  optimization_actions: string[];
}

interface QsCampaignSummary {
  campaign_name: string;
  avg_qs: number;
  keyword_count: number;
  below_4: number;
  below_6: number;
}

interface QualityScoreData {
  keywords: QsKeyword[];
  campaigns: Array<{ id: string; name: string }>;
  perCampaign: QsCampaignSummary[];
  alerts: string[];
  distribution: Array<{ score: string; count: number }>;
  summary: {
    total: number;
    avgQs: number;
    below4: number;
    below6: number;
    excellentPct: number;
    poorPct: number;
  };
}

// ─── 2. UTILITIES ────────────────────────────────────────────────────

const safeArray = <T,>(arr: any): T[] => (Array.isArray(arr) ? arr : []);
const safeNumber = (val: any): number => (typeof val === "number" && !isNaN(val) ? val : 0);
const safeString = (val: any, fallback = "—"): string => (typeof val === "string" ? val : fallback);

/**
 * Normalization Layer: Converts raw API data into a strict, crash-proof object.
 */
function normalizeQualityScore(rawData: any): QualityScoreData {
  const analysis = rawData?.quality_score_analysis || {};
  const rawKeywords = safeArray<any>(analysis.keywords);
  const rawCampaigns = safeArray<any>(rawData?.campaigns);

  // Normalize Keywords
  const keywords: QsKeyword[] = rawKeywords.map(k => ({
    keyword_id: safeString(k?.keyword_id),
    keyword_text: safeString(k?.keyword_text, "Unknown Keyword"),
    campaign_name: safeString(k?.campaign_name, "Unknown Campaign"),
    ad_group_name: safeString(k?.ad_group_name, "Unknown Ad Group"),
    match_type: safeString(k?.match_type, "BROAD"),
    quality_score: safeNumber(k?.quality_score),
    expected_ctr: safeString(k?.expected_ctr, "AVERAGE"),
    landing_page_experience: safeString(k?.landing_page_experience, "AVERAGE"),
    ad_relevance: safeString(k?.ad_relevance, "AVERAGE"),
    impressions: safeNumber(k?.impressions),
    clicks: safeNumber(k?.clicks),
    conversions: safeNumber(k?.conversions),
    cost: safeNumber(k?.cost),
    cpc: safeNumber(k?.cpc),
    cpl: safeNumber(k?.cpl),
    optimization_actions: safeArray(k?.optimization_actions),
  }));

  // Normalize Campaign Options
  const campaigns = rawCampaigns
    .filter((c: any) => c && (c.campaign_type === "branded" || c.campaign_type === "location"))
    .map((c: any) => ({
      id: safeString(c.campaign_id || c.id || c.name),
      name: safeString(c.name)
    }));

  // Build Score Distribution
  const distribution = Array.from({ length: 10 }, (_, i) => {
    const score = i + 1;
    return {
      score: String(score),
      count: keywords.filter(k => Math.round(k.quality_score) === score).length
    };
  });

  // Calculate Aggregates
  const total = keywords.length;
  const avgQs = total > 0 ? keywords.reduce((s, k) => s + k.quality_score, 0) / total : 0;
  const below4 = keywords.filter(k => k.quality_score < 4).length;
  const below6 = keywords.filter(k => k.quality_score < 6).length;
  const excellentCount = keywords.filter(k => k.quality_score >= 7).length;
  const poorCount = keywords.filter(k => k.quality_score < 5).length;

  return {
    keywords,
    campaigns,
    perCampaign: safeArray<any>(analysis.per_campaign).map(pc => ({
      campaign_name: safeString(pc?.campaign_name),
      avg_qs: safeNumber(pc?.avg_qs),
      keyword_count: safeNumber(pc?.keyword_count),
      below_4: safeNumber(pc?.below_4),
      below_6: safeNumber(pc?.below_6),
    })),
    alerts: safeArray(analysis.alerts),
    distribution,
    summary: {
      total,
      avgQs,
      below4,
      below6,
      excellentPct: total > 0 ? (excellentCount / total) * 100 : 0,
      poorPct: total > 0 ? (poorCount / total) * 100 : 0,
    }
  };
}

// ─── 3. UI HELPERS ───────────────────────────────────────────────────

function subFactorBadge(value: string) {
  const v = value.toUpperCase();
  if (v === "ABOVE_AVERAGE") return { label: "Above Avg", cls: "bg-emerald-500/15 text-emerald-400" };
  if (v === "AVERAGE") return { label: "Average", cls: "bg-amber-500/15 text-amber-400" };
  if (v === "BELOW_AVERAGE") return { label: "Below Avg", cls: "bg-red-500/15 text-red-400" };
  return { label: value || "—", cls: "bg-gray-500/15 text-gray-400" };
}

const qsColor = (qs: number) => qs > 6 ? "text-emerald-400" : qs >= 4 ? "text-amber-400" : "text-red-400";
const qsBgColor = (qs: number) => qs > 6 ? "bg-emerald-500" : qs >= 4 ? "bg-amber-500" : "bg-red-500";
const qsBarBg = (qs: number) => qs > 6 ? "bg-emerald-500/20" : qs >= 4 ? "bg-amber-500/20" : "bg-red-500/20";

const ALL_CAMPAIGNS = "__all__";

// ─── 4. COMPONENT ────────────────────────────────────────────────────

export default function GoogleQualityScorePage() {
  const { analysisData: rawData, isLoadingAnalysis: isLoading } = useClient();

  // Normalized Data Access
  const data = useMemo(() => normalizeQualityScore(rawData), [rawData]);

  // Viewport State
  const [selectedCampaign, setSelectedCampaign] = useState(ALL_CAMPAIGNS);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortKey, setSortKey] = useState<keyof QsKeyword>("quality_score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [openAdGroups, setOpenAdGroups] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Sync Log for Debugging
  useEffect(() => {
    if (rawData) console.log("[GQS] Raw Data Update:", rawData);
  }, [rawData]);

  // Derived: Filtered Keywords
  const filteredKeywords = useMemo(() => {
    let list = [...data.keywords];

    if (selectedCampaign !== ALL_CAMPAIGNS) {
      const camp = data.campaigns.find(c => c.id === selectedCampaign);
      if (camp) list = list.filter(k => k.campaign_name === camp.name);
    }

    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      list = list.filter(k =>
        k.keyword_text.toLowerCase().includes(q) ||
        k.ad_group_name.toLowerCase().includes(q)
      );
    }

    return list.sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      return sortDir === "asc"
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });
  }, [data, selectedCampaign, searchTerm, sortKey, sortDir]);

  // Derived: Grouped Map
  const adGroupMap = useMemo(() => {
    const map: Record<string, QsKeyword[]> = {};
    filteredKeywords.forEach(kw => {
      if (!map[kw.ad_group_name]) map[kw.ad_group_name] = [];
      map[kw.ad_group_name].push(kw);
    });
    return map;
  }, [filteredKeywords]);

  // ─── RENDER GUARDS ────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-56 mb-4" />
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-md" />)}
        </div>
        <Skeleton className="h-[400px] rounded-md" />
      </div>
    );
  }

  if (data.keywords.length === 0) {
    return (
      <div className="p-6 space-y-4 max-w-[1800px]">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Search className="w-5 h-5 text-primary" />
            Quality Score Analysis
          </h1>
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
            <RefreshCcw className="w-3 h-3 mr-2" /> Refresh Data
          </Button>
        </div>
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-20 text-center">
            <div className="p-3 rounded-full bg-muted mb-4 text-muted-foreground">
              <Info className="w-8 h-8" />
            </div>
            <h3 className="t-page-title">No keyword data found</h3>
            <p className="text-sm text-muted-foreground max-w-md mt-2">
              Quality Score monitoring is active, but we couldn't find keywords for this client.
              Ensure 'keyword_view' is enabled in your Google Ads agent configuration.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 max-w-[1800px]">
      {/* ─── Header ─── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-primary" />
            Quality Score Explorer
          </h1>
          <p className="type-xs text-muted-foreground mt-1">
            Analyzing {data.summary.total} keywords across {data.campaigns.length} search campaigns
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search keywords or ad groups..."
              className="pl-8 pr-3 py-2 text-xs rounded-lg border bg-background w-64 focus:ring-1 ring-primary/30 outline-none"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <Select value={selectedCampaign} onValueChange={setSelectedCampaign}>
            <SelectTrigger className="w-[300px] h-9 text-xs">
              <SelectValue placeholder="All Campaigns" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_CAMPAIGNS}>All Search Campaigns</SelectItem>
              {data.campaigns.map(c => (
                <SelectItem key={c.id} value={c.id}>{truncate(c.name, 40)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ─── KPI Overview ─── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { label: "Avg QS", value: data.summary.avgQs.toFixed(1), color: qsColor(data.summary.avgQs), suffix: "/ 10" },
          { label: "Critical (< 4)", value: data.summary.below4, color: data.summary.below4 > 0 ? "text-red-400" : "text-emerald-400" },
          { label: "Poor (< 6)", value: data.summary.below6, color: data.summary.below6 > 0 ? "text-amber-400" : "text-emerald-400" },
          { label: "Total Keywords", value: data.summary.total, color: "text-foreground" },
          { label: "Green Ratio (7+)", value: `${data.summary.excellentPct.toFixed(0)}%`, color: data.summary.excellentPct > 50 ? "text-emerald-400" : "text-amber-400" },
          { label: "Red Ratio (< 5)", value: `${data.summary.poorPct.toFixed(0)}%`, color: data.summary.poorPct > 20 ? "text-red-400" : "text-emerald-400" },
        ].map((kpi, i) => (
          <Card key={i} className="hover:border-primary/20 transition-colors">
            <CardContent className="card-content-premium">
              <p className="text-[10px] uppercase font-bold tracking-[0.08em] text-muted-foreground">{kpi.label}</p>
              <p className={cn("text-2xl font-black mt-1 tabular-nums", kpi.color)}>
                {kpi.value}
                {kpi.suffix && <span className="text-xs font-medium ml-1 text-muted-foreground">{kpi.suffix}</span>}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ─── Distribution & Campaign View ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="bg-card/50">
          <CardContent className="card-content-premium">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">QS Distribution</p>
              <Badge variant="secondary" className="bg-primary/5 text-primary">Live Scan</Badge>
            </div>
            <div style={{ height: 160 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.distribution} barCategoryGap="15%">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} opacity={0.4} />
                  <XAxis dataKey="score" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <RechartsTooltip cursor={{ fill: "transparent" }} content={<CustomTooltip />} />
                  <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                    {data.distribution.map((entry, idx) => (
                      <Cell key={idx} fill={qsBgColor(Number(entry.score))} opacity={0.8} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 max-h-[220px] overflow-y-auto">
          <CardContent className="card-content-premium">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-4">QS by Campaign</p>
            <div className="space-y-4">
              {data.perCampaign.slice(0, 5).map((pc, i) => (
                <div key={i} className="group">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-foreground truncate max-w-[200px]">{pc.campaign_name}</span>
                    <span className={cn("text-xs font-bold", qsColor(pc.avg_qs))}>{pc.avg_qs.toFixed(1)}</span>
                  </div>
                  <div className="w-full h-1 rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn("h-full transition-all duration-700", qsBgColor(pc.avg_qs))}
                      style={{ width: `${(pc.avg_qs / 10) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ─── Alerts Banner ─── */}
      {data.alerts.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 flex gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-amber-500 uppercase tracking-wider">Strategic Alerts</p>
            {data.alerts.map((a, i) => <p key={i} className="text-xs text-amber-200/70 mt-0.5">· {a}</p>)}
          </div>
        </div>
      )}

      {/* ─── Ad Group Sections ─── */}
      <div className="space-y-2 pt-2">
        {(() => {
          const allEntries = Object.entries(adGroupMap);
          const paginated = allEntries.slice((page - 1) * pageSize, page * pageSize);

          return paginated.map(([name, keywords]) => {
            const agAvg = keywords.reduce((s, k) => s + k.quality_score, 0) / keywords.length;
            const agCritical = keywords.filter(k => k.quality_score < 4).length;
            const isOpen = openAdGroups[name] !== false;

            return (
              <Collapsible key={name} open={isOpen} onOpenChange={() => setOpenAdGroups(p => ({ ...p, [name]: !p[name] }))}>
                <Card className={cn("transition-all border-l-4",
                  agAvg >= 7 ? "border-l-emerald-500" : agAvg >= 5 ? "border-l-amber-500" : "border-l-red-500"
                )}>
                  <CollapsibleTrigger asChild>
                    <div className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-muted/20">
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-foreground">{name}</span>
                        <span className="text-[10px] text-muted-foreground uppercase font-medium">{keywords.length} keywords</span>
                      </div>
                      <div className="flex items-center gap-4 ml-auto">
                        <div className="text-right">
                          <p className="text-[10px] uppercase font-bold text-muted-foreground">AG Score</p>
                          <p className={cn("text-sm font-black", qsColor(agAvg))}>{agAvg.toFixed(1)}</p>
                        </div>
                        {agCritical > 0 && (
                          <Badge variant="destructive" className="bg-red-500/10 text-red-400 h-6 px-2">{agCritical} Alert</Badge>
                        )}
                        <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
                      </div>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="overflow-x-auto border-t border-border/40">
                      <table className="t-table w-full text-left">
                        <thead>
                          <tr className="bg-muted/30">
                            {["Keyword", "Score", "Exp CTR", "Relevance", "LP Exp", "Conv", "CPL"].map(h => (
                              <th key={h} className="px-4 py-4 t-label font-bold uppercase tracking-widest text-muted-foreground/80">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {keywords.map((kw, idx) => (
                            <tr key={idx} className="border-b last:border-0 hover:bg-muted/10">
                              <td className="p-3">
                                <p className="font-semibold text-foreground">{kw.keyword_text}</p>
                                <p className="text-[10px] text-muted-foreground">{kw.match_type}</p>
                              </td>
                              <td className="p-3">
                                <div className="flex items-center gap-2">
                                  <div className={cn("w-12 h-1.5 rounded-full", qsBarBg(kw.quality_score))}>
                                    <div className={cn("h-full rounded-full", qsBgColor(kw.quality_score))} style={{ width: `${(kw.quality_score / 10) * 100}%` }} />
                                  </div>
                                  <span className={cn("font-bold", qsColor(kw.quality_score))}>{kw.quality_score}</span>
                                </div>
                              </td>
                              <td className="p-3"><FactorBadge val={kw.expected_ctr} /></td>
                              <td className="p-3"><FactorBadge val={kw.ad_relevance} /></td>
                              <td className="p-3"><FactorBadge val={kw.landing_page_experience} /></td>
                              <td className="p-3 font-semibold text-foreground">{kw.conversions}</td>
                              <td className="p-3 font-bold text-foreground/80">{kw.cpl > 0 ? formatINR(kw.cpl, 0) : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {/* SOP Section */}
                    {agAvg < 6 && (
                      <div className="bg-primary/5 p-4 flex gap-4 border-t">
                        <Info className="w-5 h-5 text-primary shrink-0" />
                        <div>
                          <p className="text-xs font-bold text-primary uppercase">AdPilot SOP Recommendation</p>
                          <p className="text-[11px] text-muted-foreground mt-1">
                            This ad group has a sub-optimal QS. Ensure your RSA ad copy contains these keywords in headlines 1-3
                            and that the landing page H1 precisely matches the high-volume terms in this set.
                          </p>
                        </div>
                      </div>
                    )}
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            );
          });
        })()}

        <DataTablePagination
          totalItems={Object.keys(adGroupMap).length}
          pageSize={pageSize}
          currentPage={page}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </div>
    </div>
  );
}

function FactorBadge({ val }: { val: string }) {
  const b = subFactorBadge(val);
  return (
    <Badge variant="secondary" className={cn("px-1.5 py-0 text-[10px]", b.cls)}>
      {b.label}
    </Badge>
  );
}

function CustomTooltip({ active, payload }: any) {
  if (active && payload?.[0]) {
    return (
      <div className="bg-card border border-border px-3 py-2 rounded-lg shadow-xl shadow-black/50">
        <p className="type-xs font-bold text-foreground">Score {payload[0].payload.score}</p>
        <p className="type-xs text-primary">{payload[0].value} keywords</p>
      </div>
    );
  }
  return null;
}
