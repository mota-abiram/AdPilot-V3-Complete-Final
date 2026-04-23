import fs from "fs";
import path from "path";

const DATA_BASE = path.resolve(import.meta.dirname, "../../ads_agent/data");
const AI_CONFIG_FILE = path.join(DATA_BASE, "ai_config.json");

export interface AiConfig {
  openapiApiKey: string;
  anthropicApiKey: string;
  geminiModel: string;
  geminiImageModel: string;
  groqApiKey: string;
  groqModel: string;
}

export function readAiConfig(): AiConfig {
  const defaultConfig: AiConfig = {
    openapiApiKey: process.env.OPENAPI_API_KEY || process.env.OPENAPI_KEY || "",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
    geminiModel: process.env.GEMINI_MODEL || "gemini-1.5-flash",
    geminiImageModel: process.env.GEMINI_IMAGE_MODEL || "gemini-2.0-flash-preview-image-generation",
    groqApiKey: process.env.GROQ_API_KEY || "",
    groqModel: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
  };

  try {
    if (fs.existsSync(AI_CONFIG_FILE)) {
      const saved = JSON.parse(fs.readFileSync(AI_CONFIG_FILE, "utf-8"));
      // Merge with default to ensure all fields exist
      return { ...defaultConfig, ...saved };
    }
  } catch (err) {
    console.error("[AI Config] Failed to read config file:", err);
  }
  
  return defaultConfig;
}

export function saveAiConfig(config: Partial<AiConfig>) {
  try {
    const current = readAiConfig();
    const next = { ...current, ...config };
    
    const dir = path.dirname(AI_CONFIG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    fs.writeFileSync(AI_CONFIG_FILE, JSON.stringify(next, null, 2));
    return next;
  } catch (err) {
    console.error("[AI Config] Failed to save config file:", err);
    throw err;
  }
}
