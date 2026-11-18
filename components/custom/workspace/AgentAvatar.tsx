/** DiceBear "clay" avatar for an agent. The same seed always gives the same avatar. */
export function agentAvatarUrl(seed: string) {
  return `https://api.dicebear.com/10.x/clay/svg?tags=animation&seed=${encodeURIComponent(seed)}`;
}

/** A new random seed, used by "Shuffle avatar". */
export function randomAvatarSeed() {
  return crypto.randomUUID().slice(0, 8);
}

/** Seeds are short letters/numbers/dashes — checked on the server before saving. */
export const AVATAR_SEED_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

export function AgentAvatar({
  seed,
  name,
  className = "",
}: {
  seed: string;
  name: string;
  className?: string;
}) {
  return (
    // A plain <img> is used on purpose: DiceBear returns SVG, which next/image won't optimise.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={agentAvatarUrl(seed)}
      alt={`${name} avatar`}
      draggable={false}
      className={`size-full rounded-full bg-muted object-cover ${className}`}
    />
  );
}
