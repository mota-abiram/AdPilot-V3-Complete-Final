/**
 * AI Provider — Mojo AdCortex LLM Layer
 *
 * Switchable provider (OpenAI preferred) that provides:
 *  - Model routing ("opus" -> gpt-4o, "sonnet" -> gpt-4o-mini)
 *  - Token tracking and cost estimation
 *  - Clean typed response interface
 */

// --- Types ────────────────────────────────────────────────────────

export type AiModelTier = "opus" | "sonnet";

export interface AiRequest {
  systemPrompt: string;
  userMessage: string;
  modelTier: AiModelTier;
  maxTokens?: number;
  temperature?: number;
}

export interface AiResponse {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costEstimate: number;
}

// --- Model Configuration ──────────────────────────────────────────

const MODEL_MAP: Record<AiModelTier, string> = {
  opus: "gpt-4o",
  sonnet: "gpt-4o-mini",
};

const DEFAULT_MAX_TOKENS: Record<AiModelTier, number> = {
  opus: 4096,
  sonnet: 4096,
};

// Pricing per 1M tokens (USD)
const PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.50, output: 10.00 },
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
};

const DEFAULT_TEMPERATURE = 0.3;

// --- Helpers ──────────────────────────────────────────────────────

import { readAiConfig } from "./ai-config-loader";

function getOpenaiApiKey(): string {
  const config = readAiConfig();
  return config.openapiApiKey || process.env.OPENAPI_API_KEY || process.env.OPENAPI_KEY || "";
}

function isPlaceholderSecret(value?: string): boolean {
  return !value || value.trim() === "" || value.trim().startsWith("YOUR_");
}

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = PRICING[model];
  if (!pricing) return 0;
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}

// --- Main API ─────────────────────────────────────────────────────

/**
 * Call OpenAI (GPT-4o) with retry-once on transient failures.
 * Throws if no API key is configured.
 */
export async function callAi(request: AiRequest): Promise<AiResponse> {
  const apiKey = getOpenaiApiKey().trim();
  if (!apiKey || isPlaceholderSecret(apiKey)) {
    throw new Error(
      "Missing OPENAPI_API_KEY. Please set this in your Render Environment Variables or .env file to enable AI-powered insights."
    );
  }

  const model = MODEL_MAP[request.modelTier];
  const maxTokens = request.maxTokens ?? DEFAULT_MAX_TOKENS[request.modelTier];
  const temperature = request.temperature ?? DEFAULT_TEMPERATURE;

  const makeRequest = async () => {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.userMessage },
        ],
        max_tokens: maxTokens,
        temperature,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI API failed (${response.status}): ${errText}`);
    }

    const data = await response.json() as any;
    const content = data.choices[0].message.content || "";
    const inputTokens = data.usage?.prompt_tokens ?? 0;
    const outputTokens = data.usage?.completion_tokens ?? 0;

    return {
      content,
      model,
      inputTokens,
      outputTokens,
      costEstimate: estimateCost(model, inputTokens, outputTokens),
    };
  };

  // Attempt with single retry on transient errors
  try {
    return await makeRequest();
  } catch (err: any) {
    const isTransient =
      err?.message?.includes("429") ||
      err?.message?.includes("500") ||
      err?.message?.includes("503") ||
      err?.message?.includes("ECONNRESET") ||
      err?.message?.includes("ETIMEDOUT");

    if (isTransient) {
      console.warn(`[AI Provider] Transient error, retrying once in 2s...`);
      await new Promise((r) => setTimeout(r, 2000));
      return await makeRequest();
    }

    throw err;
  }
}

/**
 * Backward compatibility alias
 */
export const callClaude = callAi;

/**
 * Quick health check — verifies the API key is valid without making a full call.
 */
export function isAiAvailable(): boolean {
  const apiKey = getOpenaiApiKey().trim();
  return !!apiKey && !isPlaceholderSecret(apiKey);
}

export const isClaudeAvailable = isAiAvailable;
