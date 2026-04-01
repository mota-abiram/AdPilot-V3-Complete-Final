/**
 * AI Command Engine — GPT-style natural language → structured action pipeline
 *
 * Flow:
 *   1. Receive natural language command from user
 *   2. Build context from active campaign analysis data
 *   3. Send to Perplexity API with rich system prompt
 *   4. Parse HUMAN RESPONSE + ACTION JSON from response
 *   5. Run safety checks on the action plan
 *   6. Execute actions via existing execution engines
 *   7. Log everything to learning-data.csv
 */

import fs from "fs";
import path from "path";
import { executeAction, type ExecutionRequest, type ExecutionActionType } from "./meta-execution";
import { executeGoogleAction, type GoogleExecutionRequest, type GoogleExecutionActionType } from "./google-execution";

// Groq — free tier covers ~14,400 req/day, no credit card needed.
// Get a free key at: https://console.groq.com
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";

function getOpenapiApiKey(): string {
  return process.env.OPENAPI_API_KEY || process.env.OPENAPI_KEY || "";
}

function getGeminiModel(): string {
  return process.env.GEMINI_MODEL || "gemini-1.5-flash";
}

function getGroqApiKey(): string {
  return process.env.GROQ_API_KEY || "";
}

function getGroqModel(): string {
  return process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
}

const DATA_BASE = path.resolve(import.meta.dirname, "../../ads_agent/data");
const LEARNING_CSV = path.join(DATA_BASE, "learning-data.csv");
const COOLDOWN_LOG = path.join(DATA_BASE, "ai_command_cooldown.json");

function isPlaceholderSecret(value?: string): boolean {
  return !value || value.trim() === "" || value.trim().startsWith("YOUR_");
}

function sanitizeClientCredentials(credentials: { meta?: any; google?: any }) {
  const next: { meta?: any; google?: any } = {};

  if (
    credentials.meta?.accessToken &&
    credentials.meta?.adAccountId &&
    !isPlaceholderSecret(credentials.meta.accessToken) &&
    !isPlaceholderSecret(credentials.meta.adAccountId)
  ) {
    next.meta = credentials.meta;
  }

  if (
    credentials.google?.clientId &&
    credentials.google?.clientSecret &&
    credentials.google?.refreshToken &&
    !isPlaceholderSecret(credentials.google.clientId) &&
    !isPlaceholderSecret(credentials.google.clientSecret) &&
    !isPlaceholderSecret(credentials.google.refreshToken)
  ) {
    next.google = credentials.google;
  }

  return next;
}

// ─── Types ────────────────────────────────────────────────────────

export interface AICommandRequest {
  command: string;
  clientId: string;
  platform: "meta" | "google" | "all";
  analysisData: any; // the full analysis JSON for context
  clientTargets?: { cpl?: number; budget?: number; leads?: number };
  provider?: "groq" | "gemini" | "auto";
}

export interface AICommandResponse {
  humanResponse: string;
  actionJson: ActionPlan | null;
  executionResults: ExecutionOutcome[];
  safetyWarnings: string[];
  requiresConfirmation: boolean;
}

interface ActionFilter {
  metric: string;
  operator: ">" | "<" | ">=" | "<=" | "==" | "!=";
  value: number;
  unit?: string;
}

interface ActionPlan {
  intent: string;
  platform: "meta" | "google" | "all";
  filters: ActionFilter[];
  action: {
    type: "pause" | "scale" | "adjust_budget" | "unpause" | "clarify";
    parameters: Record<string, any>;
  };
  execution_plan: string[];
  strategic_rationale: string;
  risk_checks: string[];
}

interface ExecutionOutcome {
  campaignId: string;
  campaignName: string;
  action: string;
  success: boolean;
  message: string;
  previousValue?: any;
  newValue?: any;
}

// ─── System Prompt ────────────────────────────────────────────────

