"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { db, users } from "@/db";
import { deleteAccountData } from "@/lib/account";
import { getCurrentUser } from "@/lib/auth";

const MAX_NAME = 80;

/** Saves the signed-in user's display name (Settings → Profile). */
export async function updateProfile(input: { name: string }): Promise<{ error: string } | { ok: true }> {
  const user = await getCurrentUser();
  if (!user) return { error: "You need to be signed in." };

  const name = input.name?.trim() ?? "";
  if (!name) return { error: "Please enter your name." };
  if (name.length > MAX_NAME) return { error: `Your name must be ${MAX_NAME} characters or fewer.` };

  try {
    await db.update(users).set({ name }).where(eq(users.id, user.id));
  } catch (error) {
    console.error("Failed to save the profile:", error);
    return { error: "Couldn't save that. Please try again." };
  }

  // The name shows in the sidebar and the greeting.
  revalidatePath("/workspace", "layout");
  return { ok: true };
}

/**
 * Deletes the signed-in user's account and everything in it (lib/account.ts). The user
 * types their email to confirm; the browser signs out afterwards.
 */
export async function deleteAccount(input: { confirmEmail: string }): Promise<{ error: string } | { ok: true }> {
  const user = await getCurrentUser();
  if (!user) return { error: "You need to be signed in." };

  if (input.confirmEmail?.trim().toLowerCase() !== user.email.toLowerCase()) {
    return { error: "Type your email address exactly as shown to confirm." };
  }

  try {
    const result = await deleteAccountData(user.id);
    if (!result.deleted) return { error: "Couldn't delete your account. Please try again." };
  } catch (error) {
    console.error("Account deletion failed:", error);
    return { error: "Couldn't delete your account. Please try again." };
  }
  return { ok: true };
}
