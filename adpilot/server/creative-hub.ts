import fs from "fs";
import path from "path";

const DATA_BASE = path.resolve(import.meta.dirname, "../../ads_agent/data");
const CREATIVE_HUB_FILE = path.join(DATA_BASE, "creative_hub.json");
const CREATIVE_SOP_FILE = path.resolve(import.meta.dirname, "../../docs/creative-video-creation-sop.md");
const OPENAI_BASE_URL = "https://api.openai.com/v1";
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

function getOpenAiApiKey(): string {
  return process.env.OPENAI_API_KEY || "";
}

function getOpenAiModel(): string {
  return process.env.OPENAI_MODEL || "gpt-4.1-mini";
}

function getOpenAiImageModel(): string {
  return process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
}

function getGroqApiKey(): string {
  return process.env.GROQ_API_KEY || "";
}

function getGroqModel(): string {
  return process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
}

export type CreativeTone = "luxury" | "premium" | "affordable";
export type CreativePlatform = "meta" | "google_display";
export type CreativeSectionKey =
  | "headline"
  | "subtext"
  | "cta"
  | "offerSection"
  | "visualDirection";
export type CreativeStatusTag = "winner" | "testing" | "loser";

export interface CreativeAsset {
  id: string;
  name: string;
  type: string;
  size?: number;
  dataUrl: string;
  category: "logo" | "render" | "winner";
}

