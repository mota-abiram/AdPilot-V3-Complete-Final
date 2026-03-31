import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Sparkles,
  Wand2,
  Upload,
  Copy,
  Download,
  Send,
  History,
  ImagePlus,
  Layers3,
  Crown,
  FlaskConical,
  TriangleAlert,
  Loader2,
  RefreshCcw,
  Plus,
  ChevronRight,
} from "lucide-react";
import { useClient } from "@/lib/client-context";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type CreativeTone = "luxury" | "premium" | "affordable";
type CreativePlatform = "meta" | "google_display";
type CreativeSectionKey = "headline" | "subtext" | "cta" | "offerSection" | "visualDirection";
type CreativeStatusTag = "winner" | "testing" | "loser";

interface CreativeAsset {
  id: string;
  name: string;
  type: string;
  size?: number;
  dataUrl: string;
  category: "logo" | "render" | "winner";
}

interface CreativeSetup {
  projectName: string;
  logos: CreativeAsset[];
  renders: CreativeAsset[];
  price: string;
  reraNumber: string;
  buildingNumber: string;
  configuration: string;
  location: string;
  sqftRange: string;
  tone: CreativeTone;
  customInstructions: string;
  winningCreatives: CreativeAsset[];
  updatedAt: string;
}

interface CreativePromptInput {
  campaignIdea: string;
  offer: string;
  hook: string;
  platform: CreativePlatform;
  customInstruction?: string;
}

interface CreativeOutput {
  headline: string;
  subtext: string;
  cta: string;
  offerSection: string;
  visualDirection: string;
  primaryText: string;
  platformNotes: string;
  copyVariations: {
    headlines: string[];
    primaryTexts: string[];
    ctaOptions: string[];
  };
  staticAdStructure: {
    topHook: string;
    heroVisualSuggestion: string;
    midMessaging: string;
    ctaBlock: string;
  };
}

interface CreativeGeneratedImage {
  id: string;
  prompt: string;
  requestedSize: "1080x1080" | "1080x1920" | "1200x628" | "960x1200";
  modelSize: "1024x1024" | "1024x1536" | "1536x1024";
  mimeType: string;
  dataUrl: string;
  createdAt: string;
}

interface CreativeVersion {
  id: string;
  createdAt: string;
  sectionRegenerated: CreativeSectionKey | null;
  output: CreativeOutput;
  generatedImages?: CreativeGeneratedImage[];
}

interface CreativeMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

interface CreativeThread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  statusTag: CreativeStatusTag;
  input: CreativePromptInput;
  messages: CreativeMessage[];
  versions: CreativeVersion[];
  activeVersionId: string;
}

interface CreativeHubState {
  clientId: string;
  setup: CreativeSetup | null;
  threads: CreativeThread[];
  updatedAt: string;
}

interface SetupFormState {
  projectName: string;
  logos: CreativeAsset[];
  renders: CreativeAsset[];
  price: string;
  reraNumber: string;
  buildingNumber: string;
  configuration: string;
  location: string;
  sqftRange: string;
  tone: CreativeTone;
  customInstructions: string;
  winningCreatives: CreativeAsset[];
}

const defaultSetupForm: SetupFormState = {
  projectName: "",
  logos: [],
  renders: [],
  price: "",
  reraNumber: "",
  buildingNumber: "",
  configuration: "",
  location: "",
  sqftRange: "",
  tone: "premium",
  customInstructions: "",
  winningCreatives: [],
};

const defaultPromptInput: CreativePromptInput = {
  campaignIdea: "",
  offer: "",
  hook: "",
  platform: "meta",
  customInstruction: "",
};

const imageSizeOptions: Array<CreativeGeneratedImage["requestedSize"]> = [
  "1080x1080",
  "1080x1920",
  "1200x628",
  "960x1200",
];

const sectionLabels: Record<CreativeSectionKey, string> = {
  headline: "Headline",
  subtext: "Subtext",
  cta: "CTA",
  offerSection: "Offer Section",
  visualDirection: "Visual Direction",
};

function formatRelativeTime(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

async function filesToAssets(files: FileList | null, category: CreativeAsset["category"]) {
  if (!files?.length) return [] as CreativeAsset[];
  const items = Array.from(files);

  return Promise.all(
    items.map(
      (file) =>
        new Promise<CreativeAsset>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () =>
            resolve({
              id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
              name: file.name,
              type: file.type,
              size: file.size,
              dataUrl: String(reader.result || ""),
              category,
            });
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        }),
    ),
  );
}

