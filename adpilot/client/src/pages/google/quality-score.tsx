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
import { ArrowUpDown, ChevronDown, ChevronUp, Search, AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import { formatINR, formatPct, truncate } from "@/lib/format";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────

interface QsKeyword {
  keyword_id?: string;
  keyword_text: string;
  campaign_name?: string;
  ad_group_name?: string;
  match_type?: string;
  quality_score: number;
  expected_ctr: string;
  landing_page_experience: string;
  ad_relevance: string;
  impressions?: number;
  clicks?: number;
  conversions?: number;
  cost?: number;
  cpc?: number;
  cpl?: number;
  optimization_actions?: string[];
}

interface QsCampaignSummary {
  campaign_name: string;
  avg_qs: number;
  keyword_count: number;
  below_4: number;
  below_6: number;
}

interface QsAnalysis {
  summary?: {
    avg_qs: number;
    total_keywords?: number;
    excellent_8_10?: number;
    good_6_7?: number;
    poor_1_5?: number;
    needs_attention?: string[];
  };
  account_average_qs?: number;
  keywords: QsKeyword[];
  per_campaign?: QsCampaignSummary[];
  alerts?: string[];
  qs_distribution?: Record<string, number>;
}

// ─── Helpers ─────────────────────────────────────────────────────────

type SortKey = "keyword_text" | "quality_score" | "expected_ctr" | "ad_relevance" | "landing_page_experience" | "impressions" | "clicks" | "conversions" | "cost";
type SortDir = "asc" | "desc";

function subFactorBadge(value: string) {
  const v = (value || "").toUpperCase();
  if (v === "ABOVE_AVERAGE") return { label: "Above Avg", cls: "bg-emerald-500/15 text-emerald-400" };
  if (v === "AVERAGE") return { label: "Average", cls: "bg-amber-500/15 text-amber-400" };
  if (v === "BELOW_AVERAGE") return { label: "Below Avg", cls: "bg-red-500/15 text-red-400" };
  return { label: value || "—", cls: "bg-gray-500/15 text-gray-400" };
}

function qsColor(qs: number): string {
  if (qs > 6) return "text-emerald-400";
  if (qs >= 4) return "text-amber-400";
  return "text-red-400";
}

function qsBgColor(qs: number): string {
  if (qs > 6) return "bg-emerald-500";
  if (qs >= 4) return "bg-amber-500";
  return "bg-red-500";
}

function qsBarBg(qs: number): string {
  if (qs > 6) return "bg-emerald-500/20";
  if (qs >= 4) return "bg-amber-500/20";
  return "bg-red-500/20";
}

const ALL_CAMPAIGNS = "__all__";

// ─── Component ───────────────────────────────────────────────────────

export default function GoogleQualityScorePage() {
  const { analysisData: data, isLoadingAnalysis: isLoading } = useClient();

  const [selectedCampaign, setSelectedCampaign] = useState(ALL_CAMPAIGNS);
  const [sortKey, setSortKey] = useState<SortKey>("quality_score");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [searchTerm, setSearchTerm] = useState("");
  const [openAdGroups, setOpenAdGroups] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [selectedCampaign, searchTerm]);

  const qsData: QsAnalysis | null = useMemo(() => {
    if (!data) return null;
    return (data as any).quality_score_analysis || null;
  }, [data]);

  // Build campaign options from analysis campaigns (Search only — branded + location)
  const campaignOptions = useMemo(() => {
    if (!data) return [];
    const campaigns = (data as any).campaigns || [];
    return campaigns
      .filter((c: any) => c.campaign_type === "branded" || c.campaign_type === "location")
      .map((c: any) => ({ id: c.campaign_id || c.id || c.name, name: c.name }));
  }, [data]);

  // Filter keywords by selected campaign and search term
  const filteredKeywords = useMemo(() => {
    if (!qsData?.keywords) return [];
    let list = [...qsData.keywords];

    if (selectedCampaign !== ALL_CAMPAIGNS) {
      const campOption = campaignOptions.find((c: any) => c.id === selectedCampaign);
      if (campOption) {
        list = list.filter((k) => k.campaign_name === campOption.name);
      }
    }

    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      list = list.filter(
        (k) =>
          k.keyword_text.toLowerCase().includes(q) ||
          (k.campaign_name || "").toLowerCase().includes(q) ||
          (k.ad_group_name || "").toLowerCase().includes(q)
      );
    }

    list.sort((a, b) => {
      const aVal = a[sortKey as keyof QsKeyword];
      const bVal = b[sortKey as keyof QsKeyword];
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      return sortDir === "asc"
        ? String(aVal || "").localeCompare(String(bVal || ""))
        : String(bVal || "").localeCompare(String(aVal || ""));
    });
    return list;
  }, [qsData, selectedCampaign, campaignOptions, sortKey, sortDir, searchTerm]);

  // Group keywords by ad group for expandable sections
  const adGroupMap = useMemo(() => {
    const map: Record<string, QsKeyword[]> = {};
    for (const kw of filteredKeywords) {
      const ag = kw.ad_group_name || "Unknown Ad Group";
      if (!map[ag]) map[ag] = [];
      map[ag].push(kw);
    }
    return map;
  }, [filteredKeywords]);

  // Summary stats for current filter
  const summaryStats = useMemo(() => {
    const kws = filteredKeywords;
    const total = kws.length;
    const below4 = kws.filter((k) => k.quality_score < 4).length;
    const below6 = kws.filter((k) => k.quality_score < 6).length;
    const avgQs = total > 0 ? kws.reduce((s, k) => s + k.quality_score, 0) / total : 0;
    return { total, below4, below6, avgQs };
  }, [filteredKeywords]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "quality_score" ? "asc" : "desc");
    }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 opacity-30" />;
    return sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  }

  function toggleAdGroup(name: string) {
    setOpenAdGroups((prev) => ({ ...prev, [name]: !prev[name] }));
  }

  // Loading state
  if (isLoading || !data) {
    return (
      <div className="p-6">
        <Skeleton className="h-8 w-56 mb-4" />
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-md" />)}
        </div>
        <Skeleton className="h-[500px] rounded-md" />
      </div>
    );
  }

  // Empty/unavailable state
  if (!qsData || !qsData.keywords || qsData.keywords.length === 0) {
    return (
      <div className="p-6 space-y-4 max-w-[1800px]">
        <div>
          <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Search className="w-5 h-5" />
            Quality Score Analysis
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Keyword-level Quality Score monitoring and optimization
          </p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <AlertTriangle className="w-10 h-10 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              Quality Score data requires keyword-level API access (keyword_view).
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              The Pipedream Google Ads connector may not support keyword_view. Data will appear after the next agent run with keyword data collection enabled.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 max-w-[1800px]">
      {/* Header + Campaign Filter */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Search className="w-5 h-5" />
            Quality Score Analysis
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Search campaigns only (Branded + Location) · {summaryStats.total} keywords
          </p>
        </div>

        <Select value={selectedCampaign} onValueChange={setSelectedCampaign} data-testid="select-campaign-qs">
          <SelectTrigger className="w-[320px] h-9 text-xs bg-background" data-testid="select-campaign-qs-trigger">
            <SelectValue placeholder="All Search Campaigns" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_CAMPAIGNS}>
              <span className="font-medium">All Search Campaigns</span>
            </SelectItem>
            {campaignOptions.map((c: any) => (
              <SelectItem key={c.id} value={c.id}>
                {truncate(c.name, 40)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Avg Quality Score</p>
            <p className={cn("text-2xl font-bold tabular-nums mt-1", qsColor(summaryStats.avgQs))}>
              {summaryStats.avgQs.toFixed(1)}
              <span className="text-xs text-muted-foreground ml-1">/ 10</span>
            </p>
          </CardContent>
        </Card>
        <Card className={summaryStats.below4 > 0 ? "border-red-500/30" : ""}>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Critical (QS &lt; 4)</p>
            <p className={cn("text-2xl font-bold tabular-nums mt-1", summaryStats.below4 > 0 ? "text-red-400" : "text-emerald-400")}>
              {summaryStats.below4}
            </p>
          </CardContent>
        </Card>
        <Card className={summaryStats.below6 > 0 ? "border-amber-500/30" : ""}>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Below Average (QS &lt; 6)</p>
            <p className={cn("text-2xl font-bold tabular-nums mt-1", summaryStats.below6 > 0 ? "text-amber-400" : "text-emerald-400")}>
              {summaryStats.below6}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Keywords</p>
            <p className="text-2xl font-bold tabular-nums text-foreground mt-1">{summaryStats.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">QS &ge; 7</p>
            <p className={cn("text-2xl font-bold tabular-nums mt-1",
              summaryStats.total > 0 && (filteredKeywords.filter(k => k.quality_score >= 7).length / summaryStats.total * 100) >= 50 ? "text-emerald-400" : "text-amber-400"
            )}>
              {summaryStats.total > 0 ? `${(filteredKeywords.filter(k => k.quality_score >= 7).length / summaryStats.total * 100).toFixed(0)}%` : "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">QS &lt; 5</p>
            <p className={cn("text-2xl font-bold tabular-nums mt-1",
              summaryStats.total > 0 && (filteredKeywords.filter(k => k.quality_score < 5).length / summaryStats.total * 100) > 20 ? "text-red-400" : "text-emerald-400"
            )}>
              {summaryStats.total > 0 ? `${(filteredKeywords.filter(k => k.quality_score < 5).length / summaryStats.total * 100).toFixed(0)}%` : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Alerts */}
      {qsData.alerts && qsData.alerts.length > 0 && (
        <Card className="border-amber-500/30">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-amber-400 flex items-center gap-1.5 mb-2">
              <AlertTriangle className="w-3.5 h-3.5" />
              Quality Score Alerts
            </p>
            <ul className="space-y-1">
              {qsData.alerts.map((alert, i) => (
                <li key={i} className="text-xs text-muted-foreground">- {alert}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Search */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search keywords..."
            className="pl-8 pr-3 py-1.5 text-xs rounded-md bg-muted/50 border border-border/50 text-foreground w-60"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            data-testid="input-search-keywords"
          />
        </div>
        <span className="text-[10px] text-muted-foreground">
          {filteredKeywords.length} keywords · {Object.keys(adGroupMap).length} ad groups
        </span>
      </div>

      {/* Expandable Ad Group Sections */}
      <div className="space-y-2">
        {(() => {
          // Paginate the flattened keyword list
          const allEntries = Object.entries(adGroupMap);
          const flatKeywords = allEntries.flatMap(([, kws]) => kws);
          const paginatedKeywords = pageSize >= flatKeywords.length ? flatKeywords : flatKeywords.slice((page - 1) * pageSize, page * pageSize);
          // Regroup paginated keywords by ad group
          const paginatedMap = new Map<string, typeof flatKeywords>();
          for (const kw of paginatedKeywords) {
            const ag = kw.ad_group_name || "Unknown Ad Group";
            if (!paginatedMap.has(ag)) paginatedMap.set(ag, []);
            paginatedMap.get(ag)!.push(kw);
          }
          return Array.from(paginatedMap.entries());
        })().map(([agName, keywords]) => {
          const agAvgQs = keywords.reduce((s, k) => s + k.quality_score, 0) / keywords.length;
          const agBelow4 = keywords.filter((k) => k.quality_score < 4).length;
          const isOpen = openAdGroups[agName] !== false; // default open
          return (
            <Collapsible key={agName} open={isOpen} onOpenChange={() => toggleAdGroup(agName)}>
              <Card>
                <CollapsibleTrigger asChild>
                  <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors" data-testid={`ag-trigger-${agName}`}>
                    <div className={cn("w-8 h-1.5 rounded-full", qsBarBg(agAvgQs))}>
                      <div className={cn("h-full rounded-full", qsBgColor(agAvgQs))} style={{ width: `${(agAvgQs / 10) * 100}%` }} />
                    </div>
                    <span className={cn("text-sm font-medium tabular-nums", qsColor(agAvgQs))}>{agAvgQs.toFixed(1)}</span>
                    <span className="text-xs font-medium text-foreground">{agName}</span>
                    <span className="text-[10px] text-muted-foreground">{keywords.length} keywords</span>
                    {agBelow4 > 0 && (
                      <Badge variant="secondary" className="text-[10px] bg-red-500/15 text-red-400">
                        {agBelow4} critical
                      </Badge>
                    )}
                    <ChevronDown className={cn("w-4 h-4 ml-auto text-muted-foreground transition-transform", isOpen && "rotate-180")} />
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border/50">
                            {[
                              { key: "keyword_text" as SortKey, label: "Keyword", align: "left" },
                              { key: "quality_score" as SortKey, label: "QS", align: "left" },
                              { key: "expected_ctr" as SortKey, label: "Exp. CTR", align: "left" },
                              { key: "ad_relevance" as SortKey, label: "Ad Relevance", align: "left" },
                              { key: "landing_page_experience" as SortKey, label: "LP Exp.", align: "left" },
                              { key: "impressions" as SortKey, label: "Impr", align: "right" },
                              { key: "clicks" as SortKey, label: "Clicks", align: "right" },
                              { key: "conversions" as SortKey, label: "Conv", align: "right" },
                              { key: "cost" as SortKey, label: "Cost", align: "right" },
                            ].map((col) => (
                              <th
                                key={col.key}
                                className={cn(
                                  "p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground cursor-pointer select-none whitespace-nowrap",
                                  col.align === "right" ? "text-right" : "text-left"
                                )}
                                onClick={() => toggleSort(col.key)}
                              >
                                <span className="inline-flex items-center gap-1">
                                  {col.label}
                                  <SortIcon col={col.key} />
                                </span>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {keywords.map((kw, idx) => {
                            const ectr = subFactorBadge(kw.expected_ctr);
                            const adrel = subFactorBadge(kw.ad_relevance);
                            const lp = subFactorBadge(kw.landing_page_experience);
                            const kwCpl = kw.cpl ?? (kw.conversions && kw.conversions > 0 ? (kw.cost || 0) / kw.conversions : 0);
                            return (
                              <tr
                                key={kw.keyword_id || `${kw.keyword_text}-${idx}`}
                                className="border-b border-border/30 hover:bg-muted/30 transition-colors"
                                data-testid={`row-keyword-${idx}`}
                              >
                                <td className="p-3 max-w-[250px]">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <div className="cursor-default">
                                        <span className="text-foreground block truncate">{truncate(kw.keyword_text, 35)}</span>
                                        {kw.match_type && (
                                          <span className="text-[10px] text-muted-foreground">{kw.match_type}</span>
                                        )}
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="max-w-xs">
                                      <p className="text-xs">{kw.keyword_text}</p>
                                      {kw.match_type && <p className="text-[10px] text-muted-foreground mt-0.5">Match: {kw.match_type}</p>}
                                    </TooltipContent>
                                  </Tooltip>
                                </td>
                                <td className="p-3">
                                  <div className="flex items-center gap-2">
                                    <div className={cn("w-10 h-1.5 rounded-full", qsBarBg(kw.quality_score))}>
                                      <div className={cn("h-full rounded-full", qsBgColor(kw.quality_score))} style={{ width: `${(kw.quality_score / 10) * 100}%` }} />
                                    </div>
                                    <span className={cn("tabular-nums font-medium", qsColor(kw.quality_score))}>{kw.quality_score}</span>
                                  </div>
                                </td>
                                <td className="p-3">
                                  <Badge variant="secondary" className={cn("text-[10px] px-1.5 py-0", ectr.cls)}>{ectr.label}</Badge>
                                </td>
                                <td className="p-3">
                                  <Badge variant="secondary" className={cn("text-[10px] px-1.5 py-0", adrel.cls)}>{adrel.label}</Badge>
                                </td>
                                <td className="p-3">
                                  <Badge variant="secondary" className={cn("text-[10px] px-1.5 py-0", lp.cls)}>{lp.label}</Badge>
                                </td>
                                <td className="p-3 text-right tabular-nums text-muted-foreground">
                                  {kw.impressions != null ? kw.impressions.toLocaleString() : "—"}
                                </td>
                                <td className="p-3 text-right tabular-nums text-muted-foreground">
                                  {kw.clicks != null ? kw.clicks.toLocaleString() : "—"}
                                </td>
                                <td className="p-3 text-right tabular-nums">
                                  <span className={(kw.conversions ?? 0) > 0 ? "text-emerald-400" : "text-muted-foreground"}>
                                    {kw.conversions ?? "—"}
                                  </span>
                                </td>
                                <td className="p-3 text-right tabular-nums text-muted-foreground">
                                  {kw.cost != null ? formatINR(kw.cost, 0) : "—"}
                                  {kwCpl > 0 && (
                                    <span className="text-[10px] block text-muted-foreground">CPL {formatINR(kwCpl, 0)}</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {/* SOP Recommendations for low-QS keywords */}
                    {(() => {
                      const lowQsKeywords = keywords.filter(k => k.quality_score < 6);
                      if (lowQsKeywords.length === 0) return null;
                      const hasLowAdRelevance = lowQsKeywords.some(k => (k.ad_relevance || "").toUpperCase() === "BELOW_AVERAGE");
                      const hasLowExpCtr = lowQsKeywords.some(k => (k.expected_ctr || "").toUpperCase() === "BELOW_AVERAGE");
                      const hasLowLp = lowQsKeywords.some(k => (k.landing_page_experience || "").toUpperCase() === "BELOW_AVERAGE");
                      return (
                        <div className="px-4 py-3 border-t border-border/30 space-y-2">
                          <p className="text-[10px] font-medium uppercase tracking-wider text-amber-400">SOP Recommendations</p>
                          <div className="space-y-1.5">
                            {hasLowAdRelevance && (
                              <div className="flex items-start gap-2 text-[11px]">
                                <XCircle className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
                                <div>
                                  <span className="text-foreground font-medium">Ad Relevance Below Average:</span>
                                  <span className="text-muted-foreground ml-1">Inject exact keyword terms into H1/H2/D1 of RSA assets. Ensure ad copy directly mirrors search intent.</span>
                                </div>
                              </div>
                            )}
                            {hasLowExpCtr && (
                              <div className="flex items-start gap-2 text-[11px]">
                                <XCircle className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
                                <div>
                                  <span className="text-foreground font-medium">Expected CTR Below Average:</span>
                                  <span className="text-muted-foreground ml-1">Add action hooks and benefit-first headlines. Use numbers, urgency, and clear CTAs in RSA assets.</span>
                                </div>
                              </div>
                            )}
                            {hasLowLp && (
                              <div className="flex items-start gap-2 text-[11px]">
                                <XCircle className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
                                <div>
                                  <span className="text-foreground font-medium">LP Experience Below Average:</span>
                                  <span className="text-muted-foreground ml-1">Check LCP &lt;2.5s, ensure mobile UX is smooth, improve form clarity and above-fold visibility.</span>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          );
        })}
        {Object.keys(adGroupMap).length === 0 && (
          <Card>
            <CardContent className="p-8 text-center text-xs text-muted-foreground">
              No keywords match the current filters.
            </CardContent>
          </Card>
        )}
        <DataTablePagination
          totalItems={filteredKeywords.length}
          pageSize={pageSize}
          currentPage={page}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </div>
    </div>
  );
}