export interface CreativeSetup {
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

export interface CreativePromptInput {
  campaignIdea: string;
  offer: string;
  hook: string;
  platform: CreativePlatform;
  customInstruction?: string;
}

export interface CreativeOutput {
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

export interface CreativeGeneratedImage {
  id: string;
  prompt: string;
  requestedSize: "1080x1080" | "1080x1920" | "1200x628" | "960x1200";
  modelSize: "1024x1024" | "1024x1536" | "1536x1024";
  mimeType: string;
  dataUrl: string;
  createdAt: string;
}

export interface CreativeVersion {
  id: string;
  createdAt: string;
  sectionRegenerated: CreativeSectionKey | null;
  output: CreativeOutput;
  generatedImages?: CreativeGeneratedImage[];
}

export interface CreativeMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface CreativeThread {
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

export interface CreativeHubClientState {
  clientId: string;
  setup: CreativeSetup | null;
  threads: CreativeThread[];
  updatedAt: string;
}

interface CreativeHubStore {
  clients: Record<string, CreativeHubClientState>;
}

interface PerformanceCreativeReference {
  name: string;
  score?: number;
  ctr?: number;
  cpl?: number;
  classification?: string;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_BASE)) fs.mkdirSync(DATA_BASE, { recursive: true });
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function readCreativeSop(): string {
  try {
    return fs.readFileSync(CREATIVE_SOP_FILE, "utf-8");
  } catch {
    return "";
  }
}

function readStore(): CreativeHubStore {
  ensureDataDir();
  if (!fs.existsSync(CREATIVE_HUB_FILE)) {
    return { clients: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(CREATIVE_HUB_FILE, "utf-8")) as CreativeHubStore;
  } catch {
    return { clients: {} };
  }
}

function writeStore(store: CreativeHubStore) {
  ensureDataDir();
  fs.writeFileSync(CREATIVE_HUB_FILE, JSON.stringify(store, null, 2));
}

function defaultClientState(clientId: string): CreativeHubClientState {
  return {
    clientId,
    setup: null,
    threads: [],
    updatedAt: new Date().toISOString(),
  };
}

export function getCreativeHubState(clientId: string): CreativeHubClientState {
  const store = readStore();
  return store.clients[clientId] || defaultClientState(clientId);
}

export function saveCreativeSetup(
  clientId: string,
  setup: Omit<CreativeSetup, "updatedAt">,
): CreativeHubClientState {
  const store = readStore();
  const existing = store.clients[clientId] || defaultClientState(clientId);
  const next: CreativeHubClientState = {
    ...existing,
    setup: {
      ...setup,
      updatedAt: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  };
  store.clients[clientId] = next;
  writeStore(store);
  return next;
}

function summarizeWinningReferences(references: PerformanceCreativeReference[]) {
  if (!references.length) return "No prior winners were supplied.";
  return references
    .slice(0, 4)
    .map((ref) => {
      const score = ref.score != null ? `score ${ref.score}` : null;
      const ctr = ref.ctr != null ? `CTR ${ref.ctr.toFixed(2)}%` : null;
      const cpl = ref.cpl != null ? `CPL ${Math.round(ref.cpl)}` : null;
      return [ref.name, score, ctr, cpl].filter(Boolean).join(" · ");
    })
    .join("\n");
}

function baseCreativeOutput(
  setup: CreativeSetup,
  input: CreativePromptInput,
  references: PerformanceCreativeReference[],
): CreativeOutput {
  const toneMap: Record<CreativeTone, string> = {
    luxury: "elevated, precise, status-forward",
    premium: "polished, aspirational, conversion-minded",
    affordable: "clear, high-intent, value-led",
  };

  const priceLine = setup.price ? `Priced from ${setup.price}` : input.offer || "High-intent value proposition";
  const assetHint = setup.renders.length > 0
    ? "Use the available renders as the hero visual with one focal architectural angle."
    : "Use a clean architectural or lifestyle-led hero shot with strong depth.";
  const refHint = references[0]?.name ? `Borrow the confidence and clarity from "${references[0].name}".` : "Keep the structure simple and performance-first.";
  const platformLabel = input.platform === "google_display" ? "Google Display" : "Meta";

  return {
    headline: input.hook || `${setup.projectName} built for decisive buyers`,
    subtext: `${setup.configuration || "Signature residences"} in ${setup.location || "a prime destination"} with ${setup.sqftRange || "smartly planned space"}. ${priceLine}.`,
    cta: input.platform === "google_display" ? "Download Brochure" : "Book a Site Visit",
    offerSection: input.offer || priceLine,
    visualDirection: `${toneMap[setup.tone]}. ${assetHint} ${refHint}`,
    primaryText: `${input.campaignIdea}. ${setup.customInstructions || "Keep the copy sharp and outcome-led."} Focus on ${setup.location || "location pull"}, ${setup.configuration || "configuration clarity"}, and an action-oriented finish.`,
    platformNotes: `${platformLabel}-first execution. Keep the scroll-stop opening direct, visually anchored, and built for high-intent action.`,
    copyVariations: {
      headlines: [
        input.hook || `${setup.projectName} for buyers who move fast`,
        `${setup.configuration || "Premium homes"} in ${setup.location || "a strategic location"}`,
        `${priceLine} at ${setup.projectName || "this project"}`,
      ],
      primaryTexts: [
        `${input.campaignIdea}. ${priceLine}. ${setup.location ? `Located in ${setup.location}.` : ""} ${setup.customInstructions || ""}`.trim(),
        `${setup.projectName} pairs ${setup.configuration || "smart layouts"} with ${setup.location || "strong location value"} for intent-ready prospects.`,
        `Lead with aspiration, back it with specifics: ${setup.sqftRange || "planned space"}, ${setup.buildingNumber ? `Tower ${setup.buildingNumber}` : "project credibility"}, and ${priceLine}.`,
      ],
      ctaOptions: ["Enquire Now", "Book a Site Visit", "Download Brochure"],
    },
    staticAdStructure: {
      topHook: input.hook || "Own the address before the market catches up",
      heroVisualSuggestion: assetHint,
      midMessaging: `${setup.configuration || "Residences"} · ${setup.sqftRange || "well-composed living"} · ${priceLine}`,
      ctaBlock: input.platform === "google_display" ? "Download brochure + contact prompt" : "Lead form CTA + urgency line",
    },
  };
}

function parseJsonFromResponse(text: string): any | null {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = fenced?.[1] || text;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function buildCreativeSopPrompt(): string {
  const sop = readCreativeSop().trim();
  if (!sop) {
    return "No external SOP file was available. Fall back to performance-first direct-response creative best practices.";
  }

  return `Treat the following SOP as persistent house rules for all creative output in this workspace. Follow it unless the user gives a stronger direct instruction for the current request.

${sop}`;
}

function mapRequestedSizeToOpenAiSize(size: CreativeGeneratedImage["requestedSize"]): CreativeGeneratedImage["modelSize"] {
  switch (size) {
    case "1080x1920":
    case "960x1200":
      return "1024x1536";
    case "1200x628":
      return "1536x1024";
    case "1080x1080":
    default:
      return "1024x1024";
  }
}

function buildImagePrompt({
  setup,
  input,
  output,
  requestedSize,
}: {
  setup: CreativeSetup;
  input: CreativePromptInput;
  output: CreativeOutput;
  requestedSize: CreativeGeneratedImage["requestedSize"];
}): string {
  return `Create a finished direct-response ad creative image for ${input.platform === "google_display" ? "Google Demand Gen" : "Meta Ads"}.

Use this SOP as the default creative memory:
${buildCreativeSopPrompt()}

Creative context:
- Project: ${setup.projectName}
- Price: ${setup.price || input.offer}
- Location: ${setup.location}
- Configuration: ${setup.configuration}
- Sqft Range: ${setup.sqftRange}
- Tone: ${setup.tone}
- Requested export label: ${requestedSize}
- Campaign idea: ${input.campaignIdea}
- Offer: ${input.offer}
- Hook: ${input.hook}
- Session instruction: ${input.customInstruction || "None"}

Use this generated creative output:
- Headline: ${output.headline}
- Subtext: ${output.subtext}
- Offer section: ${output.offerSection}
- Visual direction: ${output.visualDirection}
- Primary text intent: ${output.primaryText}
- Top hook: ${output.staticAdStructure.topHook}
- Hero visual suggestion: ${output.staticAdStructure.heroVisualSuggestion}
- Mid messaging: ${output.staticAdStructure.midMessaging}
- CTA block: ${output.staticAdStructure.ctaBlock}

Image rules:
- The output should look like a real high-performing social ad, not a plain poster mockup.
- Make the core offer obvious immediately.
- Use strong hierarchy for headline, offer, and CTA zones.
- Use bold contrast and mobile-first composition.
- Avoid arrows, mouse cursors, fake UI, and fake play buttons.
- Make it visually native to feed/story placements.
- Keep the image practical for performance marketing use.`;
}

function getCreativeAiConfig():
  | { provider: "openai"; apiKey: string; model: string; baseUrl: string }
  | { provider: "groq"; apiKey: string; model: string; baseUrl: string }
  | null {
  const openAiApiKey = getOpenAiApiKey();
  if (openAiApiKey) {
    return {
      provider: "openai",
      apiKey: openAiApiKey,
      model: getOpenAiModel(),
      baseUrl: OPENAI_BASE_URL,
    };
  }

  const groqApiKey = getGroqApiKey();
  if (groqApiKey) {
    return {
      provider: "groq",
      apiKey: groqApiKey,
      model: getGroqModel(),
      baseUrl: GROQ_BASE_URL,
    };
  }

  return null;
}

async function requestJsonChatCompletion({
  systemPrompt,
  userPrompt,
}: {
  systemPrompt: string;
  userPrompt: string;
}): Promise<any | null> {
  const aiConfig = getCreativeAiConfig();
  if (!aiConfig) return null;

  const response = await fetch(`${aiConfig.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${aiConfig.apiKey}`,
    },
    body: JSON.stringify({
      model: aiConfig.model,
      temperature: 0.7,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    return null;
  }

  const json = await response.json() as any;
  const content = json?.choices?.[0]?.message?.content;
  return content ? parseJsonFromResponse(content) : null;
}

async function requestCreativeImage({
  setup,
  input,
  output,
  requestedSize,
}: {
  setup: CreativeSetup;
  input: CreativePromptInput;
  output: CreativeOutput;
  requestedSize: CreativeGeneratedImage["requestedSize"];
}): Promise<CreativeGeneratedImage | null> {
  const openAiApiKey = getOpenAiApiKey();
  if (!openAiApiKey) return null;

  const modelSize = mapRequestedSizeToOpenAiSize(requestedSize);
  const prompt = buildImagePrompt({ setup, input, output, requestedSize });

  const response = await fetch(`${OPENAI_BASE_URL}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openAiApiKey}`,
    },
    body: JSON.stringify({
      model: getOpenAiImageModel(),
      prompt,
      size: modelSize,
      quality: "medium",
      output_format: "png",
      moderation: "auto",
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI image generation failed: ${errText}`);
  }

  const json = await response.json() as any;
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) return null;

  return {
    id: generateId(),
    prompt,
    requestedSize,
    modelSize,
    mimeType: "image/png",
    dataUrl: `data:image/png;base64,${b64}`,
    createdAt: new Date().toISOString(),
  };
}

async function requestCreativeFromModel({
  setup,
  input,
  references,
}: {
  setup: CreativeSetup;
  input: CreativePromptInput;
  references: PerformanceCreativeReference[];
}): Promise<CreativeOutput | null> {
  const systemPrompt = `You are Mojo Creative Studio, an expert direct-response creative strategist for performance marketers.
Return only valid JSON.

${buildCreativeSopPrompt()}

JSON schema:
{
  "headline": "string",
  "subtext": "string",
  "cta": "string",
  "offerSection": "string",
  "visualDirection": "string",
  "primaryText": "string",
  "platformNotes": "string",
  "copyVariations": {
    "headlines": ["string", "string", "string"],
    "primaryTexts": ["string", "string", "string"],
    "ctaOptions": ["string", "string", "string"]
  },
  "staticAdStructure": {
    "topHook": "string",
    "heroVisualSuggestion": "string",
    "midMessaging": "string",
    "ctaBlock": "string"
  }
}

Make it specific, high-intent, and built for ad performance.

Additional output rules:
- Build for the requested platform first.
- If platform is Meta, the thinking should prioritize mobile-native Feed, Reel, and Story behavior.
- Bake price, place, proof, core offer, CTA, and urgency into the output when the brief supports them.
- Prefer specific quantified proof over generic luxury language.
- Keep the creative direction practical enough for a designer/editor to execute.`;

  const userPrompt = `Client setup:
- Project Name: ${setup.projectName}
- Price: ${setup.price}
- RERA Number: ${setup.reraNumber}
- Building Number: ${setup.buildingNumber}
- Configuration: ${setup.configuration}
- Location: ${setup.location}
- Sqft Range: ${setup.sqftRange}
- Tone: ${setup.tone}
- Persistent Instructions: ${setup.customInstructions}
- Winning creative references:
${summarizeWinningReferences(references)}

Generation request:
- Campaign idea: ${input.campaignIdea}
- Offer: ${input.offer}
- Hook: ${input.hook}
- Platform: ${input.platform}
- Session instruction: ${input.customInstruction || "None"}

Build performance-focused creative output.`;

  const parsed = await requestJsonChatCompletion({ systemPrompt, userPrompt });
  if (!parsed) return null;

  return parsed as CreativeOutput;
}

async function requestSectionRegeneration({
  sectionKey,
  setup,
  input,
  currentOutput,
  references,
}: {
  sectionKey: CreativeSectionKey;
  setup: CreativeSetup;
  input: CreativePromptInput;
  currentOutput: CreativeOutput;
  references: PerformanceCreativeReference[];
}): Promise<string | null> {
  const systemPrompt = `You rewrite only one creative section. Return JSON: {"value":"updated text"}. Keep the rest of the creative implied and consistent.

${buildCreativeSopPrompt()}

Honor the SOP as the default creative memory for this workspace.`;

  const userPrompt = `Rewrite only "${sectionKey}" for this creative.
Project: ${setup.projectName}
Tone: ${setup.tone}
Instructions: ${setup.customInstructions}
Session instruction: ${input.customInstruction || "None"}
Campaign idea: ${input.campaignIdea}
Offer: ${input.offer}
Hook: ${input.hook}
Platform: ${input.platform}
Winning references:
${summarizeWinningReferences(references)}

Current creative:
${JSON.stringify(currentOutput, null, 2)}`;

  const parsed = await requestJsonChatCompletion({ systemPrompt, userPrompt });
  return typeof parsed?.value === "string" ? parsed.value : null;
}

function fallbackRegeneratedSection(
  sectionKey: CreativeSectionKey,
  base: CreativeOutput,
  input: CreativePromptInput,
  setup: CreativeSetup,
): string {
  switch (sectionKey) {
    case "headline":
      return `${input.hook || "Move first"} with ${setup.projectName}`;
    case "subtext":
      return `${setup.configuration || "Residences"} in ${setup.location || "the right location"} with ${input.offer || setup.price || "high-intent value"} and a sharper conversion angle.`;
    case "cta":
      return input.platform === "google_display" ? "Get the brochure now" : "Claim your priority callback";
    case "offerSection":
      return input.offer || `${setup.price ? `Starting at ${setup.price}` : "Limited-time value"} · ${setup.sqftRange || "smart layouts"} · ${setup.location || "prime location"}`;
    case "visualDirection":
      return `Keep the current layout system, but push a more ${setup.tone} visual tone with one clear hero image, tighter hierarchy, and a stronger offer highlight.`;
    default:
      return base[sectionKey];
  }
}

async function buildCreativeOutput(params: {
  setup: CreativeSetup;
  input: CreativePromptInput;
  references: PerformanceCreativeReference[];
}): Promise<CreativeOutput> {
  const modelOutput = await requestCreativeFromModel(params);
  return modelOutput || baseCreativeOutput(params.setup, params.input, params.references);
}

function threadUserMessage(input: CreativePromptInput) {
  return `Campaign idea: ${input.campaignIdea}
Offer: ${input.offer}
Hook: ${input.hook}
Platform: ${input.platform === "google_display" ? "Google Display" : "Meta"}
Custom instruction: ${input.customInstruction || "None"}`;
}

function assistantSummary(output: CreativeOutput) {
  return `Generated a new performance creative with "${output.headline}" as the lead hook and "${output.cta}" as the CTA. Visual direction: ${output.visualDirection}`;
}

export async function generateCreativeThread(params: {
  clientId: string;
  setup: CreativeSetup;
  input: CreativePromptInput;
  references: PerformanceCreativeReference[];
}): Promise<CreativeHubClientState> {
  const store = readStore();
  const existing = store.clients[params.clientId] || defaultClientState(params.clientId);
  const output = await buildCreativeOutput({
    setup: params.setup,
    input: params.input,
    references: params.references,
  });

  const versionId = generateId();
  const threadId = generateId();
  const now = new Date().toISOString();
  const version: CreativeVersion = {
    id: versionId,
    createdAt: now,
    sectionRegenerated: null,
    output,
    generatedImages: [],
  };
  const thread: CreativeThread = {
    id: threadId,
    title: params.input.campaignIdea || output.headline,
    createdAt: now,
    updatedAt: now,
    statusTag: "testing",
    input: params.input,
    activeVersionId: versionId,
    versions: [version],
    messages: [
      { id: generateId(), role: "user", content: threadUserMessage(params.input), createdAt: now },
      { id: generateId(), role: "assistant", content: assistantSummary(output), createdAt: now },
    ],
  };

  const next: CreativeHubClientState = {
    ...existing,
    setup: params.setup,
    threads: [thread, ...existing.threads],
    updatedAt: now,
  };
  store.clients[params.clientId] = next;
  writeStore(store);
  return next;
}

export async function regenerateCreativeSectionForThread(params: {
  clientId: string;
  threadId: string;
  sectionKey: CreativeSectionKey;
  references: PerformanceCreativeReference[];
}): Promise<CreativeHubClientState> {
  const store = readStore();
  const existing = store.clients[params.clientId] || defaultClientState(params.clientId);
  if (!existing.setup) throw new Error("Creative SOP setup is required before regenerating.");

  const threads = await Promise.all(existing.threads.map(async (thread) => {
    if (thread.id !== params.threadId) return thread;
    const activeVersion = thread.versions.find((version) => version.id === thread.activeVersionId) || thread.versions[0];
    if (!activeVersion) return thread;

    const regenerated = await requestSectionRegeneration({
      sectionKey: params.sectionKey,
      setup: existing.setup!,
      input: thread.input,
      currentOutput: activeVersion.output,
      references: params.references,
    });

    const nextOutput: CreativeOutput = {
      ...activeVersion.output,
      [params.sectionKey]: regenerated || fallbackRegeneratedSection(params.sectionKey, activeVersion.output, thread.input, existing.setup!),
    };

    const nextVersion: CreativeVersion = {
      id: generateId(),
      createdAt: new Date().toISOString(),
      sectionRegenerated: params.sectionKey,
      output: nextOutput,
      generatedImages: [],
    };

    const message: CreativeMessage = {
      id: generateId(),
      role: "assistant",
      content: `Regenerated the ${params.sectionKey} while preserving the rest of the creative system.`,
      createdAt: nextVersion.createdAt,
    };

    return {
      ...thread,
      activeVersionId: nextVersion.id,
      updatedAt: nextVersion.createdAt,
      versions: [nextVersion, ...thread.versions],
      messages: [...thread.messages, message],
    };
  }));

  const next: CreativeHubClientState = {
    ...existing,
    threads,
    updatedAt: new Date().toISOString(),
  };
  store.clients[params.clientId] = next;
  writeStore(store);
  return next;
}

export function updateCreativeThreadTag(params: {
  clientId: string;
  threadId: string;
  statusTag: CreativeStatusTag;
}): CreativeHubClientState {
  const store = readStore();
  const existing = store.clients[params.clientId] || defaultClientState(params.clientId);
  const threads = existing.threads.map((thread) =>
    thread.id === params.threadId
      ? { ...thread, statusTag: params.statusTag, updatedAt: new Date().toISOString() }
      : thread
  );
  const next = { ...existing, threads, updatedAt: new Date().toISOString() };
  store.clients[params.clientId] = next;
  writeStore(store);
  return next;
}

export function duplicateCreativeThread(params: {
  clientId: string;
  threadId: string;
}): CreativeHubClientState {
  const store = readStore();
  const existing = store.clients[params.clientId] || defaultClientState(params.clientId);
  const thread = existing.threads.find((item) => item.id === params.threadId);
  if (!thread) return existing;

  const now = new Date().toISOString();
  const duplicatedVersions = thread.versions.map((version) => ({
    ...version,
    id: generateId(),
    generatedImages: version.generatedImages?.map((image) => ({
      ...image,
      id: generateId(),
    })) || [],
  }));
  const duplicatedThread: CreativeThread = {
    ...thread,
    id: generateId(),
    title: `${thread.title} Copy`,
    createdAt: now,
    updatedAt: now,
    activeVersionId: duplicatedVersions[0]?.id || generateId(),
    versions: duplicatedVersions,
    messages: [
      ...thread.messages,
      {
        id: generateId(),
        role: "assistant",
        content: "Duplicated this creative so you can modify it without losing the original.",
        createdAt: now,
      },
    ],
  };

  const next = {
    ...existing,
    threads: [duplicatedThread, ...existing.threads],
    updatedAt: now,
  };
  store.clients[params.clientId] = next;
  writeStore(store);
  return next;
}

export async function generateCreativeImageForThread(params: {
  clientId: string;
  threadId: string;
  versionId?: string;
  requestedSize: CreativeGeneratedImage["requestedSize"];
}): Promise<CreativeHubClientState> {
  const store = readStore();
  const existing = store.clients[params.clientId] || defaultClientState(params.clientId);
  if (!existing.setup) throw new Error("Creative setup is required before generating images.");

  const threadIndex = existing.threads.findIndex((thread) => thread.id === params.threadId);
  if (threadIndex === -1) throw new Error("Creative thread not found.");

  const thread = existing.threads[threadIndex];
  const versionIndex = thread.versions.findIndex((version) => version.id === (params.versionId || thread.activeVersionId));
  const safeVersionIndex = versionIndex >= 0 ? versionIndex : 0;
  const version = thread.versions[safeVersionIndex];
  if (!version) throw new Error("Creative version not found.");

  const image = await requestCreativeImage({
    setup: existing.setup,
    input: thread.input,
    output: version.output,
    requestedSize: params.requestedSize,
  });

  if (!image) {
    throw new Error("Image generation is unavailable. Add OPENAI_API_KEY to enable it.");
  }

  const nextVersion: CreativeVersion = {
    ...version,
    generatedImages: [image, ...(version.generatedImages || [])],
  };

  const now = new Date().toISOString();
  const nextThread: CreativeThread = {
    ...thread,
    updatedAt: now,
    versions: thread.versions.map((item, index) => (index === safeVersionIndex ? nextVersion : item)),
    messages: [
      ...thread.messages,
      {
        id: generateId(),
        role: "assistant",
        content: `Generated a ${params.requestedSize} creative image for this version.`,
        createdAt: now,
      },
    ],
  };

  const next: CreativeHubClientState = {
    ...existing,
    threads: existing.threads.map((item, index) => (index === threadIndex ? nextThread : item)),
    updatedAt: now,
  };
  store.clients[params.clientId] = next;
  writeStore(store);
  return next;
}
