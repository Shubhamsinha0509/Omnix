/**
 * Sending email *as Omnix* — the "email me the result" delivery channel.
 *
 * Not to be confused with `gmail.send`, which sends as the **user**, from their own
 * mailbox, through a connection they authorised. This is Omnix writing to its own user,
 * so it needs no connection and no approval — and it must never be reachable as a tool,
 * or an agent would have a way to email anybody without a card being shown.
 *
 * Resend over HTTPS, with no SDK (decision D44): one POST is the whole integration.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

/** True when email delivery is configured. Without it, tasks fall back to in-app only. */
export function hasEmailProvider() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export type SendEmailResult = { ok: true; id: string } | { ok: false; error: string };

export async function sendEmail(input: {
  to: string;
  subject: string;
  /** Plain text. The HTML part is generated from it, so nothing has to be escaped twice. */
  text: string;
}): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    return { ok: false, error: "Email isn't configured: set RESEND_API_KEY and EMAIL_FROM in .env." };
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        html: asHtml(input.text),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      // Resend answers with a JSON message; the status alone doesn't say what was wrong.
      const detail = await response.text().catch(() => "");
      return { ok: false, error: `Resend refused the email (${response.status}): ${detail.slice(0, 300)}` };
    }

    const body = (await response.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, id: body?.id ?? "" };
  } catch (error) {
    return { ok: false, error: `Couldn't reach the email provider: ${(error as Error)?.message ?? "unknown error"}` };
  }
}

/**
 * The text as simple HTML: paragraphs and line breaks, nothing else.
 *
 * The body is an agent's reply, which may quote a web page or an email, so every
 * character is escaped and no markup from the content survives. An agent that reads a
 * page saying `<img src=x onerror=…>` must not get to put that in the user's inbox.
 */
function asHtml(text: string) {
  const paragraphs = escapeHtml(text)
    .split(/\n{2,}/)
    .map((block) => `<p style="margin:0 0 12px">${block.replace(/\n/g, "<br />")}</p>`)
    .join("");

  return `<div style="font:14px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#18181b;max-width:640px">${paragraphs}</div>`;
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
