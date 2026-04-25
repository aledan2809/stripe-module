import { AIRouter, getProjectPreset } from "ai-router";
import type { AIRequest, AIResponse } from "ai-router";

const preset = getProjectPreset("Stripe");

export const aiRouter = new AIRouter({
  ...preset,
  projectName: "Stripe",
});

/**
 * Unified AI call — routes through free providers first, falls back to Claude.
 * Usage: const res = await routeAI({ messages: [{ role: "user", content: "..." }] });
 */
export async function routeAI(request: AIRequest): Promise<AIResponse> {
  return aiRouter.chat(request);
}

export { aiRouter as router };
export type { AIRequest, AIResponse };
