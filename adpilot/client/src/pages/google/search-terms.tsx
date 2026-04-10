import { useState, useMemo, useCallback, useEffect } from "react";
import { useClient } from "@/lib/client-context";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Search,
  AlertTriangle,
  MinusCircle,
  PlusCircle,
  BarChart3,
  Ban,
  Loader2,
  CheckCircle,
  TrendingUp,
  List,
  XCircle,
  ShieldBan,
  Eye,
} from "lucide-react";
import { formatINR, formatPct, truncate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ─── Types ───────────────────────────────────────────────────────────

interface SearchTermEntry {
  search_term: string;
  term?: string;
  campaign?: string;
  campaign_id?: string;
  ad_group?: string;
  ad_group_name?: string;
  ad_group_id?: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  cpl?: number;
  ctr?: number;
  cvr?: number;
  match_type?: string;
  status?: string;
  recommendation?: string;
  reason?: string;
  classification?: string;
  is_relevant_competitor?: boolean;
  competitor_name?: string;
}

interface NgramEntry {
  ngram: string;
  n?: number;
  count?: number;
  frequency?: number;
  cost?: number;
  conversions?: number;
  impressions?: number;
  clicks?: number;
  cvr?: number;
  avg_cvr?: number;
  recommendation?: string;
}

interface SearchTermsData {
  terms_reviewed: number;
  total_search_terms?: number;
  all_terms?: SearchTermEntry[];
  negative_candidates: SearchTermEntry[];
  competitor_terms: SearchTermEntry[];
  high_value_terms: SearchTermEntry[];
  ngram_patterns?: NgramEntry[];
  ngram_analysis?: {
    one_grams?: NgramEntry[];
    two_grams?: NgramEntry[];
    three_grams?: NgramEntry[];
  };
  junk_spend?: number;
  junk_pct?: number;
}

interface NegativeKeyword {
  criterionId: string;
  keyword: string;
  matchType: string;
  campaignId: string;
  campaignName: string;
}

type TabId = "all" | "high_value" | "junk" | "competitors" | "ngrams" | "existing_negatives";

// ─── Component ───────────────────────────────────────────────────────

export default function GoogleSearchTermsPage() {
  const { analysisData: data, isLoadingAnalysis: isLoading, apiBase } = useClient();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<TabId>("all");
  const [searchFilter, setSearchFilter] = useState("");
  const [selectedCampaign, setSelectedCampaign] = useState<string>("all");
  const [sortKey, setSortKey] = useState<string>("cost");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [ngramType, setNgramType] = useState<"1" | "2" | "3">("2");
  const [executingTerms, setExecutingTerms] = useState<Set<string>>(new Set());
  const [executedTerms, setExecutedTerms] = useState<Set<string>>(new Set());

  // ─── Block Dialog State ─────────────────────────────────────────
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [blockTerm, setBlockTerm] = useState<SearchTermEntry | null>(null);
  const [blockMatchType, setBlockMatchType] = useState<"EXACT" | "PHRASE" | "BROAD">("PHRASE");
  const [blockCampaignId, setBlockCampaignId] = useState<string>("");
  const [blockSubmitting, setBlockSubmitting] = useState(false);

  // ─── Bulk Select State ──────────────────────────────────────────
  const [selectedTermKeys, setSelectedTermKeys] = useState<Set<string>>(new Set());
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [bulkMatchType, setBulkMatchType] = useState<"EXACT" | "PHRASE" | "BROAD">("PHRASE");
  const [bulkCampaignId, setBulkCampaignId] = useState<string>("");
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  // ─── Existing Negatives State ───────────────────────────────────
  const [existingNegatives, setExistingNegatives] = useState<NegativeKeyword[]>([]);
  const [negativesLoading, setNegativesLoading] = useState(false);
  const [negativesCampaignId, setNegativesCampaignId] = useState<string>("");

  const stData: SearchTermsData | null = useMemo(() => {
    if (!data) return null;
    return (data as any).search_terms_analysis || null;
  }, [data]);

  // Build campaign list from all terms
  const campaigns = useMemo(() => {
    if (!stData) return [];
    const allTerms = [
      ...(Array.isArray(stData.all_terms) ? stData.all_terms : []),
      ...(Array.isArray(stData.negative_candidates) ? stData.negative_candidates : []),
      ...(Array.isArray(stData.competitor_terms) ? stData.competitor_terms : []),
      ...(Array.isArray(stData.high_value_terms) ? stData.high_value_terms : []),
    ];
    const campSet = new Map<string, string>();
    allTerms.forEach((t) => {
      if (t.campaign) campSet.set(t.campaign, t.campaign_id || "");
    });
    return Array.from(campSet.entries()).map(([name, id]) => ({ name, id }));
  }, [stData]);

  function getTermText(t: SearchTermEntry): string {
    return t.search_term || t.term || "";
  }

  function getTermKey(t: SearchTermEntry): string {
    return `${getTermText(t)}__${t.campaign_id || t.campaign}`;
  }

  function filterByCampaign(terms: SearchTermEntry[]): SearchTermEntry[] {
    if (selectedCampaign === "all") return terms;
    return terms.filter((t) => t.campaign === selectedCampaign);
  }

  function filterBySearch(terms: SearchTermEntry[]): SearchTermEntry[] {
    if (!searchFilter) return terms;
    const q = searchFilter.toLowerCase();
    return terms.filter(
      (t) =>
        getTermText(t).toLowerCase().includes(q) ||
        (t.campaign || "").toLowerCase().includes(q) ||
        (t.ad_group || "").toLowerCase().includes(q)
    );
  }

  function sortTerms(terms: SearchTermEntry[]): SearchTermEntry[] {
    return [...terms].sort((a, b) => {
      const aVal = sortKey === "search_term" ? getTermText(a) : (a as any)[sortKey];
      const bVal = sortKey === "search_term" ? getTermText(b) : (b as any)[sortKey];
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      return sortDir === "asc"
        ? String(aVal || "").localeCompare(String(bVal || ""))
        : String(bVal || "").localeCompare(String(aVal || ""));
    });
  }

  function getActiveTerms(): SearchTermEntry[] {
    if (!stData) return [];
    let list: SearchTermEntry[] = [];
    switch (activeTab) {
      case "all":
        list = Array.isArray(stData.all_terms) ? stData.all_terms : [
          ...(Array.isArray(stData.negative_candidates) ? stData.negative_candidates : []),
          ...(Array.isArray(stData.competitor_terms) ? stData.competitor_terms : []),
          ...(Array.isArray(stData.high_value_terms) ? stData.high_value_terms : []),
        ];
        break;
      case "high_value":
        list = stData.high_value_terms || [];
        break;
      case "junk":
        list = stData.negative_candidates || [];
        break;
      case "competitors":
        list = stData.competitor_terms || [];
        break;
      default:
        return [];
    }
    return sortTerms(filterBySearch(filterByCampaign(list)));
  }

  function getNgrams(): NgramEntry[] {
    if (!stData) return [];
    const nga = stData.ngram_analysis;
    let list: NgramEntry[] = [];
    if (nga) {
      switch (ngramType) {
        case "1": list = nga.one_grams || []; break;
        case "2": list = nga.two_grams || []; break;
        case "3": list = nga.three_grams || []; break;
      }
    } else {
      list = (stData.ngram_patterns || []).filter(
        (n) => !n.n || String(n.n) === ngramType
      );
    }
    if (searchFilter) {
      list = list.filter((n) => n.ngram.toLowerCase().includes(searchFilter.toLowerCase()));
    }
    return [...list].sort((a, b) => {
      if (sortKey === "ngram") {
        return sortDir === "asc" ? a.ngram.localeCompare(b.ngram) : b.ngram.localeCompare(a.ngram);
      }
      const aVal = (a as any)[sortKey] || 0;
      const bVal = (b as any)[sortKey] || 0;
      return sortDir === "asc" ? aVal - bVal : bVal - aVal;
    });
  }

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function SortIcon({ col }: { col: string }) {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 opacity-30" />;
    return sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  }

  // ─── Block Single Term (opens dialog) ───────────────────────────
  const openBlockDialog = useCallback((term: SearchTermEntry) => {
    setBlockTerm(term);
    setBlockMatchType("PHRASE");
    setBlockCampaignId(term.campaign_id || campaigns.find(c => c.name === term.campaign)?.id || "");
    setBlockDialogOpen(true);
  }, [campaigns]);

  const handleBlockConfirm = useCallback(async () => {
    if (!blockTerm || !blockCampaignId) return;
    setBlockSubmitting(true);
    try {
      const resp = await apiRequest("POST", `${apiBase}/google/add-negative-keyword`, {
        campaignId: blockCampaignId,
        keyword: getTermText(blockTerm),
        matchType: blockMatchType,
      });
      const result = await resp.json();
      if (result.success) {
        const termKey = getTermKey(blockTerm);
        setExecutedTerms((prev) => new Set(prev).add(termKey));
        toast({
          title: "Negative keyword added",
          description: `"${getTermText(blockTerm)}" (${blockMatchType}) added successfully`,
        });
      } else {
        toast({
          title: "Failed to add negative",
          description: result.error || result.message || "Unknown error",
          variant: "destructive",
        });
      }
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to add negative keyword",
        variant: "destructive",
      });
    } finally {
      setBlockSubmitting(false);
      setBlockDialogOpen(false);
      setBlockTerm(null);
    }
  }, [blockTerm, blockCampaignId, blockMatchType, apiBase, toast]);

  // ─── Legacy quick-add (fallback for junk tab) ──────────────────
  const handleAddNegative = useCallback(async (term: SearchTermEntry) => {
    openBlockDialog(term);
  }, [openBlockDialog]);

  // ─── Bulk Selection Helpers ─────────────────────────────────────
  const toggleTermSelection = useCallback((term: SearchTermEntry) => {
    const key = getTermKey(term);
    setSelectedTermKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const isTermSelected = useCallback((term: SearchTermEntry) => {
    return selectedTermKeys.has(getTermKey(term));
  }, [selectedTermKeys]);

  const selectAllVisible = useCallback(() => {
    const terms = getActiveTerms();
    setSelectedTermKeys((prev) => {
      const next = new Set(prev);
      terms.forEach(t => next.add(getTermKey(t)));
      return next;
    });
  }, [getActiveTerms]);

  const deselectAll = useCallback(() => {
    setSelectedTermKeys(new Set());
  }, []);

  // ─── Bulk Add Dialog ────────────────────────────────────────────
  const openBulkDialog = useCallback(() => {
    if (selectedTermKeys.size === 0) return;
    setBulkMatchType("PHRASE");
    // Default to first campaign in selection
    const firstKey = Array.from(selectedTermKeys)[0];
    const allTermsList = stData ? [
      ...(Array.isArray(stData.all_terms) ? stData.all_terms : []),
      ...(Array.isArray(stData.negative_candidates) ? stData.negative_candidates : []),
      ...(Array.isArray(stData.competitor_terms) ? stData.competitor_terms : []),
      ...(Array.isArray(stData.high_value_terms) ? stData.high_value_terms : []),
    ] : [];
    const firstTerm = allTermsList.find(t => getTermKey(t) === firstKey);
    setBulkCampaignId(firstTerm?.campaign_id || campaigns[0]?.id || "");
    setBulkDialogOpen(true);
  }, [selectedTermKeys, stData, campaigns]);

  const handleBulkConfirm = useCallback(async () => {
    if (!bulkCampaignId || selectedTermKeys.size === 0) return;
    setBulkSubmitting(true);

    const allTermsList = stData ? [
      ...(stData.all_terms || []),
      ...(stData.negative_candidates || []),
      ...(stData.competitor_terms || []),
      ...(stData.high_value_terms || []),
    ] : [];

    const keywordsPayload = Array.from(selectedTermKeys).map(key => {
      const term = allTermsList.find(t => getTermKey(t) === key);
      return {
        keyword: term ? getTermText(term) : key.split("__")[0],
        matchType: bulkMatchType,
      };
    });

    try {
      const resp = await apiRequest("POST", `${apiBase}/google/negative-keywords/bulk`, {
        campaignId: bulkCampaignId,
        keywords: keywordsPayload,
      });
      const result = await resp.json();
      if (result.success) {
        setExecutedTerms((prev) => {
          const next = new Set(prev);
          selectedTermKeys.forEach(k => next.add(k));
          return next;
        });
        setSelectedTermKeys(new Set());
        toast({
          title: "Bulk negatives added",
          description: `${result.count || keywordsPayload.length} negative keywords added successfully`,
        });
      } else {
        toast({
          title: "Bulk add failed",
          description: result.error || "Unknown error",
          variant: "destructive",
        });
      }
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Bulk add failed",
        variant: "destructive",
      });
    } finally {
      setBulkSubmitting(false);
      setBulkDialogOpen(false);
    }
  }, [bulkCampaignId, bulkMatchType, selectedTermKeys, stData, apiBase, toast]);

  // ─── Fetch Existing Negatives ───────────────────────────────────
  const fetchExistingNegatives = useCallback(async (campaignId: string) => {
    if (!campaignId) return;
    setNegativesLoading(true);
    try {
      const resp = await apiRequest("GET", `${apiBase}/google/negative-keywords?campaignId=${campaignId}`);
      const result = await resp.json();
      if (result.success) {
        setExistingNegatives(result.negatives || []);
      } else {
        setExistingNegatives([]);
        toast({
          title: "Failed to load negatives",
          description: result.error || "Unknown error",
          variant: "destructive",
        });
      }
    } catch (err: any) {
      setExistingNegatives([]);
    } finally {
      setNegativesLoading(false);
    }
  }, [apiBase, toast]);

  // When existing negatives tab is activated or campaign changes, fetch
  useEffect(() => {
    if (activeTab === "existing_negatives" && negativesCampaignId) {
      fetchExistingNegatives(negativesCampaignId);
    }
  }, [activeTab, negativesCampaignId, fetchExistingNegatives]);

  // Auto-set negativesCampaignId when tab opens
  useEffect(() => {
    if (activeTab === "existing_negatives" && !negativesCampaignId && campaigns.length > 0) {
      setNegativesCampaignId(campaigns[0].id);
    }
  }, [activeTab, negativesCampaignId, campaigns]);

  const tabs: { id: TabId; label: string; icon: typeof MinusCircle; count: number }[] = useMemo(() => {
    if (!stData) return [];
    const allCount = (stData.all_terms || []).length ||
      ((stData.negative_candidates || []).length + (stData.competitor_terms || []).length + (stData.high_value_terms || []).length);
    return [
      { id: "all" as TabId, label: "All Terms", icon: List, count: allCount },
      { id: "high_value" as TabId, label: "High-Value", icon: TrendingUp, count: (stData.high_value_terms || []).length },
      { id: "junk" as TabId, label: "Junk / Negative", icon: Ban, count: (stData.negative_candidates || []).length },
      { id: "competitors" as TabId, label: "Competitors", icon: AlertTriangle, count: (stData.competitor_terms || []).length },
      { id: "ngrams" as TabId, label: "N-Grams", icon: BarChart3, count: 0 },
      { id: "existing_negatives" as TabId, label: "Existing Negatives", icon: ShieldBan, count: 0 },
    ];
  }, [stData]);

  // Loading
  if (isLoading || !data) {
    return (
      <div className="p-6" data-testid="search-terms-loading">
        <Skeleton className="h-8 w-56 mb-4" />
        <div className="grid grid-cols-4 gap-4 mb-6">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 rounded-md" />)}
        </div>
        <Skeleton className="h-[500px] rounded-md" />
      </div>
    );
  }

  // Empty state
  if (!stData) {
    return (
      <div className="p-6 space-y-4 max-w-[1800px]" data-testid="search-terms-empty">
        <div>
          <h1 className="text-lg font-semibold text-black flex items-center gap-2">
            <Search className="w-5 h-5" />
            Search Terms Analysis
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            Identify waste, find negatives, and expand high-value terms
          </p>
        </div>
        <Card className="bg-card border-border">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <AlertTriangle className="w-10 h-10 text-gray-500 mb-3" />
            <p className="text-sm text-gray-400">
              Search terms data requires search_term_view API access.
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Available after the next agent run with search terms data collection enabled.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const termsReviewed = stData.terms_reviewed || stData.total_search_terms || 0;
  const negativesCount = (stData.negative_candidates || []).length;
  const competitorsCount = (stData.competitor_terms || []).length;
  const highValueCount = (stData.high_value_terms || []).length;

  const activeTerms = activeTab !== "ngrams" && activeTab !== "existing_negatives" ? getActiveTerms() : [];
  const activeNgrams = activeTab === "ngrams" ? getNgrams() : [];

  const isTermTableTab = activeTab !== "ngrams" && activeTab !== "existing_negatives";
  const hasSelection = selectedTermKeys.size > 0;

  return (
    <div className="p-6 space-y-4 max-w-[1800px]" data-testid="search-terms-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-black flex items-center gap-2">
            <Search className="w-5 h-5" />
            Search Terms Analysis
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            {termsReviewed} terms reviewed
            {stData.junk_spend != null && (
              <> · Junk spend: {formatINR(stData.junk_spend, 0)} ({stData.junk_pct?.toFixed(1)}%)</>
            )}
          </p>
        </div>
        {/* Bulk Actions Bar */}
        {hasSelection && isTermTableTab && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">{selectedTermKeys.size} selected</span>
            <button
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded border bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20 transition-colors"
              onClick={openBulkDialog}
              data-testid="btn-bulk-add-negatives"
            >
              <Ban className="w-3.5 h-3.5" />
              Bulk Add Negatives
            </button>
            <button
              className="text-xs text-gray-500 hover:text-white transition-colors px-2 py-1"
              onClick={deselectAll}
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4" data-testid="search-terms-summary">
        <Card className="bg-card border-border">
          <CardContent className="card-content-premium">
            <p className="text-[10px] uppercase tracking-wider text-black-400">Terms Reviewed</p>
            <p className="text-2xl font-bold tabular-nums text-black mt-1">{termsReviewed.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card className={cn("bg-card border-border", negativesCount > 0 && "border-red-500/30")}>          <CardContent className="card-content-premium">
          <p className="text-[10px] uppercase tracking-wider text-black-400">Negatives Found</p>
          <p className={cn("text-2xl font-bold tabular-nums mt-1 text-black", negativesCount > 0 ? "text-red-400" : "text-black")}>
            {negativesCount}
          </p>
        </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="card-content-premium">
            <p className="text-[10px] uppercase tracking-wider text-black-400">Competitor Terms</p>
            <p className="text-2xl font-bold tabular-nums text-amber-400 mt-1">{competitorsCount}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="card-content-premium">
            <p className="text-[10px] uppercase tracking-wider text-black-400">High-Value Terms</p>
            <p className="text-2xl font-bold tabular-nums text-emerald-400 mt-1">{highValueCount}</p>
          </CardContent>
        </Card>
      </div>

      {/* Junk Spend Alert */}
      {stData.junk_pct != null && stData.junk_pct > 10 && (
        <Card className="bg-red-500/5 border-red-500/30" data-testid="junk-spend-alert">
          <CardContent className="card-content-premium">
            <p className="text-xs font-medium text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              Junk spend at {stData.junk_pct.toFixed(1)}% of total — above 10% threshold.
              {stData.junk_spend != null && <> Wasted: {formatINR(stData.junk_spend, 0)}</>}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Campaign Filter + Search */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          className="text-xs bg-card border border-border rounded-md px-3 py-1.5 text-black min-w-[200px]"
          value={selectedCampaign}
          onChange={(e) => setSelectedCampaign(e.target.value)}
          data-testid="select-campaign-filter"
        >
          <option value="all">All Campaigns</option>
          {campaigns.map((c) => (
            <option key={c.name} value={c.name}>{truncate(c.name, 50)}</option>
          ))}
        </select>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
          <input
            type="text"
            placeholder="Filter terms..."
            className="pl-8 pr-3 py-1.5 text-xs rounded-md bg-card border border-border text-black w-60"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            data-testid="input-filter-terms"
          />
        </div>
        {isTermTableTab && (
          <button
            className="text-xs text-gray-500 hover:text-white transition-colors px-2 py-1 bg-card border border-border rounded"
            onClick={selectAllVisible}
            data-testid="btn-select-all"
          >
            Select All Visible
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-800 pb-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors",
              activeTab === tab.id
                ? "border-[#F0BC00] text-black"
                : "border-transparent text-black hover:text-black"
            )}
            onClick={() => { setActiveTab(tab.id); setSortKey(tab.id === "ngrams" ? "count" : "cost"); setSortDir("desc"); }}
            data-testid={`tab-${tab.id}`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
            {tab.count > 0 && (
              <Badge variant="outline" className="text-[9px] px-1 py-0 ml-1 border-gray-700 text-gray-400">
                {tab.count}
              </Badge>
            )}
          </button>
        ))}
      </div>

      {/* Term Tables (non-ngram, non-existing-negatives tabs) */}
      {isTermTableTab && (
        <Card className="bg-card border-border">
          <CardContent className="card-content-premium p-0">
            <div className="overflow-x-auto">
              <table className="t-table w-full">
                <thead>
                  <tr className="border-b bg-card border border-border">
                    <th className="p-3 w-8">
                      <span className="sr-only">Select</span>
                    </th>
                    {[
                      { key: "search_term", label: "Search Term", align: "left" },
                      { key: "campaign", label: "Campaign / Ad Group", align: "left" },
                      { key: "match_type", label: "Match", align: "left" },
                      { key: "intent", label: "Intent", align: "left" },
                      { key: "impressions", label: "Impr", align: "right" },
                      { key: "clicks", label: "Clicks", align: "right" },
                      { key: "ctr", label: "CTR", align: "right" },
                      { key: "cost", label: "Cost", align: "right" },
                      { key: "conversions", label: "Conv", align: "right" },
                      { key: "cpl", label: "CPL", align: "right" },
                    ].map((col) => (
                      <th
                        key={col.key}
                        className={cn(
                          "p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500 cursor-pointer select-none whitespace-nowrap",
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
                    <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500 text-left">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {activeTerms.map((term, idx) => {
                    const termText = getTermText(term);
                    const termKey = getTermKey(term);
                    const isExecuting = executingTerms.has(termKey);
                    const isExecuted = executedTerms.has(termKey);
                    const isSelected = isTermSelected(term);
                    const isNegativeCandidate =
                      activeTab === "junk" ||
                      term.classification === "junk" ||
                      term.classification === "negative" ||
                      (term.recommendation || "").toLowerCase().includes("negative");

                    return (
                      <tr
                        key={`${termText}-${idx}`}
                        className={cn(
                          "border-b border-gray-800/50 hover:bg-white/[0.02] transition-colors",
                          isSelected && "bg-[#F0BC00]/5"
                        )}
                        data-testid={`row-term-${idx}`}
                      >
                        <td className="p-3 w-8">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleTermSelection(term)}
                            className="border-gray-600"
                            data-testid={`checkbox-term-${idx}`}
                          />
                        </td>
                        <td className="p-3 max-w-[250px]">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-black truncate block cursor-default">
                                {truncate(termText, 40)}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent><p className="text-xs max-w-xs">{termText}</p></TooltipContent>
                          </Tooltip>
                          {term.reason && (
                            <span className="text-[10px] text-gray-600 block truncate mt-0.5">
                              {truncate(term.reason, 40)}
                            </span>
                          )}
                        </td>
                        <td className="p-3 max-w-[150px]">
                          <span className="text-gray-400 truncate block font-semibold">{truncate(term.campaign || "—", 25)}</span>
                          <span className="text-[10px] text-gray-500 truncate block mt-0.5" title={term.ad_group || term.ad_group_name || "—"}>
                            {truncate(term.ad_group || term.ad_group_name || "—", 25)}
                          </span>
                        </td>
                        <td className="p-3">
                          <span className="text-gray-500 text-[10px] uppercase">{term.match_type || "—"}</span>
                        </td>
                        <td className="p-3">
                          {(() => {
                            const t = termText.toLowerCase();
                            let intent = "LOW";
                            let cls = "bg-gray-500/10 text-gray-400 border-gray-500/20";
                            
                            if (t.includes("rent") || t.includes("pg") || t.includes("job") || t.includes("resale") || t.includes("free") || t.includes("cheap")) {
                              intent = "JUNK";
                              cls = "bg-red-500/10 text-red-400 border-red-500/30";
                            } else if (t.includes("sale") || t.includes("price") || t.includes("bhk") || t.includes("buy") || t.includes("cost") || t.includes("visit") || t.includes("near me")) {
                              intent = "HIGH";
                              cls = "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
                            } else if (t.includes(" in ") || t.includes(" near ") || t.includes(" area") || t.includes(" city")) {
                              intent = "MEDIUM";
                              cls = "bg-blue-500/10 text-blue-400 border-blue-500/30";
                            }
                            
                            return (
                              <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 border", cls)}>
                                {intent}
                              </Badge>
                            );
                          })()}
                        </td>
                        <td className="p-3 text-right tabular-nums text-gray-400">{term.impressions.toLocaleString()}</td>
                        <td className="p-3 text-right tabular-nums text-gray-400">{term.clicks.toLocaleString()}</td>
                        <td className="p-3 text-right tabular-nums text-gray-400">
                          {term.ctr != null ? `${term.ctr.toFixed(1)}%` : term.clicks && term.impressions ? `${((term.clicks / term.impressions) * 100).toFixed(1)}%` : "—"}
                        </td>
                        <td className="p-3 text-right tabular-nums text-white">{formatINR(term.cost, 0)}</td>
                        <td className="p-3 text-right tabular-nums">
                          <span className={term.conversions > 0 ? "text-emerald-400" : "text-gray-500"}>
                            {term.conversions}
                          </span>
                        </td>
                        <td className="p-3 text-right tabular-nums text-gray-400">
                          {term.cpl != null && term.cpl > 0
                            ? formatINR(term.cpl, 0)
                            : term.conversions > 0
                              ? formatINR(term.cost / term.conversions, 0)
                              : "—"}
                        </td>
                        <td className="p-3">
                          {isExecuted ? (
                            <Badge variant="outline" className="text-[10px] px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                              <CheckCircle className="w-3 h-3 mr-1" />
                              Blocked
                            </Badge>
                          ) : (
                            <div className="flex items-center gap-1">
                              <button
                                className={cn(
                                  "inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded border transition-colors",
                                  "bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20 cursor-pointer"
                                )}
                                onClick={() => openBlockDialog(term)}
                                data-testid={`btn-block-${idx}`}
                                title="Block this search term as a negative keyword"
                              >
                                <XCircle className="w-3 h-3" />
                                Block
                              </button>
                              {/* Promote to Keyword button for high-value terms */}
                              {term.conversions > 0 && term.cost > 0 && (term.cpl || term.cost / term.conversions) <= (((data as any)?.benchmarks?.cpl || 1000) * 1.3) && (
                                <button
                                  className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded border transition-colors bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 cursor-pointer"
                                  onClick={() => {
                                    const matchType = term.match_type === "EXACT" ? "EXACT" : term.match_type === "PHRASE" ? "PHRASE" : "EXACT";
                                    navigator.clipboard.writeText(term.search_term || term.term || "");
                                    toast({ title: "Copied to Clipboard", description: `"${term.search_term || term.term}" copied. Add as ${matchType} keyword in Google Ads.` });
                                  }}
                                  title="Copy this high-value search term to promote as a keyword"
                                >
                                  <PlusCircle className="w-3 h-3" />
                                  Promote
                                </button>
                              )}
                              {isNegativeCandidate && !isExecuted && (
                                <Badge
                                  variant="outline"
                                  className="text-[9px] px-1 py-0 bg-red-500/5 text-red-300 border-red-500/20"
                                >
                                  neg
                                </Badge>
                              )}
                              {!isNegativeCandidate && term.recommendation && (
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "text-[10px] px-1.5 py-0 border",
                                    term.recommendation.includes("expand") || term.recommendation.includes("exact")
                                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                                      : "bg-amber-500/10 text-amber-400 border-amber-500/30"
                                  )}
                                >
                                  {term.recommendation.replace(/_/g, " ")}
                                </Badge>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {activeTerms.length === 0 && (
                    <tr>
                      <td colSpan={11} className="p-8 text-center text-xs text-gray-500">
                        No terms match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* N-gram Tab */}
      {activeTab === "ngrams" && (
        <div className="space-y-4">
          {/* N-gram type toggle */}
          <div className="flex items-center gap-2" data-testid="ngram-type-toggle">
            {(["1", "2", "3"] as const).map((n) => (
              <button
                key={n}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md border transition-colors",
                  ngramType === n
                    ? "bg-[#F0BC00]/10 border-[#F0BC00]/30 text-[#F0BC00]"
                    : "bg-card border border-border text-black hover:text-black"
                )}
                onClick={() => setNgramType(n)}
                data-testid={`btn-ngram-${n}`}
              >
                {n}-gram
              </button>
            ))}
          </div>

          <Card className="bg-[#1a1a2e]/60 border-gray-800">
            <CardContent className="card-content-premium p-0">
              <div className="overflow-x-auto">
                <table className="t-table w-full">
                  <thead>
                    <tr className="border-b bg-card border border-border">
                      {[
                        { key: "ngram", label: "N-gram", align: "left" },
                        { key: "count", label: "Occurrences", align: "right" },
                        { key: "impressions", label: "Impr", align: "right" },
                        { key: "cost", label: "Total Cost", align: "right" },
                        { key: "conversions", label: "Conv", align: "right" },
                        { key: "cvr", label: "CVR", align: "right" },
                      ].map((col) => (
                        <th
                          key={col.key}
                          className={cn(
                            "p-3 text-[10px] font-medium uppercase tracking-wider text-black cursor-pointer select-none whitespace-nowrap",
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
                      <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-black text-left">
                        Signal
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeNgrams.map((ng, idx) => (
                      <tr
                        key={`${ng.ngram}-${idx}`}
                        className="border-b bg-card border border-border hover:bg-white/[0.02] transition-colors"
                        data-testid={`row-ngram-${idx}`}
                      >
                        <td className="p-3 font-medium text-black">{ng.ngram}</td>
                        <td className="p-3 text-right tabular-nums text-black">{ng.count ?? ng.frequency ?? "—"}</td>
                        <td className="p-3 text-right tabular-nums text-black">{ng.impressions?.toLocaleString() ?? "—"}</td>
                        <td className="p-3 text-right tabular-nums text-black">{ng.cost != null ? formatINR(ng.cost, 0) : "—"}</td>
                        <td className="p-3 text-right tabular-nums">
                          <span className={(ng.conversions ?? 0) > 0 ? "text-emerald-400" : "text-gray-500"}>
                            {ng.conversions ?? "—"}
                          </span>
                        </td>
                        <td className="p-3 text-right tabular-nums text-gray-400">
                          {ng.cvr != null ? `${ng.cvr.toFixed(1)}%` : ng.avg_cvr != null ? `${ng.avg_cvr.toFixed(1)}%` : "—"}
                        </td>
                        <td className="p-3">
                          {ng.recommendation ? (
                            <Badge variant="outline" className={cn(
                              "text-[10px] px-1.5 py-0 border",
                              ng.recommendation.toLowerCase().includes("negative") ? "bg-red-500/10 text-red-400 border-red-500/30" :
                                ng.recommendation.toLowerCase().includes("keep") || ng.recommendation.toLowerCase().includes("expand") ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" :
                                  "bg-amber-500/10 text-amber-400 border-amber-500/30"
                            )}>
                              {truncate(ng.recommendation, 25)}
                            </Badge>
                          ) : (ng.conversions ?? 0) === 0 && (ng.cost ?? 0) > 0 ? (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-red-500/10 text-red-400 border-red-500/30">
                              Potential Negative
                            </Badge>
                          ) : (ng.conversions ?? 0) > 0 && (ng.cvr ?? ng.avg_cvr ?? 0) > 3 ? (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                              High-Value
                            </Badge>
                          ) : (
                            <span className="text-black text-[10px]">Monitor</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {activeNgrams.length === 0 && (
                      <tr>
                        <td colSpan={7} className="p-8 text-center text-xs text-black">
                          No {ngramType}-gram patterns available.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Existing Negatives Tab */}
      {activeTab === "existing_negatives" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <label className="text-xs text-black">Campaign:</label>
            <Select value={negativesCampaignId} onValueChange={(val) => setNegativesCampaignId(val)}>
              <SelectTrigger className="w-[350px] text-xs bg-card border border-border text-black h-8">
                <SelectValue placeholder="Select a campaign" />
              </SelectTrigger>
              <SelectContent className="bg-card border border-border">
                {campaigns.map((c) => (
                  <SelectItem key={c.id} value={c.id} className="text-xs text-white">
                    {truncate(c.name, 55)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              className="text-xs text-black hover:text-black transition-colors px-2 py-1 border bg-card border border-border rounded"
              onClick={() => negativesCampaignId && fetchExistingNegatives(negativesCampaignId)}
              disabled={negativesLoading}
              data-testid="btn-refresh-negatives"
            >
              {negativesLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Refresh"}
            </button>
          </div>

          <Card className="bg-card border border-border">
            <CardContent className="card-content-premium p-0">
              {negativesLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-5 h-5 animate-spin text-black" />
                  <span className="text-xs text-black ml-2">Loading negatives...</span>
                </div>
              ) : existingNegatives.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <ShieldBan className="w-8 h-8 text-black mb-2" />
                  <p className="text-xs text-gray-500">
                    {negativesCampaignId ? "No negative keywords found for this campaign." : "Select a campaign to view existing negatives."}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="t-table w-full">
                    <thead>
                      <tr className="border-b border-gray-800">
                        <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-black text-left">Keyword</th>
                        <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-black text-left">Match Type</th>
                        <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-black text-left">Campaign</th>
                        <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-black text-left">Criterion ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {existingNegatives.map((neg, idx) => (
                        <tr
                          key={`${neg.criterionId}-${idx}`}
                          className="border-b bg-card border border-border hover:bg-white/[0.02] transition-colors"
                          data-testid={`row-existing-neg-${idx}`}
                        >
                          <td className="p-3 text-black font-medium">{neg.keyword}</td>
                          <td className="p-3">
                            <Badge variant="outline" className={cn(
                              "text-[10px] px-1.5 py-0 border",
                              neg.matchType === "EXACT" ? "bg-blue-500/10 text-blue-400 border-blue-500/30" :
                                neg.matchType === "PHRASE" ? "bg-purple-500/10 text-purple-400 border-purple-500/30" :
                                  "bg-gray-500/10 text-gray-400 border-gray-500/30"
                            )}>
                              {neg.matchType}
                            </Badge>
                          </td>
                          <td className="p-3 text-black">{truncate(neg.campaignName, 40)}</td>
                          <td className="p-3 text-gray-600 font-mono text-[10px]">{neg.criterionId}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="p-3 border-t bg-card border border-border text-[10px] text-black">
                    {existingNegatives.length} negative keyword{existingNegatives.length !== 1 ? "s" : ""} found
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ─── Block Single Term Dialog ─────────────────────────────── */}
      <Dialog open={blockDialogOpen} onOpenChange={setBlockDialogOpen}>
        <DialogContent className="bg-card border border-border text-black max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <Ban className="w-4 h-4 text-red-400" />
              Add Negative Keyword
            </DialogTitle>
            <DialogDescription className="text-xs text-black">
              Block this search term from triggering your ads.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Keyword (read-only) */}
            <div>
              <label className="text-[10px] uppercase tracking-wider text-black block mb-1">Keyword</label>
              <div className="text-sm text-black bg-card border border-border rounded px-3 py-2">
                {blockTerm ? getTermText(blockTerm) : ""}
              </div>
            </div>

            {/* Match Type */}
            <div>
              <label className="text-[10px] uppercase tracking-wider text-black block mb-1">Match Type</label>
              <Select value={blockMatchType} onValueChange={(val) => setBlockMatchType(val as "EXACT" | "PHRASE" | "BROAD")}>
                <SelectTrigger className="text-xs bg-card border border-border text-black h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border border-border">
                  <SelectItem value="EXACT" className="text-xs text-black">[Exact] — blocks only this exact query</SelectItem>
                  <SelectItem value="PHRASE" className="text-xs text-black">"Phrase" — blocks queries containing this phrase</SelectItem>
                  <SelectItem value="BROAD" className="text-xs text-black">Broad — blocks queries with these words in any order</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Campaign */}
            <div>
              <label className="text-[10px] uppercase tracking-wider text-black block mb-1">Campaign</label>
              <Select value={blockCampaignId} onValueChange={setBlockCampaignId}>
                <SelectTrigger className="text-xs bg-card border border-border text-black h-9">
                  <SelectValue placeholder="Select campaign" />
                </SelectTrigger>
                <SelectContent className="bg-card border border-border">
                  {campaigns.map((c) => (
                    <SelectItem key={c.id} value={c.id} className="text-xs text-white">
                      {truncate(c.name, 50)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <button
              className="text-xs px-3 py-1.5 rounded border bg-card border border-border text-black hover:text-black transition-colors"
              onClick={() => setBlockDialogOpen(false)}
              disabled={blockSubmitting}
            >
              Cancel
            </button>
            <button
              className={cn(
                "inline-flex items-center gap-1.5 text-xs font-medium px-4 py-1.5 rounded border transition-colors",
                blockSubmitting
                  ? "bg-gray-800 border-gray-700 text-gray-500 cursor-wait"
                  : "bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20"
              )}
              onClick={handleBlockConfirm}
              disabled={blockSubmitting || !blockCampaignId}
              data-testid="btn-confirm-block"
            >
              {blockSubmitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ban className="w-3 h-3" />}
              {blockSubmitting ? "Adding..." : "Add as Negative"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Bulk Add Dialog ──────────────────────────────────────── */}
      <Dialog open={bulkDialogOpen} onOpenChange={setBulkDialogOpen}>
        <DialogContent className="bg-card border border-border text-black max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <Ban className="w-4 h-4 text-red-400" />
              Bulk Add Negative Keywords
            </DialogTitle>
            <DialogDescription className="text-xs text-black">
              Add {selectedTermKeys.size} search term{selectedTermKeys.size !== 1 ? "s" : ""} as negative keywords.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Preview of selected terms */}
            <div>
              <label className="text-[10px] uppercase tracking-wider text-black block mb-1">
                Keywords ({selectedTermKeys.size})
              </label>
              <div className="bg-card border border-border rounded p-2 max-h-32 overflow-y-auto space-y-1">
                {Array.from(selectedTermKeys).slice(0, 20).map((key) => (
                  <div key={key} className="text-[11px] text-black">
                    {key.split("__")[0]}
                  </div>
                ))}
                {selectedTermKeys.size > 20 && (
                  <div className="text-[10px] text-black">...and {selectedTermKeys.size - 20} more</div>
                )}
              </div>
            </div>

            {/* Match Type */}
            <div>
              <label className="text-[10px] uppercase tracking-wider text-black block mb-1">Match Type (applied to all)</label>
              <Select value={bulkMatchType} onValueChange={(val) => setBulkMatchType(val as "EXACT" | "PHRASE" | "BROAD")}>
                <SelectTrigger className="text-xs bg-card border border-border text-black h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border border-border">
                  <SelectItem value="EXACT" className="text-xs text-black">[Exact]</SelectItem>
                  <SelectItem value="PHRASE" className="text-xs text-black">"Phrase"</SelectItem>
                  <SelectItem value="BROAD" className="text-xs text-black">Broad</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Campaign */}
            <div>
              <label className="text-[10px] uppercase tracking-wider text-black block mb-1">Target Campaign</label>
              <Select value={bulkCampaignId} onValueChange={setBulkCampaignId}>
                <SelectTrigger className="text-xs bg-card border border-border text-black h-9">
                  <SelectValue placeholder="Select campaign" />
                </SelectTrigger>
                <SelectContent className="bg-card border border-border">
                  {campaigns.map((c) => (
                    <SelectItem key={c.id} value={c.id} className="text-xs text-black">
                      {truncate(c.name, 50)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <button
              className="text-xs px-3 py-1.5 rounded border bg-card border border-border text-black hover:text-black transition-colors"
              onClick={() => setBulkDialogOpen(false)}
              disabled={bulkSubmitting}
            >
              Cancel
            </button>
            <button
              className={cn(
                "inline-flex items-center gap-1.5 text-xs font-medium px-4 py-1.5 rounded border transition-colors",
                bulkSubmitting
                  ? "bg-gray-800 border-gray-700 text-gray-500 cursor-wait"
                  : "bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20"
              )}
              onClick={handleBulkConfirm}
              disabled={bulkSubmitting || !bulkCampaignId}
              data-testid="btn-confirm-bulk"
            >
              {bulkSubmitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ban className="w-3 h-3" />}
              {bulkSubmitting ? "Adding..." : `Add ${selectedTermKeys.size} Negatives`}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
