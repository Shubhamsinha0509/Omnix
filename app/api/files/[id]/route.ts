import { getCurrentUser } from "@/lib/auth";
import { INLINE_TYPES, getOwnedFile } from "@/lib/files";

/**
 * GET /api/files/:id — a file an agent shared from its VM (`sandbox.share_file`).
 *
 * Only for the user it belongs to: anyone else, signed in or not, gets the same 404, so
 * the response doesn't even say whether the id exists.
 *
 * The content was made by code in a VM, so it is served defensively: downloaded, never
 * shown, unless it is a plain image; never sniffed into another type; and sandboxed by
 * CSP in case a browser renders it anyway (an .html or .svg file can carry script).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const user = await getCurrentUser();
  const file = user ? await getOwnedFile(user.id, id) : null;
  if (!file) return new Response("Not found", { status: 404 });

  const inline = INLINE_TYPES.has(file.mimeType);
  // RFC 6266: an ASCII fallback plus the real name, UTF-8 encoded.
  const ascii = file.name.replace(/[^\x20-\x7e]/g, "_");
  const disposition = `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.name)}`;

  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.size),
      "Content-Disposition": disposition,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'",
      "Cache-Control": "private, no-store",
    },
  });
}
