import { cn } from "@/lib/utils";

/**
 * Agent avatars: the four blob monsters from the design (public/avatars/blob-*.svg).
 *
 * An agent stores a short random seed (`agents.avatar_seed`); the seed picks the blob, so
 * the same agent always looks the same and existing seeds keep working. "Shuffle avatar"
 * asks for a seed that lands on a different blob than the current one.
 */
export const AVATAR_BLOBS = ["green", "peach", "purple", "teal"] as const;
export type AvatarBlob = (typeof AVATAR_BLOBS)[number];

/** Seeds are short letters/numbers/dashes — checked on the server before saving. */
export const AVATAR_SEED_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

/** Which blob a seed shows. A seed that names a blob ("teal", "teal-x1") shows that one. */
export function avatarBlob(seed: string): AvatarBlob {
  const named = AVATAR_BLOBS.find((blob) => seed === blob || seed.startsWith(`${blob}-`));
  if (named) return named;
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_BLOBS[hash % AVATAR_BLOBS.length];
}

export function agentAvatarUrl(seed: string) {
  return `/avatars/blob-${avatarBlob(seed)}.svg`;
}

/** A new seed for "Shuffle avatar": always a different blob from `current`, if given. */
export function randomAvatarSeed(current?: string) {
  const from = current ? avatarBlob(current) : null;
  const choices = AVATAR_BLOBS.filter((blob) => blob !== from);
  const blob = choices[Math.floor(Math.random() * choices.length)];
  return `${blob}-${crypto.randomUUID().slice(0, 6)}`;
}

export function AgentAvatar({
  seed,
  name,
  className,
}: {
  seed: string;
  name: string;
  className?: string;
}) {
  return (
    // A plain <img>: these are small static SVGs, which next/image wouldn't optimise anyway.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={agentAvatarUrl(seed)}
      alt={`${name} avatar`}
      draggable={false}
      className={cn("block size-full shrink-0 rounded-full", className)}
    />
  );
}