function removeAsset(list: CreativeAsset[], assetId: string) {
  return list.filter((asset) => asset.id !== assetId);
}

function composeCreativeBrief(thread: CreativeThread, version: CreativeVersion) {
  const output = version.output;
  return `Creative Brief
Client Prompt: ${thread.input.campaignIdea}
Offer: ${thread.input.offer}
Hook: ${thread.input.hook}
Platform: ${thread.input.platform === "google_display" ? "Google Display" : "Meta"}

Headline
${output.headline}

Subtext
${output.subtext}

CTA
${output.cta}

Offer Section
${output.offerSection}

Visual Direction
${output.visualDirection}

Primary Text
${output.primaryText}

Static Ad Structure
- Top Hook: ${output.staticAdStructure.topHook}
- Hero Visual Suggestion: ${output.staticAdStructure.heroVisualSuggestion}
- Mid Messaging: ${output.staticAdStructure.midMessaging}
- CTA Block: ${output.staticAdStructure.ctaBlock}
`;
}

async function parseJsonApiResponse<T>(res: Response): Promise<T> {
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await res.text();
    if (text.includes("<!DOCTYPE") || text.includes("<html")) {
      throw new Error("The API returned an HTML page instead of JSON. Restart the AdPilot server so the new creative image route is loaded.");
    }
    throw new Error("The API returned a non-JSON response.");
  }

  return res.json() as Promise<T>;
}

