import { APIError } from "openai";

import { CHAT_MODEL, MODEL_SETUP_MESSAGE } from "@/lib/ai";
import { devOnly, isProduction } from "@/lib/setup";

/**
 * Explains the most common setup and service problems in plain words.
 * Status codes are OpenRouter's: https://openrouter.ai/docs/api-reference/errors
 *
 * Worded for whoever is reading (D60): locally, the developer, who is told which setting to
 * change; in production, a user, who can't change any of it. There the account's problems
 * (key, credit, model) all read as "unavailable"; the run's log keeps the real error.
 */
export function friendlyModelError(error: unknown, production: boolean = isProduction()) {
  const message = String((error as { message?: unknown })?.message ?? "");
  const pick = (dev: string, prod: string) => devOnly(dev, prod, production);

  // Refused before any call (D59). Matched on the message too: a background run's error
  // arrives as plain JSON. The detail names env vars, so it stays in the server log.
  if (message.startsWith("Model setup:")) return MODEL_SETUP_MESSAGE;

  // The free models' daily allowance, worth naming exactly: waiting a moment won't help.
  // (Production refuses free models, so this is a local message.)
  if (/free-models-per-day/i.test(message)) {
    return pick(
      "The free model's daily limit on OpenRouter is used up. It resets each day; to keep going " +
        "now, add credit at openrouter.ai/settings/credits.",
      MODEL_SETUP_MESSAGE,
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
        return pick(
          "OpenRouter rejected the request. The model may not support tool calling: check OPENROUTER_MODEL in .env.",
          "The AI couldn't handle this request. Please try again.",
        );
      case 401:
        return pick(
          "OpenRouter rejected the key. Check that OPENROUTER_API_KEY in .env is correct and still active.",
          MODEL_SETUP_MESSAGE,
        );
      case 402:
        // OpenRouter's own code for an empty balance: worth naming exactly, to the developer.
        return pick(
          "Your OpenRouter account is out of credits. Top up at openrouter.ai/credits and try again.",
          MODEL_SETUP_MESSAGE,
        );
      case 403:
        return "This request was blocked by the AI provider (often its content moderation).";
      case 404:
        return pick(
          `The model "${CHAT_MODEL}" isn't available on OpenRouter. Pick another id from openrouter.ai/models and set OPENROUTER_MODEL in .env.`,
          MODEL_SETUP_MESSAGE,
        );
      case 408:
        return "The model took too long to respond. Please try again.";
      case 429:
        return pick(
          "You've hit OpenRouter's rate limit. Please wait a moment and try again.",
          "The AI is busy right now. Please wait a moment and try again.",
        );
      case 502:
        return pick(
          `The provider behind "${CHAT_MODEL}" returned an error. Try again, or switch OPENROUTER_MODEL in .env.`,
          "The AI provider returned an error. Please try again.",
        );
      case 503:
        return pick(
          `No provider is currently available for "${CHAT_MODEL}". Try again shortly, or switch OPENROUTER_MODEL in .env.`,
          "The AI provider is unavailable right now. Please try again shortly.",
        );
      default:
        return `The AI provider returned an error (${status}). Please try again.`;
    }
  }
  return "Something went wrong while generating a reply. Please try again.";
}
