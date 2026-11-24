/**
 * Links to files agents shared (`sandbox.share_file`). Kept apart from lib/files.ts, which
 * touches the database, so the chat's Markdown renderer can use it in the browser.
 */

/** The download address of a shared file, as it appears in replies (relative to the app). */
export const fileHref = (id: string) => `/api/files/${id}`;

/** True for an href made by `fileHref`, so the chat can draw it as a file, not a link. */
export const isFileHref = (href: string | undefined) =>
  Boolean(href && /^\/api\/files\/[0-9a-f-]{36}$/i.test(href));