function buildSystemPrompt(clientTargets: any): string {
  const targetCPL = clientTargets?.cpl || 800;
  const targetBudget = clientTargets?.budget || 0;

  return `You are Mojo, an expert AI performance marketing agent for AdPilot — a Meta Ads & Google Ads intelligence platform.

Your job is to interpret natural language commands from media buyers and convert them into precise, safe campaign actions.

## INTELLIGENCE RULES

Map vague language to precise metrics:
- "losers" / "bad campaigns" / "underperformers" → CPL > ${targetCPL} OR CTR < 1.0% OR CVR < 1.0% OR (spend > 500 AND leads == 0)
- "winners" / "good campaigns" / "top performers" → CPL < ${targetCPL * 0.8} AND conversions >= 3
- "spending money but no leads" → spend > 500 AND leads == 0
- "scale" → increase budget by 25% (default, range 20-30%)
- "pause" → set campaign status to PAUSED
- "high CPL" → CPL > ${targetCPL}
- "low CTR" → CTR < 1.0%
- Default time range → last 3 days

## PLATFORM RULES
- If user says "meta" or "facebook" → platform: "meta"
- If user says "google" → platform: "google"
- If platform unclear → use the currently active platform passed in context
- If no platform context → platform: "all"

## OUTPUT FORMAT — MANDATORY

You MUST respond in EXACTLY this format with no deviation:

### HUMAN RESPONSE
[Write a clear, friendly explanation like ChatGPT. Explain what you're about to do, why, and what to expect. 2-4 sentences.]

### ACTION JSON
\`\`\`json
{
  "intent": "brief description of the intent",
  "platform": "meta | google | all",
  "filters": [
    { "metric": "cpl", "operator": ">", "value": ${targetCPL}, "unit": "INR" }
  ],
  "action": {
    "type": "pause | scale | adjust_budget | unpause | clarify",
    "parameters": {
      "scale_percent": 25,
      "reason": "why this action is being taken"
    }
  },
  "execution_plan": [
    "Step 1: ...",
    "Step 2: ..."
  ],
  "strategic_rationale": "One sentence explaining the strategic reasoning.",
  "risk_checks": [
    "Check minimum 3 conversions before acting",
    "Skip campaigns in learning phase (< 50 impressions or < 3 days old)"
  ]
}
\`\`\`

## SAFETY RULES (always include in risk_checks)
1. Never act on campaigns with < 3 conversions (insufficient data)
2. Never act on campaigns in learning phase (< 50 impressions)
3. Never pause campaigns with active leads in the last 24 hours unless explicitly asked
4. For budget increases > 50%, require explicit user confirmation
5. Always add strategic_rationale explaining the business logic

## CLARIFICATION RULE
If the command is too ambiguous or dangerous, set action.type = "clarify" and ask a specific clarifying question in HUMAN RESPONSE.

## CAMPAIGN DATA CONTEXT
You will receive real campaign data. Use it to identify specific campaigns that match the filters. Reference campaign names in your HUMAN RESPONSE.`;
}

// ─── Campaign Filter Engine ───────────────────────────────────────

function getCampaignMetrics(campaign: any): Record<string, number> {
  // Normalise field names across Meta (campaign_audit) and Google (campaign_performance)
  const spend = campaign.spend || campaign.cost || campaign.amount_spent || 0;
  const leads = campaign.leads || campaign.conversions || campaign.results || 0;
  const impressions = campaign.impressions || 0;
  const clicks = campaign.clicks || 0;

  // Use pre-computed values from the analysis JSON if available (more accurate)
  const cpl = campaign.cpl ?? (leads > 0 ? spend / leads : spend > 0 ? 99999 : 0);
  const ctr = campaign.ctr ?? (impressions > 0 ? (clicks / impressions) * 100 : 0);
  const cvr = campaign.cvr ?? (clicks > 0 ? (leads / clicks) * 100 : 0);

  return { spend, leads, impressions, clicks, cpl, ctr, cvr };
}

function applyFilters(campaigns: any[], filters: ActionFilter[]): any[] {
  return campaigns.filter((campaign) => {
    const metrics = getCampaignMetrics(campaign);
    return filters.every((filter) => {
      const value = metrics[filter.metric.toLowerCase()];
      if (value === undefined) return false;
      switch (filter.operator) {
        case ">":  return value > filter.value;
        case "<":  return value < filter.value;
        case ">=": return value >= filter.value;
        case "<=": return value <= filter.value;
        case "==": return value === filter.value;
        case "!=": return value !== filter.value;
        default:   return false;
      }
    });
  });
}

// ─── Safety Checks ────────────────────────────────────────────────

interface SafetyResult {
  safe: boolean;
  warnings: string[];
  skippedCampaigns: string[];
  approvedCampaigns: any[];
}

