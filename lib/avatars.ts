/**
 * Avatar seeds and URLs, usable on the server and in the browser. The <AgentAvatar>
 * component (components/custom/workspace/AgentAvatar.tsx) draws them.
 *
 * Avatars are DiceBear's animated "clay" characters on the design's four pastel circles
 * (the colours of design/assets/avatars/blob-*.svg). The same seed always gives the same
 * character.
 */

/** The four pastel backgrounds from the design. */
const BACKGROUNDS = ["e5eedc", "f6e3da", "ece4f6", "ddeeea"];

/** Seeds are short letters/numbers/dashes — checked on the server before saving. */
export const AVATAR_SEED_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

/** One of the pastels, always the same for a seed. (The clay style accepts one colour only.) */
function backgroundFor(seed: string) {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return BACKGROUNDS[hash % BACKGROUNDS.length];
}

export function agentAvatarUrl(seed: string, { animated = true }: { animated?: boolean } = {}) {
  const params = new URLSearchParams({ seed, backgroundColor: backgroundFor(seed) });
  if (animated) params.set("tags", "animation");
  return `https://api.dicebear.com/10.x/clay/svg?${params}`;
}

/** A new random seed, used by "Shuffle avatar". Always different from `current`. */
export function randomAvatarSeed(current?: string) {
  let seed = crypto.randomUUID().slice(0, 8);
  while (seed === current) seed = crypto.randomUUID().slice(0, 8);
  return seed;
}
