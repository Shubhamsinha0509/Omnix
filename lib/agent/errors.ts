import { APIError } from "openai";

import { CHAT_MODEL } from "@/lib/ai";

/**
 * Explains the most common setup and service problems in plain words.
 * Status codes are OpenRouter's: https://openrouter.ai/docs/api-reference/errors
 */
export function friendlyModelError(error: unknown) {
  const message = String((error as { message?: unknown })?.message ?? "");

  // The free models' daily allowance, worth naming exactly: waiting a moment won't help.
  if (/free-models-per-day/i.test(message)) {
    return (
      "The free model's daily limit on OpenRouter is used up. It resets each day; to keep going " +
      "now, add credit at openrouter.ai/settings/credits."
    );
  }

  // In a background task the error has been through Inngest's step storage as plain JSON
  // and is no longer an APIError; its status survives at the start of the message
  // ("429 Rate limit exceeded…"), so read it from there.
  const status =
    error instanceof APIError
      ? error.status
      : typeof (error as { status?: unknown })?.status === "number"
        ? (error as { status: number }).status
        : Number(/^(\d{3})\b/.exec(message)?.[1]) || undefined;

  if (status !== undefined) {
    switch (status) {
      case 400:
        return "OpenRouter rejected the request. The model may not support tool calling — check CHAT_MODEL in lib/ai.ts.";
      case 401:
        return "OpenRouter rejected the key. Check that OPENROUTER_API_KEY in .env is correct and still active.";
      case 402:
        // OpenRouter's own code for an empty balance — worth naming exactly.
        return "Your OpenRouter account is out of credits. Top up at openrouter.ai/credits and try again.";
      case 403:
        return "This request was blocked by OpenRouter (often content moderation on the chosen model).";
      case 404:
        return `The model "${CHAT_MODEL}" isn't available on OpenRouter. Pick another id from openrouter.ai/models and set CHAT_MODEL in lib/ai.ts.`;
      case 408:
        return "The model took too long to respond. Please try again.";
      case 429:
        return "You've hit OpenRouter's rate limit. Please wait a moment and try again.";
      case 502:
        return `The provider behind "${CHAT_MODEL}" returned an error. Try again, or switch CHAT_MODEL in lib/ai.ts.`;
      case 503:
        return `No provider is currently available for "${CHAT_MODEL}". Try again shortly, or switch CHAT_MODEL in lib/ai.ts.`;
      default:
        return `OpenRouter returned an error (${status}). Please try again.`;
    }
  }
  return "Something went wrong while generating a reply. Please try again.";
}