function runSafetyChecks(campaigns: any[], actionType: string): SafetyResult {
  const warnings: string[] = [];
  const skippedCampaigns: string[] = [];
  const approvedCampaigns: any[] = [];

  // Load cooldown log
  let cooldownLog: Record<string, number> = {};
  if (fs.existsSync(COOLDOWN_LOG)) {
    try { cooldownLog = JSON.parse(fs.readFileSync(COOLDOWN_LOG, "utf-8")); } catch {}
  }
  const cooldownHours = 4;
  const now = Date.now();

  for (const campaign of campaigns) {
    const metrics = getCampaignMetrics(campaign);
    const campaignId = campaign.campaign_id || campaign.id || "";
    const name = campaign.campaign_name || campaign.name || campaignId;
    let skip = false;

    // Rule 1: minimum conversion data
    if (metrics.leads < 3 && actionType !== "pause") {
      warnings.push(`"${name}" has < 3 conversions — insufficient data for ${actionType}. Skipped.`);
      skippedCampaigns.push(name);
      skip = true;
    }

    // Rule 2: learning phase (very low impressions)
    if (metrics.impressions < 50 && !skip) {
      warnings.push(`"${name}" may be in learning phase (${metrics.impressions} impressions). Skipped.`);
      skippedCampaigns.push(name);
      skip = true;
    }

    // Rule 3: cooldown — no action on same campaign within cooldownHours
    if (!skip && cooldownLog[campaignId]) {
      const hoursSinceLastAction = (now - cooldownLog[campaignId]) / (1000 * 60 * 60);
      if (hoursSinceLastAction < cooldownHours) {
        warnings.push(`"${name}" was actioned ${hoursSinceLastAction.toFixed(1)}h ago — cooldown active. Skipped.`);
        skippedCampaigns.push(name);
        skip = true;
      }
    }

    if (!skip) approvedCampaigns.push(campaign);
  }

  return {
    safe: approvedCampaigns.length > 0,
    warnings,
    skippedCampaigns,
    approvedCampaigns,
  };
}

function updateCooldownLog(campaignIds: string[]) {
  let cooldownLog: Record<string, number> = {};
  if (fs.existsSync(COOLDOWN_LOG)) {
    try { cooldownLog = JSON.parse(fs.readFileSync(COOLDOWN_LOG, "utf-8")); } catch {}
  }
  const now = Date.now();
  for (const id of campaignIds) cooldownLog[id] = now;
  fs.writeFileSync(COOLDOWN_LOG, JSON.stringify(cooldownLog, null, 2));
}

// ─── Learning Logger ──────────────────────────────────────────────

function logToCSV(entry: {
  timestamp: string;
  clientId: string;
  platform: string;
  intent: string;
  command: string;
  rationale: string;
  campaignsActioned: number;
  action: string;
  safetyWarnings: string;
}) {
  const header = "timestamp,clientId,platform,intent,command,rationale,campaignsActioned,action,safetyWarnings\n";
  const row = [
    entry.timestamp,
    entry.clientId,
    entry.platform,
    `"${(entry.intent || "").replace(/"/g, "'")}"`,
    `"${(entry.command || "").replace(/"/g, "'")}"`,
    `"${(entry.rationale || "").replace(/"/g, "'")}"`,
    entry.campaignsActioned,
    entry.action,
    `"${(entry.safetyWarnings || "").replace(/"/g, "'")}"`,
  ].join(",") + "\n";

  if (!fs.existsSync(LEARNING_CSV)) fs.writeFileSync(LEARNING_CSV, header);
  fs.appendFileSync(LEARNING_CSV, row);
}

// ─── Claude Response Parser ───────────────────────────────────────