export default function CreativesPage() {
  const { activeClientId, activeClient, activePlatform, analysisData } = useClient();
  const { toast } = useToast();
  const [setupForm, setSetupForm] = useState<SetupFormState>(defaultSetupForm);
  const [promptInput, setPromptInput] = useState<CreativePromptInput>({
    ...defaultPromptInput,
    platform: activePlatform === "google" ? "google_display" : "meta",
  });
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [selectedSection, setSelectedSection] = useState<CreativeSectionKey | null>(null);
  const [selectedImageSize, setSelectedImageSize] = useState<CreativeGeneratedImage["requestedSize"]>("1080x1080");

  const { data: hubData, isLoading } = useQuery<CreativeHubState>({
    queryKey: ["/api/clients", activeClientId, "creative-hub"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/clients/${activeClientId}/creative-hub`);
      return res.json();
    },
    enabled: !!activeClientId,
  });

  useEffect(() => {
    if (!hubData?.setup) return;
    setSetupForm({
      projectName: hubData.setup.projectName || "",
      logos: hubData.setup.logos || [],
      renders: hubData.setup.renders || [],
      price: hubData.setup.price || "",
      reraNumber: hubData.setup.reraNumber || "",
      buildingNumber: hubData.setup.buildingNumber || "",
      configuration: hubData.setup.configuration || "",
      location: hubData.setup.location || "",
      sqftRange: hubData.setup.sqftRange || "",
      tone: hubData.setup.tone || "premium",
      customInstructions: hubData.setup.customInstructions || "",
      winningCreatives: hubData.setup.winningCreatives || [],
    });
  }, [hubData?.setup?.updatedAt]);

  useEffect(() => {
    setPromptInput((current) => ({
      ...current,
      platform: activePlatform === "google" ? "google_display" : "meta",
    }));
  }, [activePlatform]);

  useEffect(() => {
    if (!hubData?.threads?.length) {
      setSelectedThreadId(null);
      setSelectedVersionId(null);
      return;
    }
    if (!selectedThreadId || !hubData.threads.some((thread) => thread.id === selectedThreadId)) {
      const nextThread = hubData.threads[0];
      setSelectedThreadId(nextThread.id);
      setSelectedVersionId(nextThread.activeVersionId);
      setSelectedSection(null);
    }
  }, [hubData?.threads, selectedThreadId]);

  const selectedThread = useMemo(
    () => hubData?.threads.find((thread) => thread.id === selectedThreadId) || null,
    [hubData?.threads, selectedThreadId],
  );

  const selectedVersion = useMemo(() => {
    if (!selectedThread) return null;
    return (
      selectedThread.versions.find((version) => version.id === (selectedVersionId || selectedThread.activeVersionId)) ||
      selectedThread.versions[0] ||
      null
    );
  }, [selectedThread, selectedVersionId]);

  const creativeReferences = useMemo(() => {
    const raw = ((analysisData as any)?.creative_health || []) as any[];
    return raw
      .slice()
      .sort((a, b) => (b.creative_score || 0) - (a.creative_score || 0))
      .slice(0, 5)
      .map((item) => ({
        id: item.ad_id || item.id || item.ad_name,
        name: item.ad_name || item.name || "Creative",
        score: item.creative_score || 0,
        ctr: item.ctr || 0,
        cpl: item.cpl || 0,
        classification: item.classification || "TESTING",
      }));
  }, [analysisData]);

  const syncHubState = (next: CreativeHubState) => {
    queryClient.setQueryData(["/api/clients", activeClientId, "creative-hub"], next);
  };

  const saveSetupMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/clients/${activeClientId}/creative-hub/setup`, setupForm);
      return parseJsonApiResponse<CreativeHubState>(res);
    },
    onSuccess: (next) => {
      syncHubState(next);
      toast({ title: "Creative SOP saved", description: "This client setup will be reused across all creative generations." });
    },
    onError: (error: any) => {
      toast({ title: "Unable to save SOP", description: error?.message || "Please try again.", variant: "destructive" });
    },
  });

  const generateMutation = useMutation({
    mutationFn: async (payload: CreativePromptInput) => {
      const res = await apiRequest("POST", `/api/clients/${activeClientId}/creative-hub/generate`, payload);
      return parseJsonApiResponse<CreativeHubState>(res);
    },
    onSuccess: (next) => {
      syncHubState(next);
      if (next.threads[0]) {
        setSelectedThreadId(next.threads[0].id);
        setSelectedVersionId(next.threads[0].activeVersionId);
        setSelectedSection(null);
      }
      toast({ title: "Creative generated", description: "A new creative concept and variation set is ready." });
    },
    onError: (error: any) => {
      toast({ title: "Generation failed", description: error?.message || "Please try again.", variant: "destructive" });
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: async (sectionKey: CreativeSectionKey) => {
      const res = await apiRequest("POST", `/api/clients/${activeClientId}/creative-hub/${selectedThreadId}/regenerate`, {
        sectionKey,
      });
      return parseJsonApiResponse<CreativeHubState>(res);
    },
    onSuccess: (next) => {
      syncHubState(next);
      const thread = next.threads.find((item) => item.id === selectedThreadId);
      if (thread) setSelectedVersionId(thread.activeVersionId);
      toast({ title: "Section regenerated", description: "Only the selected block changed. The rest stayed intact." });
    },
    onError: (error: any) => {
      toast({ title: "Could not regenerate section", description: error?.message || "Please try again.", variant: "destructive" });
    },
  });

  const tagMutation = useMutation({
    mutationFn: async (statusTag: CreativeStatusTag) => {
      const res = await apiRequest("POST", `/api/clients/${activeClientId}/creative-hub/${selectedThreadId}/tag`, { statusTag });
      return parseJsonApiResponse<CreativeHubState>(res);
    },
    onSuccess: (next) => syncHubState(next),
  });

  const duplicateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/clients/${activeClientId}/creative-hub/${selectedThreadId}/duplicate`);
      return parseJsonApiResponse<CreativeHubState>(res);
    },
    onSuccess: (next) => {
      syncHubState(next);
      if (next.threads[0]) {
        setSelectedThreadId(next.threads[0].id);
        setSelectedVersionId(next.threads[0].activeVersionId);
      }
      toast({ title: "Creative duplicated", description: "You can now modify the copied version independently." });
    },
  });

  const generateImageMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/clients/${activeClientId}/creative-hub/${selectedThreadId}/generate-image`, {
        versionId: selectedVersionId || selectedThread?.activeVersionId,
        requestedSize: selectedImageSize,
      });
      return parseJsonApiResponse<CreativeHubState>(res);
    },
    onSuccess: (next) => {
      syncHubState(next);
      toast({ title: "Image generated", description: `A ${selectedImageSize} creative image is ready in the preview panel.` });
    },
    onError: (error: any) => {
      toast({ title: "Image generation failed", description: error?.message || "Please try again.", variant: "destructive" });
    },
  });

  const setupComplete = Boolean(
    setupForm.projectName &&
      setupForm.configuration &&
      setupForm.location &&
      setupForm.price &&
      setupForm.customInstructions,
  );

  const handleUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
    category: CreativeAsset["category"],
    targetField: "logos" | "renders" | "winningCreatives",
  ) => {
    try {
      const assets = await filesToAssets(event.target.files, category);
      setSetupForm((current) => ({
        ...current,
        [targetField]: [...current[targetField], ...assets],
      }));
      event.target.value = "";
    } catch {
      toast({ title: "Upload failed", description: "One or more files could not be processed.", variant: "destructive" });
    }
  };

  const handleCopyBrief = async () => {
    if (!selectedThread || !selectedVersion) return;
    await navigator.clipboard.writeText(composeCreativeBrief(selectedThread, selectedVersion));
    toast({ title: "Copied to clipboard", description: "Creative brief is ready to paste anywhere." });
  };

  const handleExportBrief = () => {
    if (!selectedThread || !selectedVersion) return;
    const blob = new Blob([composeCreativeBrief(selectedThread, selectedVersion)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${selectedThread.title.replace(/\s+/g, "-").toLowerCase()}-brief.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const latestGeneratedImage = selectedVersion?.generatedImages?.[0] || null;

  const handleDownloadGeneratedImage = () => {
    if (!latestGeneratedImage) return;
    const anchor = document.createElement("a");
    anchor.href = latestGeneratedImage.dataUrl;
    anchor.download = `${(selectedThread?.title || "creative").replace(/\s+/g, "-").toLowerCase()}-${latestGeneratedImage.requestedSize}.png`;
    anchor.click();
  };

  if (isLoading) {
    return (
      <div className="page-shell max-w-[1700px] mx-auto">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-[720px] rounded-xl" />
      </div>
    );
  }

  return (
    <div className="page-shell max-w-[1700px] mx-auto">
      <section className="page-zone" aria-labelledby="creative-hub-title">
        <div className="flex items-start justify-between gap-4 flex-wrap rounded-[10px] border border-border/70 bg-card/82 px-5 py-5 shadow-sm">
          <div className="page-subsection">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-[10px] bg-primary/15 text-primary shadow-xs">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h1 id="creative-hub-title" className="text-2xl font-extrabold">Creatives</h1>
                <p className="type-base text-muted-foreground">
                  Creative Intelligence + Generation Hub for {activeClient?.name || "this client"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="warning">Primary creative workspace</Badge>
              <Badge variant="secondary">{hubData?.threads.length || 0} prompt threads</Badge>
              <Badge variant="secondary">{setupForm.winningCreatives.length} reference creatives</Badge>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" onClick={() => selectedThread && duplicateMutation.mutate()} disabled={!selectedThread || duplicateMutation.isPending}>
              {duplicateMutation.isPending ? <Loader2 className="animate-spin" /> : <Copy />}
              Duplicate & Modify
            </Button>
            <Button onClick={() => generateMutation.mutate(promptInput)} disabled={!setupComplete || generateMutation.isPending}>
              {generateMutation.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />}
              Generate Creative
            </Button>
          </div>
        </div>
      </section>

      {!setupComplete && (
        <section aria-labelledby="creative-setup-warning">
          <div className="flex items-start gap-3 rounded-[10px] border border-primary/30 bg-primary/8 px-4 py-3">
            <TriangleAlert className="w-5 h-5 text-primary mt-0.5 shrink-0" />
            <div>
              <h2 id="creative-setup-warning" className="text-base font-bold">Creative SOP setup is required before generation</h2>
              <p className="type-sm text-muted-foreground">
                Fill the onboarding layer once for this client, save it, and the AI will reuse it for every new variation.
              </p>
            </div>
          </div>
        </section>
      )}

      <section className="page-zone" aria-labelledby="creative-sop-title">
        <Card>
          <CardHeader>
            <CardTitle id="creative-sop-title">Creative SOP Setup</CardTitle>
            <CardDescription>
              This client-level setup acts as persistent creative context for every generation and regeneration pass.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 lg:grid-cols-2">
            <div className="grid gap-4">
              <div className="grid gap-2">
                <label className="type-sm font-semibold text-foreground">Project Name</label>
                <Input value={setupForm.projectName} onChange={(e) => setSetupForm((current) => ({ ...current, projectName: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <label className="type-sm font-semibold text-foreground">Price</label>
                  <Input value={setupForm.price} onChange={(e) => setSetupForm((current) => ({ ...current, price: e.target.value }))} />
                </div>
                <div className="grid gap-2">
                  <label className="type-sm font-semibold text-foreground">RERA Number</label>
                  <Input value={setupForm.reraNumber} onChange={(e) => setSetupForm((current) => ({ ...current, reraNumber: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <label className="type-sm font-semibold text-foreground">Building Number</label>
                  <Input value={setupForm.buildingNumber} onChange={(e) => setSetupForm((current) => ({ ...current, buildingNumber: e.target.value }))} />
                </div>
                <div className="grid gap-2">
                  <label className="type-sm font-semibold text-foreground">Configuration</label>
                  <Input value={setupForm.configuration} onChange={(e) => setSetupForm((current) => ({ ...current, configuration: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <label className="type-sm font-semibold text-foreground">Location</label>
                  <Input value={setupForm.location} onChange={(e) => setSetupForm((current) => ({ ...current, location: e.target.value }))} />
                </div>
                <div className="grid gap-2">
                  <label className="type-sm font-semibold text-foreground">Sqft Range</label>
                  <Input value={setupForm.sqftRange} onChange={(e) => setSetupForm((current) => ({ ...current, sqftRange: e.target.value }))} />
                </div>
              </div>
              <div className="grid gap-2">
                <label className="type-sm font-semibold text-foreground">Tone Selector</label>
                <div className="grid grid-cols-3 gap-2">
                  {(["luxury", "premium", "affordable"] as CreativeTone[]).map((tone) => (
                    <button
                      key={tone}
                      type="button"
                      className={cn(
                        "rounded-lg border px-3 py-2 text-sm font-semibold capitalize transition-colors",
                        setupForm.tone === tone
                          ? "border-primary/40 bg-primary/14 text-foreground shadow-xs"
                          : "border-border/60 bg-card hover:border-primary/25 hover:bg-accent/70 text-muted-foreground",
                      )}
                      onClick={() => setSetupForm((current) => ({ ...current, tone }))}
                    >
                      {tone}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-2">
                <label className="type-sm font-semibold text-foreground">Custom Instructions</label>
                <Textarea
                  value={setupForm.customInstructions}
                  onChange={(e) => setSetupForm((current) => ({ ...current, customInstructions: e.target.value }))}
                  placeholder="Avoid cliché language. Focus on aspiration + scarcity. Keep the copy performance-driven."
                />
              </div>
            </div>

            <div className="grid gap-4">
              {[
                { title: "Logos", field: "logos" as const, category: "logo" as const, description: "Upload brand marks used in creative previews." },
                { title: "Renders", field: "renders" as const, category: "render" as const, description: "Optional visual references or property renders." },
                { title: "Past Winning Creatives", field: "winningCreatives" as const, category: "winner" as const, description: "Use strong historical ads as AI reference context." },
              ].map((group) => (
                <Card key={group.title} className="border-border/70 bg-muted/20">
                  <CardHeader>
                    <CardTitle className="text-base">{group.title}</CardTitle>
                    <CardDescription>{group.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3">
                    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-primary/35 bg-primary/10 px-4 py-3 text-sm font-semibold text-foreground hover:bg-primary/15">
                      <Upload className="w-4 h-4" />
                      Upload {group.title}
                      <input
                        type="file"
                        className="hidden"
                        multiple
                        accept="image/*,video/*"
                        onChange={(event) => handleUpload(event, group.category, group.field)}
                      />
                    </label>
                    <div className="grid gap-2">
                      {setupForm[group.field].length === 0 ? (
                        <p className="type-sm text-muted-foreground">No assets uploaded yet.</p>
                      ) : (
                        setupForm[group.field].map((asset) => (
                          <div key={asset.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-card px-3 py-2">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-foreground truncate">{asset.name}</p>
                              <p className="type-sm text-muted-foreground">
                                {asset.type || "asset"}{asset.size ? ` · ${Math.round(asset.size / 1024)} KB` : ""}
                              </p>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setSetupForm((current) => ({
                                  ...current,
                                  [group.field]: removeAsset(current[group.field], asset.id),
                                }))
                              }
                            >
                              Remove
                            </Button>
                          </div>
                        ))
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}

              <div className="flex justify-end">
                <Button onClick={() => saveSetupMutation.mutate()} disabled={saveSetupMutation.isPending}>
                  {saveSetupMutation.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
                  Save SOP Setup
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)_340px]" aria-labelledby="creative-studio-title">
        <aside className="min-h-0">
          <Card className="h-full">
            <CardHeader>
              <CardTitle id="creative-studio-title" className="flex items-center gap-2">
                <History className="w-4 h-4 text-primary" />
                Prompt History
              </CardTitle>
              <CardDescription>Every generation, variation, and duplicate stays client-scoped.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {hubData?.threads.length ? (
                hubData.threads.map((thread) => (
                  <button
                    key={thread.id}
                    type="button"
                    className={cn(
                      "grid gap-2 rounded-[10px] border px-3 py-3 text-left transition-colors",
                      selectedThreadId === thread.id
                        ? "border-primary/40 bg-primary/10 shadow-xs"
                        : "border-border/60 bg-card hover:border-primary/25 hover:bg-accent/60",
                    )}
                    onClick={() => {
                      setSelectedThreadId(thread.id);
                      setSelectedVersionId(thread.activeVersionId);
                      setSelectedSection(null);
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-foreground truncate">{thread.title}</p>
                      <Badge
                        variant={
                          thread.statusTag === "winner"
                            ? "success"
                            : thread.statusTag === "loser"
                            ? "destructive"
                            : "warning"
                        }
                      >
                        {thread.statusTag}
                      </Badge>
                    </div>
                    <p className="type-sm text-muted-foreground line-clamp-2">{thread.input.offer}</p>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>{thread.versions.length} version{thread.versions.length !== 1 ? "s" : ""}</span>
                      <span>{formatRelativeTime(thread.updatedAt)}</span>
                    </div>
                  </button>
                ))
              ) : (
                <div className="rounded-[10px] border border-dashed border-border/70 bg-muted/20 px-4 py-6 text-center">
                  <p className="text-base font-semibold text-foreground">No creative threads yet</p>
                  <p className="type-sm text-muted-foreground">Start with the generator and your prompt history will appear here.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </aside>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wand2 className="w-4 h-4 text-primary" />
                Creative Generation Interface
              </CardTitle>
              <CardDescription>
                Use the SOP, session instructions, and past winners to generate platform-aware concepts fast.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid lg:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <label className="type-sm font-semibold text-foreground">Campaign Idea</label>
                  <Input value={promptInput.campaignIdea} onChange={(e) => setPromptInput((current) => ({ ...current, campaignIdea: e.target.value }))} placeholder="Launch the next high-intent lead-gen angle" />
                </div>
                <div className="grid gap-2">
                  <label className="type-sm font-semibold text-foreground">Offer</label>
                  <Input value={promptInput.offer} onChange={(e) => setPromptInput((current) => ({ ...current, offer: e.target.value }))} placeholder="2 & 3 BHK from 99.39L with launch pricing" />
                </div>
              </div>

              <div className="grid lg:grid-cols-[1.2fr_0.8fr] gap-4">
                <div className="grid gap-2">
                  <label className="type-sm font-semibold text-foreground">Hook</label>
                  <Input value={promptInput.hook} onChange={(e) => setPromptInput((current) => ({ ...current, hook: e.target.value }))} placeholder="The address serious buyers shortlist first" />
                </div>
                <div className="grid gap-2">
                  <label className="type-sm font-semibold text-foreground">Platform</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { value: "meta" as CreativePlatform, label: "Meta" },
                      { value: "google_display" as CreativePlatform, label: "Google Display" },
                    ].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={cn(
                          "rounded-lg border px-3 py-2 text-sm font-semibold transition-colors",
                          promptInput.platform === option.value
                            ? "border-primary/40 bg-primary/14 text-foreground shadow-xs"
                            : "border-border/60 bg-card hover:border-primary/25 hover:bg-accent/70 text-muted-foreground",
                        )}
                        onClick={() => setPromptInput((current) => ({ ...current, platform: option.value }))}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid gap-2">
                <label className="type-sm font-semibold text-foreground">Add custom instruction for this creative</label>
                <Textarea
                  value={promptInput.customInstruction}
                  onChange={(e) => setPromptInput((current) => ({ ...current, customInstruction: e.target.value }))}
                  placeholder="Push more aspiration, reduce direct pricing, and lean harder into urgency."
                />
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <Button onClick={() => generateMutation.mutate(promptInput)} disabled={!setupComplete || generateMutation.isPending}>
                  {generateMutation.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
                  Generate More
                </Button>
                <Button
                  variant="outline"
                  onClick={() => generateImageMutation.mutate()}
                  disabled={!selectedThread || !selectedVersion || generateImageMutation.isPending}
                >
                  {generateImageMutation.isPending ? <Loader2 className="animate-spin" /> : <ImagePlus />}
                  Generate Image
                </Button>
                <Button variant="outline" onClick={() => generateMutation.mutate(promptInput)} disabled={!setupComplete || generateMutation.isPending}>
                  <Plus />
                  Create Variations
                </Button>
                <Button
                  variant="outline"
                  onClick={() => selectedSection && regenerateMutation.mutate(selectedSection)}
                  disabled={!selectedThread || !selectedSection || regenerateMutation.isPending}
                >
                  {regenerateMutation.isPending ? <Loader2 className="animate-spin" /> : <RefreshCcw />}
                  Regenerate Selected Area
                </Button>
                {selectedSection && <Badge variant="warning">{sectionLabels[selectedSection]} selected</Badge>}
                <div className="flex items-center gap-2 flex-wrap">
                  {imageSizeOptions.map((size) => (
                    <button
                      key={size}
                      type="button"
                      className={cn(
                        "rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors",
                        selectedImageSize === size
                          ? "border-primary/40 bg-primary/14 text-foreground"
                          : "border-border/60 bg-card text-muted-foreground hover:border-primary/25 hover:bg-accent/70",
                      )}
                      onClick={() => setSelectedImageSize(size)}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Layers3 className="w-4 h-4 text-primary" />
                Chat + Output
              </CardTitle>
              <CardDescription>
                Prompt history on the left, structured creative output in the center, preview and intelligence on the right.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              {!selectedThread || !selectedVersion ? (
                <div className="rounded-[10px] border border-dashed border-border/70 bg-muted/20 px-4 py-8 text-center">
                  <p className="text-base font-semibold text-foreground">No active creative selected</p>
                  <p className="type-sm text-muted-foreground">Generate one and the editable output blocks will appear here.</p>
                </div>
              ) : (
                <>
                  <div className="grid gap-3">
                    {selectedThread.messages.map((message) => (
                      <div
                        key={message.id}
                        className={cn(
                          "max-w-[90%] rounded-[10px] px-4 py-3 shadow-xs",
                          message.role === "user"
                            ? "justify-self-end bg-primary/14 border border-primary/25"
                            : "justify-self-start bg-card border border-border/70",
                        )}
                      >
                        <p className="type-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground mb-1">
                          {message.role === "user" ? "Prompt" : "Mojo"}
                        </p>
                        <p className="text-base whitespace-pre-wrap text-foreground">{message.content}</p>
                      </div>
                    ))}
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    {(Object.keys(sectionLabels) as CreativeSectionKey[]).map((sectionKey) => (
                      <button
                        key={sectionKey}
                        type="button"
                        onClick={() => setSelectedSection(sectionKey)}
                        className={cn(
                          "rounded-[10px] border bg-card px-4 py-4 text-left transition-colors shadow-xs",
                          selectedSection === sectionKey
                            ? "border-primary/45 bg-primary/8"
                            : "border-border/70 hover:border-primary/25 hover:bg-accent/60",
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">{sectionLabels[sectionKey]}</p>
                            <p className="text-base font-semibold text-foreground mt-1">
                              {selectedVersion.output[sectionKey]}
                            </p>
                          </div>
                          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="grid gap-4 rounded-[10px] border border-border/70 bg-muted/18 p-4">
                    <div className="grid gap-2">
                      <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">Copy Variations</p>
                      <div className="grid lg:grid-cols-3 gap-3">
                        <Card className="border-border/60">
                          <CardHeader><CardTitle className="text-base">Headlines</CardTitle></CardHeader>
                          <CardContent className="grid gap-2">
                            {selectedVersion.output.copyVariations.headlines.map((item, index) => (
                              <p key={index} className="text-base text-foreground">{item}</p>
                            ))}
                          </CardContent>
                        </Card>
                        <Card className="border-border/60">
                          <CardHeader><CardTitle className="text-base">Primary Text</CardTitle></CardHeader>
                          <CardContent className="grid gap-2">
                            {selectedVersion.output.copyVariations.primaryTexts.map((item, index) => (
                              <p key={index} className="text-base text-foreground">{item}</p>
                            ))}
                          </CardContent>
                        </Card>
                        <Card className="border-border/60">
                          <CardHeader><CardTitle className="text-base">CTA Options</CardTitle></CardHeader>
                          <CardContent className="grid gap-2">
                            {selectedVersion.output.copyVariations.ctaOptions.map((item, index) => (
                              <p key={index} className="text-base text-foreground">{item}</p>
                            ))}
                          </CardContent>
                        </Card>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="grid gap-6 self-start">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ImagePlus className="w-4 h-4 text-primary" />
                Preview Panel
              </CardTitle>
              <CardDescription>Static layout structure, AI image preview, and export-ready controls.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {selectedThread && selectedVersion ? (
                <>
                  {latestGeneratedImage ? (
                    <div className="rounded-[10px] border border-border/70 bg-card p-3 shadow-xs">
                      <img
                        src={latestGeneratedImage.dataUrl}
                        alt={`${selectedThread.title} generated preview`}
                        className="w-full rounded-lg border border-border/60 bg-muted/20 object-cover"
                      />
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">Generated Size</p>
                          <p className="text-sm font-semibold text-foreground">
                            {latestGeneratedImage.requestedSize} · model {latestGeneratedImage.modelSize}
                          </p>
                        </div>
                        <Button variant="outline" onClick={handleDownloadGeneratedImage}>
                          <Download />
                          Download Image
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-[10px] border border-dashed border-border/70 bg-muted/20 px-4 py-6 text-center">
                      <p className="text-base font-semibold text-foreground">No AI image yet</p>
                      <p className="type-sm text-muted-foreground">
                        Pick a size and use Generate Image to create a visual from the current creative version.
                      </p>
                    </div>
                  )}

                  <div className="rounded-[10px] border border-border/70 bg-card px-4 py-4 shadow-xs">
                    <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">Top Hook</p>
                    <p className="text-lg font-bold text-foreground mt-2">{selectedVersion.output.staticAdStructure.topHook}</p>
                    <div className="mt-4 grid gap-3">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">Hero Visual Suggestion</p>
                        <p className="text-base text-foreground mt-1">{selectedVersion.output.staticAdStructure.heroVisualSuggestion}</p>
                      </div>
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">Mid Messaging</p>
                        <p className="text-base text-foreground mt-1">{selectedVersion.output.staticAdStructure.midMessaging}</p>
                      </div>
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">CTA Block</p>
                        <p className="text-base text-foreground mt-1">{selectedVersion.output.staticAdStructure.ctaBlock}</p>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <Button onClick={handleCopyBrief}><Copy />Copy Text</Button>
                    <Button variant="outline" onClick={handleExportBrief}><Download />Export as Brief</Button>
                    <Button variant="outline" onClick={handleCopyBrief}><Send />Send to Design Team</Button>
                  </div>

                  <div className="grid gap-2">
                    <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">Creative Performance Tagging</p>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { value: "winner" as CreativeStatusTag, label: "Winner", icon: Crown, variant: "success" as const },
                        { value: "testing" as CreativeStatusTag, label: "Testing", icon: FlaskConical, variant: "warning" as const },
                        { value: "loser" as CreativeStatusTag, label: "Loser", icon: TriangleAlert, variant: "destructive" as const },
                      ].map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => tagMutation.mutate(option.value)}
                          className={cn(
                            "rounded-lg border px-3 py-3 text-center transition-colors",
                            selectedThread.statusTag === option.value
                              ? "border-primary/40 bg-primary/12 shadow-xs"
                              : "border-border/60 bg-card hover:border-primary/25 hover:bg-accent/60",
                          )}
                        >
                          <option.icon className="w-4 h-4 mx-auto mb-2 text-primary" />
                          <p className="text-sm font-semibold text-foreground">{option.label}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <p className="type-sm text-muted-foreground">Select a creative thread to preview its structure and export options.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Creative Intelligence</CardTitle>
              <CardDescription>Recent high-performing creative references from the current analysis snapshot.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {creativeReferences.length ? (
                creativeReferences.map((item) => (
                  <div key={item.id} className="rounded-[10px] border border-border/70 bg-card px-3 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-foreground truncate">{item.name}</p>
                      <Badge variant={item.score >= 70 ? "success" : item.score >= 40 ? "warning" : "destructive"}>
                        {item.classification || "Testing"}
                      </Badge>
                    </div>
                    <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
                      <span>Score {Math.round(item.score)}</span>
                      <span>CTR {item.ctr.toFixed(2)}%</span>
                      <span>CPL {Math.round(item.cpl)}</span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="type-sm text-muted-foreground">No creative performance context is available for this client yet.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Version History</CardTitle>
              <CardDescription>Track iterations and jump back into prior versions if needed.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {selectedThread?.versions.length ? (
                selectedThread.versions.map((version) => (
                  <button
                    key={version.id}
                    type="button"
                    className={cn(
                      "rounded-[10px] border px-3 py-3 text-left transition-colors",
                      selectedVersion?.id === version.id
                        ? "border-primary/40 bg-primary/10 shadow-xs"
                        : "border-border/60 bg-card hover:border-primary/25 hover:bg-accent/60",
                    )}
                    onClick={() => setSelectedVersionId(version.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-foreground">
                        {version.sectionRegenerated ? `Updated ${sectionLabels[version.sectionRegenerated]}` : "Initial generation"}
                      </p>
                      <span className="text-[11px] text-muted-foreground">{formatRelativeTime(version.createdAt)}</span>
                    </div>
                  </button>
                ))
              ) : (
                <p className="type-sm text-muted-foreground">Create a concept to begin version tracking.</p>
              )}
            </CardContent>
          </Card>
        </aside>
      </section>
    </div>
  );
}
