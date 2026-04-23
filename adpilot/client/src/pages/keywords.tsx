import { useState, useMemo } from "react";
import { useClient } from "@/lib/client-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Search,
  Target,
  TrendingUp,
  AlertTriangle,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  MousePointerClick,
  BarChart3,
  Filter,
} from "lucide-react";
import { formatINR, formatPct, truncate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DataTablePagination } from "@/components/data-table-pagination";
import { useBenchmarkTargets } from "@/hooks/use-meta-benchmarks";

interface KeywordEntry {
  keyword: string;
  match_type: string;
  campaign: string;
  ad_group: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  cpl: number;
  ctr: number;
  cpc: number;
  quality_score: number;
  status: string;
  cvr: number;
  top_is: number;
  classification?: string;
  recommendation?: string;
}

export default function KeywordsPage() {
  const { analysisData: data, isLoadingAnalysis: isLoading } = useClient();
  const benchmarkTargets = useBenchmarkTargets();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCampaign, setSelectedCampaign] = useState("all");
  const [sortKey, setSortKey] = useState<keyof KeywordEntry>("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const keywords: KeywordEntry[] = useMemo(() => {
    if (!data) return [];
    // Extract keywords from various potential places in analysis data
    const fromQs = (data as any).quality_score_analysis?.keywords || [];
    const fromBreakdowns = (data as any).keyword_breakdowns || [];
    
    // Merge and normalize
    const merged = [...fromQs, ...fromBreakdowns].map((k: any) => ({
      keyword: k.keyword_text || k.keyword || "Unknown",
      match_type: k.match_type || "—",
      campaign: k.campaign_name || k.campaign || "—",
      ad_group: k.ad_group_name || k.ad_group || "—",
      spend: k.cost || k.spend || 0,
      clicks: k.clicks || 0,
      impressions: k.impressions || 0,
      conversions: k.conversions || 0,
      cpl: k.cpl || (k.conversions > 0 ? (k.cost || k.spend || 0) / k.conversions : 0),
      ctr: k.ctr || (k.impressions > 0 ? (k.clicks / k.impressions) * 100 : 0),
      cpc: k.cpc || (k.clicks > 0 ? (k.cost || k.spend || 0) / k.clicks : 0),
      quality_score: k.quality_score || 0,
      status: k.status || "active",
      cvr: k.cvr || (k.clicks > 0 ? (k.conversions / k.clicks) * 100 : 0),
      top_is: k.top_is || k.search_top_impression_share || 0,
      classification: k.classification,
      recommendation: k.recommendation,
    }));

    return merged;
  }, [data]);

  const campaigns = useMemo(() => {
    const set = new Set<string>();
    keywords.forEach(k => k.campaign !== "—" && set.add(k.campaign));
    return Array.from(set);
  }, [keywords]);

  const filteredKeywords = useMemo(() => {
    let list = keywords.filter(k => {
      const matchSearch = k.keyword.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          k.campaign.toLowerCase().includes(searchTerm.toLowerCase());
      const matchCampaign = selectedCampaign === "all" || k.campaign === selectedCampaign;
      return matchSearch && matchCampaign;
    });

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
  }, [keywords, searchTerm, selectedCampaign, sortKey, sortDir]);

  const paginatedKeywords = useMemo(() => {
    return filteredKeywords.slice((page - 1) * pageSize, page * pageSize);
  }, [filteredKeywords, page, pageSize]);

  const stats = useMemo(() => {
    const totalSpend = filteredKeywords.reduce((s, k) => s + k.spend, 0);
    const totalConversions = filteredKeywords.reduce((s, k) => s + k.conversions, 0);
    const avgCpl = totalConversions > 0 ? totalSpend / totalConversions : 0;
    const spendWeightedQs = totalSpend > 0 
      ? filteredKeywords.reduce((s, k) => s + (k.quality_score * k.spend), 0) / totalSpend 
      : (filteredKeywords.length > 0 ? filteredKeywords.reduce((s, k) => s + k.quality_score, 0) / filteredKeywords.length : 0);
    
    return { totalSpend, totalConversions, avgCpl, avgQs: spendWeightedQs };
  }, [filteredKeywords]);

  function toggleSort(key: keyof KeywordEntry) {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-4 gap-4">
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
        </div>
        <Skeleton className="h-[600px] rounded-lg" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 max-w-[1600px]">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Search className="w-6 h-6 text-primary" />
            Keyword Intelligence
          </h1>
          <p className="text-base text-muted-foreground">
            Search keywords performance and Quality Score optimization
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search keywords..."
              className="pl-8 pr-3 py-1.5 text-xs rounded-md bg-muted/50 border border-border/50 text-foreground w-60"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <Select value={selectedCampaign} onValueChange={setSelectedCampaign}>
            <SelectTrigger className="w-[200px] h-9 text-xs bg-background">
              <SelectValue placeholder="All Campaigns" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Campaigns</SelectItem>
              {campaigns.map(c => (
                <SelectItem key={c} value={c}>{truncate(c, 30)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-card/50 border-border/40">
          <CardContent className="p-4">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">Total Spend</p>
            <p className="text-2xl font-black text-foreground tabular-nums">{formatINR(stats.totalSpend, 0)}</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/40">
          <CardContent className="p-4">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">Conversions</p>
            <p className="text-2xl font-black text-emerald-400 tabular-nums">{stats.totalConversions}</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/40">
          <CardContent className="p-4">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">Avg CPL</p>
            <p className="text-2xl font-black text-primary tabular-nums">{formatINR(stats.avgCpl, 0)}</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/40">
          <CardContent className="p-4">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">Spend-Weighted QS</p>
            <p className={cn("text-2xl font-black tabular-nums",
              stats.avgQs >= 7 ? "text-emerald-400" : stats.avgQs >= 5 ? "text-amber-400" : "text-red-400"
            )}>
              {stats.avgQs.toFixed(1)}
              <span className="text-base font-medium text-muted-foreground ml-1">/ 10</span>
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/40 shadow-sm overflow-hidden bg-card/30">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/20 border-b border-border/50">
                {[
                  { key: "keyword", label: "Keyword / Ad Group", align: "left" },
                  { key: "classification", label: "Class", align: "center" },
                  { key: "spend", label: "Spend", align: "right" },
                  { key: "impressions", label: "Impr", align: "right" },
                  { key: "clicks", label: "Clicks", align: "right" },
                  { key: "ctr", label: "CTR", align: "right" },
                  { key: "conversions", label: "Conv", align: "right" },
                  { key: "cvr", label: "CVR", align: "right" },
                  { key: "cpl", label: "CPL", align: "right" },
                  { key: "cpc", label: "CPC", align: "right" },
                  { key: "quality_score", label: "QS", align: "center" },
                  { key: "top_is", label: "Top IS %", align: "right" },
                  { key: "action", label: "Action", align: "center" },
                ].map(col => (
                  <th
                    key={col.key}
                    className={cn(
                      "p-3 text-xs font-bold uppercase tracking-widest text-muted-foreground cursor-pointer select-none",
                      col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"
                    )}
                    onClick={() => toggleSort(col.key as any)}
                  >
                    <div className="flex items-center gap-1">
                      {col.label}
                      {sortKey === col.key && (sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginatedKeywords.map((kw, idx) => {
                const targetCpl = benchmarkTargets.cpl;
                
                // Engine SOP Rules
                let action = "HOLD";
                let actionCls = "bg-muted text-muted-foreground";
                
                if (kw.conversions === 0 && kw.clicks >= 40 && kw.spend > (1.5 * targetCpl)) {
                  action = "PAUSE";
                  actionCls = "bg-red-500/10 text-red-500 border-red-500/20";
                } else if (kw.conversions > 0 && kw.cpl <= (1.3 * targetCpl)) {
                  action = "SCALE";
                  actionCls = "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
                }

                let classification = kw.classification || "WATCH";
                let classCls = "bg-amber-500/10 text-amber-500 border-amber-500/20";
                if (classification.toUpperCase() === "WINNER") {
                  classCls = "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
                } else if (classification.toUpperCase() === "UNDERPERFORMER") {
                  classCls = "bg-red-500/10 text-red-500 border-red-500/20";
                } else if (classification.toUpperCase() === "NEW") {
                  classCls = "bg-blue-500/10 text-blue-500 border-blue-500/20";
                }

                return (
                  <tr key={idx} className="border-b border-border/30 hover:bg-muted/20 transition-all">
                    <td className="p-3">
                      <div className="font-semibold text-foreground flex items-center gap-2">
                        {kw.keyword}
                        {kw.status !== "active" && <span className="text-xs uppercase bg-muted px-1 py-0.5 rounded text-muted-foreground">{kw.status}</span>}
                      </div>
                      <div className="text-xs text-muted-foreground truncate uppercase mt-0.5">
                        {kw.match_type} • {truncate(kw.ad_group, 20)}
                      </div>
                    </td>
                    <td className="p-3 text-center">
                      <Badge variant="outline" className={cn("text-xs uppercase whitespace-nowrap", classCls)}>
                        {classification}
                      </Badge>
                    </td>
                    <td className="p-3 text-right tabular-nums font-medium">{formatINR(kw.spend, 0)}</td>
                    <td className="p-3 text-right tabular-nums text-muted-foreground">{kw.impressions.toLocaleString()}</td>
                    <td className="p-3 text-right tabular-nums text-muted-foreground">{kw.clicks.toLocaleString()}</td>
                    <td className="p-3 text-right tabular-nums text-muted-foreground">{kw.ctr.toFixed(1)}%</td>
                    <td className="p-3 text-right tabular-nums font-medium text-emerald-400">{kw.conversions}</td>
                    <td className="p-3 text-right tabular-nums text-muted-foreground">{kw.cvr.toFixed(1)}%</td>
                    <td className="p-3 text-right tabular-nums font-bold">{kw.cpl > 0 ? formatINR(kw.cpl, 0) : "—"}</td>
                    <td className="p-3 text-right tabular-nums font-medium">{kw.cpc > 0 ? formatINR(kw.cpc, 0) : "—"}</td>
                    <td className="p-3">
                      <div className="flex flex-col items-center gap-1">
                        <div className="w-12 h-1.5 rounded-full bg-muted/50 overflow-hidden">
                          <div
                            className={cn("h-full transition-all",
                              kw.quality_score >= 7 ? "bg-emerald-500" : kw.quality_score >= 5 ? "bg-amber-500" : "bg-red-500"
                            )}
                            style={{ width: `${(kw.quality_score / 10) * 100}%` }}
                          />
                        </div>
                        <span className={cn("font-bold tabular-nums text-xs",
                          kw.quality_score >= 7 ? "text-emerald-400" : kw.quality_score >= 5 ? "text-amber-400" : "text-red-400"
                        )}>{kw.quality_score}</span>
                      </div>
                    </td>
                    <td className="p-3 text-right tabular-nums text-muted-foreground">{((kw as any).top_is || 0).toFixed(1)}%</td>
                    <td className="p-3 text-center">
                      <Badge variant="outline" className={cn("text-xs font-bold px-2 py-0.5", actionCls)}>
                        {action}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <DataTablePagination
          totalItems={filteredKeywords.length}
          pageSize={pageSize}
          currentPage={page}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </Card>
    </div>
  );
}
