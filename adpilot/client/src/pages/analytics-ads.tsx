import { useMemo } from "react";
import { BarChart3, Film, ImageIcon, Layers } from "lucide-react";
import { useClient } from "@/lib/client-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatINR, formatNumber } from "@/lib/format";

type AdsPanelCreative = {
  id: string;
  name: string;
  campaignName: string;
  adsetName: string;
  isVideo: boolean;
  spend: number;
  impressions: number;
  leads: number;
  ctr: number;
  cpl: number;
  tsr?: number;
  vhr?: number;
};

function SummaryCard({
  title,
  value,
  subtitle,
  icon: Icon,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: any;
}) {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{title}</p>
            <p className="mt-2 text-3xl font-extrabold tracking-[-0.03em] text-foreground">{value}</p>
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/12 text-primary">
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CreativeTable({
  creatives,
  title,
  description,
}: {
  creatives: AdsPanelCreative[];
  title: string;
  description: string;
}) {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <Badge variant="secondary" className="text-xs">
          {formatNumber(creatives.length)} creatives
        </Badge>
      </CardHeader>
      <CardContent>
        {creatives.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
            No creative data is available in this section yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-border/70 text-left text-xs uppercase tracking-[0.12em] text-muted-foreground">
                  <th className="px-3 py-3 font-semibold">Creative</th>
                  <th className="px-3 py-3 font-semibold">Type</th>
                  <th className="px-3 py-3 font-semibold text-right">Spend</th>
                  <th className="px-3 py-3 font-semibold text-right">Leads</th>
                  <th className="px-3 py-3 font-semibold text-right">CPL</th>
                  <th className="px-3 py-3 font-semibold text-right">CTR</th>
                  <th className="px-3 py-3 font-semibold text-right">TSR</th>
                  <th className="px-3 py-3 font-semibold text-right">VHR</th>
                </tr>
              </thead>
              <tbody>
                {creatives.map((creative) => (
                  <tr key={creative.id} className="border-b border-border/50 last:border-b-0 hover:bg-muted/20 transition-colors">
                    <td className="px-3 py-3">
                      <div className="font-medium text-foreground">{creative.name}</div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{creative.campaignName}</div>
                    </td>
                    <td className="px-3 py-3">
                      <Badge variant={creative.isVideo ? "default" : "secondary"} className="text-[10px] px-1.5 py-0 uppercase">
                        {creative.isVideo ? "Video" : "Static"}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatINR(creative.spend, 0)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatNumber(creative.leads)}</td>
                    <td className="px-3 py-3 text-right tabular-nums font-medium">{creative.cpl > 0 ? formatINR(creative.cpl, 0) : "—"}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-blue-400">{creative.ctr.toFixed(2)}%</td>
                    <td className="px-3 py-3 text-right tabular-nums text-amber-400">
                      {creative.isVideo && creative.tsr !== undefined ? `${creative.tsr.toFixed(1)}%` : <span className="text-muted-foreground/30">—</span>}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-emerald-400">
                      {creative.isVideo && creative.vhr !== undefined ? `${creative.vhr.toFixed(1)}%` : <span className="text-muted-foreground/30">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AnalyticsAdsPage() {
  const { analysisData: data, isLoadingAnalysis: isLoading, activePlatform } = useClient();
  const isGoogle = activePlatform === "google";

  const creatives = useMemo<AdsPanelCreative[]>(() => {
    if (!data) return [];

    if (!isGoogle) {
      return (((data as any).creative_health || []) as any[]).map((creative) => ({
        id: creative.ad_id || creative.id || creative.ad_name,
        name: creative.ad_name || "Untitled Ad",
        campaignName: creative.campaign_name || "Unassigned Campaign",
        adsetName: creative.adset_name || "Unassigned Ad Set",
        isVideo: !!creative.is_video,
        spend: creative.spend || 0,
        impressions: creative.impressions || 0,
        leads: creative.leads || 0,
        ctr: creative.ctr || 0,
        cpl: creative.cpl || 0,
        tsr: creative.thumb_stop_pct,
        vhr: creative.hold_rate_pct,
      }));
    }

    const googleCreatives: AdsPanelCreative[] = [];
    const ch = ((data as any).creative_health || []) as any[];

    if (ch.length > 0) {
      return ch.map(c => ({
        id: c.ad_id || c.id || c.name,
        name: c.ad_name || c.name || "Untitled Ad",
        campaignName: c.campaign_name || "Unassigned Campaign",
        adsetName: c.ad_group_name || "Unassigned Ad Group",
        isVideo: !!c.is_video,
        spend: c.spend || 0,
        impressions: c.impressions || 0,
        leads: c.leads || 0,
        ctr: c.ctr || 0,
        cpl: c.cpl || 0,
        tsr: c.tsr,
        vhr: c.vhr,
      }));
    }

    // Fallback if creative_health not present
    const campaigns = ((data as any).campaigns || []) as any[];
    campaigns.forEach((campaign) => {
      ((campaign.ad_groups || []) as any[]).forEach((adGroup) => {
        ((adGroup.ads || []) as any[]).forEach((ad) => {
          googleCreatives.push({
            id: ad.id || ad.ad_id || `${campaign.name}-${adGroup.name}-${ad.name}`,
            name: ad.name || ad.headline || "Untitled Ad",
            campaignName: campaign.name || "Unassigned Campaign",
            adsetName: adGroup.name || "Unassigned Ad Group",
            isVideo: ad.ad_type === "VIDEO" || (ad.type?.includes?.("VIDEO") ?? false),
            spend: ad.cost || ad.spend || 0,
            impressions: ad.impressions || 0,
            leads: ad.conversions || ad.leads || 0,
            ctr: ad.ctr || 0,
            cpl: (ad.cost || 0) / (ad.conversions || 1) || 0,
          });
        });
      });
    });

    return googleCreatives;
  }, [data, isGoogle]);

  const totals = useMemo(() => {
    const videos = creatives.filter((creative) => creative.isVideo);
    const statics = creatives.filter((creative) => !creative.isVideo);
    const totalSpend = creatives.reduce((sum, creative) => sum + creative.spend, 0);
    const totalImpressions = creatives.reduce((sum, creative) => sum + creative.impressions, 0);

    return {
      all: creatives.length,
      videos: videos.length,
      statics: statics.length,
      totalSpend,
      totalImpressions,
    };
  }, [creatives]);

  const combinedCreatives = useMemo(
    () => [...creatives].sort((a, b) => b.spend - a.spend),
    [creatives],
  );
  const videoCreatives = useMemo(
    () => combinedCreatives.filter((creative) => creative.isVideo),
    [combinedCreatives],
  );
  const staticCreatives = useMemo(
    () => combinedCreatives.filter((creative) => !creative.isVideo),
    [combinedCreatives],
  );

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
        </div>
        <Skeleton className="h-[360px] rounded-xl" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold text-foreground">Ads Panel</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Creative mix snapshot for the current client and cadence window.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          title="Videos"
          value={formatNumber(totals.videos)}
          subtitle={`${totals.all > 0 ? Math.round((totals.videos / totals.all) * 100) : 0}% of all creatives`}
          icon={Film}
        />
        <SummaryCard
          title="Statics"
          value={formatNumber(totals.statics)}
          subtitle={`${totals.all > 0 ? Math.round((totals.statics / totals.all) * 100) : 0}% of all creatives`}
          icon={ImageIcon}
        />
        <SummaryCard
          title="Combined"
          value={formatNumber(totals.all)}
          subtitle={`${formatINR(totals.totalSpend, 0)} spend across ${formatNumber(totals.totalImpressions)} impressions`}
          icon={Layers}
        />
      </div>

      <Tabs defaultValue="all" className="space-y-4">
        <TabsList className="h-auto flex-wrap justify-start gap-2 rounded-xl bg-muted/55 p-1">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="videos">Videos</TabsTrigger>
          <TabsTrigger value="statics">Statics</TabsTrigger>
        </TabsList>

        <TabsContent value="all">
          <CreativeTable
            creatives={combinedCreatives}
            title="All Creatives Combined"
            description="Sorted by spend so the heaviest creatives show first."
          />
        </TabsContent>

        <TabsContent value="videos">
          <CreativeTable
            creatives={videoCreatives}
            title="Video Creatives"
            description="Only video ads from the current client and cadence window."
          />
        </TabsContent>

        <TabsContent value="statics">
          <CreativeTable
            creatives={staticCreatives}
            title="Static Creatives"
            description="Only static or image-led ads from the current client and cadence window."
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
