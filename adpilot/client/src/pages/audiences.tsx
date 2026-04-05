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
  Users,
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

interface AudienceEntry {
  name: string;
  type: string;
  spend: number;
  clicks: number;
  impressions: number;
  leads: number;
  cpl: number;
  ctr: number;
  cpc: number;
  cpm: number;
  classification?: string;
}

export default function AudiencesPage() {
  const { analysisData: data, isLoadingAnalysis: isLoading } = useClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [sortKey, setSortKey] = useState<keyof AudienceEntry>("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const audiences: AudienceEntry[] = useMemo(() => {
    if (!data) return [];
    // Extract audiences from breakdowns or analysis
    // For Meta, this could be Interest/Lookalike targeting
    // For Google, this could be Audience Segments
    const fromMeta = (data as any).meta_breakdowns?.audience || [];
    const fromGoogle = (data as any).google_breakdowns?.audience || [];
    
    const merged = [...fromMeta, ...fromGoogle].map((a: any) => ({
      name: a.dimension || a.name || "Unknown",
      type: a.type || "Segment",
      spend: a.spend || 0,
      clicks: a.clicks || 0,
      impressions: a.impressions || 0,
      leads: a.leads || a.conversions || 0,
      cpl: a.cpl || ((a.leads || a.conversions) > 0 ? a.spend / (a.leads || a.conversions) : 0),
      ctr: a.ctr || (a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0),
      cpc: a.cpc || (a.clicks > 0 ? a.spend / a.clicks : 0),
      cpm: a.cpm || (a.impressions > 0 ? (a.spend / a.impressions) * 1000 : 0),
      classification: a.classification,
    }));

    // If no explicit audience data, try to extract from interest_audit etc.
    const interestAudit = (data as any).interest_audit || [];
    const interests = interestAudit.map((i: any) => ({
        name: i.interest_name || i.name,
        type: "Interest",
        spend: i.spend || 0,
        clicks: i.clicks || 0,
        impressions: i.impressions || 0,
        leads: i.leads || 0,
        cpl: i.cpl || 0,
        ctr: i.ctr || 0,
        cpc: i.cpc || 0,
        cpm: i.cpm || 0,
        classification: i.classification,
    }));

    return merged.length > 0 ? merged : interests;
  }, [data]);

  const filteredAudiences = useMemo(() => {
    let list = audiences.filter(a => 
      a.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

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
  }, [audiences, searchTerm, sortKey, sortDir]);

  const stats = useMemo(() => {
    const totalSpend = filteredAudiences.reduce((s, a) => s + a.spend, 0);
    const totalLeads = filteredAudiences.reduce((s, a) => s + a.leads, 0);
    const avgCpl = totalLeads > 0 ? totalSpend / totalLeads : 0;
    
    return { totalSpend, totalLeads, avgCpl };
  }, [filteredAudiences]);

  function toggleSort(key: keyof AudienceEntry) {
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
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-[500px] rounded-lg" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 max-w-[1400px]">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Users className="w-6 h-6 text-primary" />
            Audience Intelligence
          </h1>
          <p className="text-sm text-muted-foreground">
            Audience segment performance and targeting efficiency
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search audiences..."
              className="pl-8 pr-3 py-1.5 text-xs rounded-md bg-muted/50 border border-border/50 text-foreground w-60"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-card/50 border-border/40">
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Total Spend</p>
            <p className="text-2xl font-black text-foreground tabular-nums">{formatINR(stats.totalSpend, 0)}</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/40">
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Total Leads</p>
            <p className="text-2xl font-black text-emerald-400 tabular-nums">{stats.totalLeads}</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/40">
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Avg CPL</p>
            <p className="text-2xl font-black text-primary tabular-nums">{formatINR(stats.avgCpl, 0)}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/40 shadow-sm overflow-hidden bg-card/30">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/20 border-b border-border/50">
                {[
                  { key: "name", label: "Audience Name", align: "left" },
                  { key: "type", label: "Type", align: "left" },
                  { key: "spend", label: "Spend", align: "right" },
                  { key: "clicks", label: "Clicks", align: "right" },
                  { key: "leads", label: "Leads", align: "right" },
                  { key: "cpl", label: "CPL", align: "right" },
                  { key: "ctr", label: "CTR", align: "right" },
                ].map(col => (
                  <th
                    key={col.key}
                    className={cn(
                      "p-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground cursor-pointer select-none whitespace-nowrap",
                      col.align === "right" ? "text-right" : "text-left"
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
              {filteredAudiences.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground italic">
                    No audience data available for the current period.
                  </td>
                </tr>
              ) : (
                filteredAudiences.map((a, idx) => (
                  <tr key={idx} className="border-b border-border/30 hover:bg-muted/20 transition-all">
                    <td className="p-3 font-semibold text-foreground">{a.name}</td>
                    <td className="p-3">
                      <Badge variant="outline" className="text-[9px] uppercase tracking-tighter">
                        {a.type}
                      </Badge>
                    </td>
                    <td className="p-3 text-right tabular-nums font-medium">{formatINR(a.spend, 0)}</td>
                    <td className="p-3 text-right tabular-nums text-muted-foreground">{a.clicks.toLocaleString()}</td>
                    <td className="p-3 text-right tabular-nums font-medium text-emerald-400">{a.leads.toLocaleString()}</td>
                    <td className="p-3 text-right tabular-nums font-bold">{a.cpl > 0 ? formatINR(a.cpl, 0) : "—"}</td>
                    <td className="p-3 text-right tabular-nums">{formatPct(a.ctr)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
