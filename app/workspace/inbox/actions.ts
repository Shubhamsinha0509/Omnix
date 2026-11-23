"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth";
import { markAllRead, markRead } from "@/lib/notifications";

/** Reading the inbox is the one thing a user does to it; both actions are scoped to them. */

export type InboxActionResult = { error: string } | { ok: true };

export async function markNotificationRead(notificationId: string): Promise<InboxActionResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "You need to be signed in." };

  await markRead(user.id, notificationId);
  revalidate();
  return { ok: true };
}

export async function markEverythingRead(): Promise<InboxActionResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "You need to be signed in." };

  await markAllRead(user.id);
  revalidate();
  return { ok: true };
}

function revalidate() {
  revalidatePath("/workspace/inbox");
  // The sidebar's unread count lives in the workspace layout.
  revalidatePath("/workspace", "layout");
}
