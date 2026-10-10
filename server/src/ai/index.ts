import type { AppConfig } from "../config.js";
import { ClaudeAi } from "./claude.js";
import { HeuristicAi } from "./heuristic.js";
import type { AiProvider } from "./types.js";

export * from "./types.js";

export function createAi(config: AppConfig): AiProvider {
  if (config.ai.mode === "claude") {
    return new ClaudeAi({ apiKey: config.ai.apiKey!, baseUrl: config.ai.baseUrl }, config.ai.model);
  }
  return new HeuristicAi();
}
