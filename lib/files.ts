import path from "node:path";
import { and, eq, lt } from "drizzle-orm";

import { db, sharedFiles } from "@/db";

/**
 * Files agents hand back from their VMs (`sandbox.share_file`), and the rules for serving
 * them. A file is only ever served to the user it belongs to (`/api/files/[id]`).
 */

export const FILE_LIMITS = {
  /** One file. Postgres can hold more, but anything bigger belongs in real storage. */
  maxBytes: 5 * 1024 * 1024,
  /** Files one run may share. */
  maxPerRun: 10,
};

const TYPES: Record<string, string> = {
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".html": "text/html",
  ".xml": "application/xml",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".zip": "application/zip",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".py": "text/x-python",
  ".sh": "text/x-shellscript",
};

export function mimeFor(name: string) {
  return TYPES[path.extname(name).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Images that are safe to show in the browser rather than download. SVG is left out on
 * purpose: it can carry script.
 */
export const INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** A file name safe for a download header: no path, no control or quote characters. */
export function safeName(raw: string) {
  const base = path.posix.basename(raw).replace(/[\u0000-\u001f"\\/]/g, "_").trim();
  return base.slice(0, 120) || "file";
}

export async function countRunFiles(runId: string) {
  const rows = await db.select({ id: sharedFiles.id }).from(sharedFiles).where(eq(sharedFiles.runId, runId));
  return rows.length;
}

/** One shared file, only if it belongs to this user. */
export async function getOwnedFile(userId: number, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db
    .select()
    .from(sharedFiles)
    .where(and(eq(sharedFiles.id, id), eq(sharedFiles.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** Deletes shared files older than `before`, for the nightly retention sweep (D43). */
export async function purgeSharedFilesBefore(before: Date) {
  const deleted = await db
    .delete(sharedFiles)
    .where(lt(sharedFiles.createdAt, before))
    .returning({ id: sharedFiles.id });
  return deleted.length;
}