function parseClaudeResponse(rawText: string): { humanResponse: string; actionJson: ActionPlan | null } {
  let humanResponse = rawText;
  let actionJson: ActionPlan | null = null;

  try {
    // Extract HUMAN RESPONSE section
    const humanMatch = rawText.match(/###\s*HUMAN RESPONSE\s*\n([\s\S]*?)(?=###\s*ACTION JSON|$)/i);
    if (humanMatch) humanResponse = humanMatch[1].trim();

    // Extract JSON from code block
    const jsonMatch = rawText.match(/```json\s*([\s\S]*?)```/i);
    if (jsonMatch) {
      actionJson = JSON.parse(jsonMatch[1].trim());
    }
  } catch (e) {
    console.error("[AI Command] Failed to parse Claude response:", e);
  }

  return { humanResponse, actionJson };
}

// ─── Execution Router ─────────────────────────────────────────────

async function executeActionPlan(
  actionPlan: ActionPlan,
  campaigns: any[],
  clientId: string,
  credentials: { meta?: any; google?: any }
): Promise<ExecutionOutcome[]> {
  const outcomes: ExecutionOutcome[] = [];
  const { action } = actionPlan;

  if (action.type === "clarify") return outcomes;

  for (const campaign of campaigns) {
    const campaignId = campaign.campaign_id || campaign.id || "";
    const campaignName = campaign.campaign_name || campaign.name || campaignId;
    const executionPlatform = actionPlan.platform === "all"
      ? (campaign._sourcePlatform === "google" ? "google" : "meta")
      : actionPlan.platform;

    try {
      if (executionPlatform === "meta") {
        let metaAction: ExecutionActionType = "PAUSE_CAMPAIGN";
        const params: ExecutionRequest["params"] = {
          reason: action.parameters?.reason || actionPlan.strategic_rationale,
          scalePercent: action.parameters?.scale_percent,
        };

        if (action.type === "pause") metaAction = "PAUSE_CAMPAIGN";
        else if (action.type === "unpause") metaAction = "UNPAUSE_CAMPAIGN";
        else if (action.type === "scale") metaAction = "SCALE_BUDGET_UP";
        else if (action.type === "adjust_budget") {
          metaAction = action.parameters?.direction === "down" ? "SCALE_BUDGET_DOWN" : "SCALE_BUDGET_UP";
        }

        const req: ExecutionRequest = {
          action: metaAction,
          entityId: campaignId,
          entityName: campaignName,
          entityType: "campaign",
          params,
          requestedBy: "agent",
        };

        const previousMetaAccessToken = process.env.META_ACCESS_TOKEN;
        const previousMetaAdAccountId = process.env.META_AD_ACCOUNT_ID;

        try {
          if (credentials.meta?.accessToken) {
            process.env.META_ACCESS_TOKEN = credentials.meta.accessToken;
            process.env.META_AD_ACCOUNT_ID = credentials.meta.adAccountId;
          }

          const result = await executeAction(req);
          outcomes.push({
            campaignId,
            campaignName,
            action: metaAction,
            success: result.success,
            message: result.error || (result.success ? "Action completed" : "Action failed"),
            previousValue: result.previousValue,
            newValue: result.newValue,
          });
        } finally {
          if (previousMetaAccessToken === undefined) delete process.env.META_ACCESS_TOKEN;
          else process.env.META_ACCESS_TOKEN = previousMetaAccessToken;

          if (previousMetaAdAccountId === undefined) delete process.env.META_AD_ACCOUNT_ID;
          else process.env.META_AD_ACCOUNT_ID = previousMetaAdAccountId;
        }

      } else if (executionPlatform === "google") {
        let googleAction: GoogleExecutionActionType = "PAUSE_CAMPAIGN";
        const params: GoogleExecutionRequest["params"] = {
          reason: action.parameters?.reason || actionPlan.strategic_rationale,
          scalePercent: action.parameters?.scale_percent,
        };

        if (action.type === "pause") googleAction = "PAUSE_CAMPAIGN";
        else if (action.type === "unpause") googleAction = "ENABLE_CAMPAIGN";
        else if (action.type === "scale") googleAction = "SCALE_BUDGET_UP";
        else if (action.type === "adjust_budget") {
          googleAction = action.parameters?.direction === "down" ? "SCALE_BUDGET_DOWN" : "SCALE_BUDGET_UP";
        }

        const req: GoogleExecutionRequest = {
          action: googleAction,
          entityId: campaignId,
          entityName: campaignName,
          entityType: "campaign",
          params,
          requestedBy: "agent",
        };

        const previousGoogleEnv = {
          GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
          GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
          GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN,
          GOOGLE_DEVELOPER_TOKEN: process.env.GOOGLE_DEVELOPER_TOKEN,
          GOOGLE_MCC_ID: process.env.GOOGLE_MCC_ID,
          GOOGLE_CUSTOMER_ID: process.env.GOOGLE_CUSTOMER_ID,
        };

        try {
          if (credentials.google?.clientId) {
            process.env.GOOGLE_CLIENT_ID = credentials.google.clientId;
            process.env.GOOGLE_CLIENT_SECRET = credentials.google.clientSecret;
            process.env.GOOGLE_REFRESH_TOKEN = credentials.google.refreshToken;
            process.env.GOOGLE_DEVELOPER_TOKEN = credentials.google.developerToken;
            process.env.GOOGLE_MCC_ID = credentials.google.mccId;
            process.env.GOOGLE_CUSTOMER_ID = credentials.google.customerId;
          }

          const result = await executeGoogleAction(req);
          outcomes.push({
            campaignId,
            campaignName,
            action: googleAction,
            success: result.success,
            message: result.error || (result.success ? "Action completed" : "Action failed"),
            previousValue: result.previousValue,
            newValue: result.newValue,
          });
        } finally {
          for (const [key, value] of Object.entries(previousGoogleEnv)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
          }
        }
      }
    } catch (err: any) {
      outcomes.push({
        campaignId,
        campaignName,
        action: action.type,
        success: false,
        message: `Error: ${err.message}`,
      });
    }
  }

  return outcomes;
}

// ─── Main Handler ─────────────────────────────────────────────────

export async function handleAICommand(req: AICommandRequest): Promise<AICommandResponse> {
  const { command, clientId, platform, analysisData, clientTargets, provider = "auto" } = req;

  // Build campaign list from analysis data
  // Meta uses campaign_audit; Google uses campaign_performance; fallback to campaigns
  const campaigns: any[] = analysisData?.campaign_audit || analysisData?.campaign_performance || analysisData?.campaigns || [];

  // Build context summary for Perplexity
  const campaignSummary = campaigns.slice(0, 20).map((c: any) => {
    const m = getCampaignMetrics(c);
    return {
      id: c.campaign_id || c.id,
      name: c.campaign_name || c.name,
      platform: c._sourcePlatform || platform,
      status: c.status || c.effective_status || c.delivery_status,
      classification: c.classification || null,
      health_score: c.health_score || null,
      spend: `₹${Number(m.spend).toFixed(0)}`,
      leads: m.leads,
      cpl: m.cpl > 99990 ? "∞" : `₹${Number(m.cpl).toFixed(0)}`,
      ctr: `${Number(m.ctr).toFixed(2)}%`,
      impressions: m.impressions,
      daily_budget: c.daily_budget ? `₹${c.daily_budget}` : null,
      learning_status: c.learning_status || null,
    };
  });

  // Call Groq — OpenAI-compatible, free tier, very fast
  const systemPrompt = buildSystemPrompt(clientTargets);
  const userMessage = `
Platform: ${platform}
Client: ${clientId}
Target CPL: ₹${clientTargets?.cpl || 800}

Campaign Data (last analysis):
${JSON.stringify(campaignSummary, null, 2)}

User Command:
"${command}"

Analyse the campaigns and respond in the mandatory format.`;

  let rawResponse = "";
  try {
    let baseUrl = GROQ_BASE_URL;
    let apiKey = getGroqApiKey();
    let model = getGroqModel();

    if (provider === "gemini") {
      const untrimmedKey = getOpenapiApiKey();
      apiKey = untrimmedKey.trim();
      const isSk = apiKey.startsWith("sk-");
      console.log(`[Debug] AI Command: Detected ${isSk ? "OpenAI" : "Gemini"} key (begins with ${apiKey.slice(0, 10)})`);
      baseUrl = isSk ? "https://api.openai.com/v1" : GEMINI_BASE_URL;
      model = isSk ? "gpt-4o" : getGeminiModel();
    } else if (provider === "groq") {
      baseUrl = GROQ_BASE_URL;
      apiKey = getGroqApiKey().trim();
      model = getGroqModel();
    } else {
      const untrimmedKey = getOpenapiApiKey();
      apiKey = untrimmedKey.trim();
      if (apiKey) {
        const isSk = apiKey.startsWith("sk-");
        console.log(`[Debug] AI Command: Detected ${isSk ? "OpenAI" : "Gemini"} key (begins with ${apiKey.slice(0, 10)})`);
        baseUrl = isSk ? "https://api.openai.com/v1" : GEMINI_BASE_URL;
        model = isSk ? "gpt-4o" : getGeminiModel();
      } else {
        apiKey = getGroqApiKey().trim();
        baseUrl = GROQ_BASE_URL;
        model = getGroqModel();
      }
    }

    if (!apiKey) {
      throw new Error(
        provider === "groq"
          ? "No Groq API key found. Please check GROQ_API_KEY in the environment variables."
          : provider === "gemini"
          ? "No OpenAI API key found. Please check OPENAPI_API_KEY in the environment variables."
          : "No AI API key found (OpenAPI or Groq). Please check your environment variables.",
      );
    }

    const aiRes = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 1500,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      throw new Error(`AI API (${baseUrl}) ${aiRes.status}: ${errText}`);
    }

    const aiData = await aiRes.json() as any;
    rawResponse = aiData?.choices?.[0]?.message?.content || "";
  } catch (err: any) {
    console.error("[AI Command] AI error:", err.message);
    return {
      humanResponse: `AI service error: ${err.message}. Please check your OPENAPI_API_KEY or GROQ_API_KEY in the environment variables.`,
      actionJson: null,
      executionResults: [],
      safetyWarnings: [],
      requiresConfirmation: false,
    };
  }

  // Parse Ollama response
  const { humanResponse, actionJson } = parseClaudeResponse(rawResponse);

  if (!actionJson || actionJson.action.type === "clarify") {
    return {
      humanResponse,
      actionJson,
      executionResults: [],
      safetyWarnings: [],
      requiresConfirmation: false,
    };
  }

  // Apply filters to find matching campaigns
  let matchedCampaigns = campaigns;
  if (actionJson.filters && actionJson.filters.length > 0) {
    matchedCampaigns = applyFilters(campaigns, actionJson.filters);
  }

  if (matchedCampaigns.length === 0) {
    return {
      humanResponse: humanResponse + "\n\n⚠️ No campaigns matched the specified criteria. No actions were taken.",
      actionJson,
      executionResults: [],
      safetyWarnings: ["No campaigns matched the filters — nothing to execute."],
      requiresConfirmation: false,
    };
  }

  // Safety checks
  const safety = runSafetyChecks(matchedCampaigns, actionJson.action.type);
  const allWarnings = [...safety.warnings];

  // For scale > 50% — require confirmation
  const requiresConfirmation =
    actionJson.action.type === "scale" &&
    (actionJson.action.parameters?.scale_percent || 0) > 50;

  if (requiresConfirmation) {
    allWarnings.push(`Budget increase of ${actionJson.action.parameters?.scale_percent}% requires explicit confirmation.`);
    return {
      humanResponse: humanResponse + `\n\n⚠️ This action requires your confirmation because it involves a large budget change (${actionJson.action.parameters?.scale_percent}%). Please confirm to proceed.`,
      actionJson,
      executionResults: [],
      safetyWarnings: allWarnings,
      requiresConfirmation: true,
    };
  }

  if (!safety.safe) {
    return {
      humanResponse: humanResponse + "\n\n⚠️ All matched campaigns were blocked by safety checks. No actions taken.",
      actionJson,
      executionResults: [],
      safetyWarnings: allWarnings,
      requiresConfirmation: false,
    };
  }

  // Execute actions
  // Load credentials for this client
  let credentials: { meta?: any; google?: any } = {};
  const credFile = path.join(DATA_BASE, "clients_credentials.json");
  if (fs.existsSync(credFile)) {
    try {
      const allCreds: any[] = JSON.parse(fs.readFileSync(credFile, "utf-8"));
      const clientCreds = allCreds.find((c: any) => c.clientId === clientId);
      if (clientCreds) credentials = sanitizeClientCredentials(clientCreds);
    } catch {}
  }

  const executionResults = await executeActionPlan(
    actionJson,
    safety.approvedCampaigns,
    clientId,
    credentials
  );

  // Update cooldown log
  const actionedIds = safety.approvedCampaigns.map((c: any) => c.id || c.campaign_id || "").filter(Boolean);
  if (actionedIds.length > 0) updateCooldownLog(actionedIds);

  // Log to learning CSV
  logToCSV({
    timestamp: new Date().toISOString(),
    clientId,
    platform,
    intent: actionJson.intent,
    command,
    rationale: actionJson.strategic_rationale,
    campaignsActioned: executionResults.filter((r) => r.success).length,
    action: actionJson.action.type,
    safetyWarnings: allWarnings.join(" | "),
  });

  return {
    humanResponse,
    actionJson,
    executionResults,
    safetyWarnings: allWarnings,
    requiresConfirmation: false,
  };
}
