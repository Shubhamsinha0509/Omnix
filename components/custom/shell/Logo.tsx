import Image from "next/image";
import Link from "next/link";

/**
 * The Omnix mark and wordmark. The design ships a placeholder mark
 * (design/assets/logo-mark.svg); this uses the production logo, the ringed ghost in
 * /public/logo.svg (also the favicon, app/icon.svg).
 */
export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link
      href={href}
      aria-label="Omnix home"
      className="flex items-center gap-2.5 rounded-md text-foreground no-underline"
    >
      <Image src="/logo.svg" alt="" width={32} height={32} className="size-8" loading="eager" />
      <span className="text-h2 font-semibold tracking-[-0.005em]">Omnix</span>
    </Link>
  );
}
