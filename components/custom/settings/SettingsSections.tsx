"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { Bell, CreditCard, KeyRound, Loader2, Monitor, Moon, Palette, Plus, Sun, Trash2, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { ComingSoonButton } from "@/components/custom/design/ComingSoonButton";
import { setReduceMotion } from "@/components/theme-provider";
import { signOut } from "next-auth/react";
import { deleteAccount, updateProfile } from "@/app/workspace/settings/actions";
import { MOCK_API_KEYS, MOCK_NOTIFICATION_PREFS } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

const card = "flex scroll-mt-6 flex-col rounded-lg border bg-card p-6 shadow-sm";

const SECTIONS = [
  { id: "profile", label: "Profile", icon: User },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "api-keys", label: "API keys", icon: KeyRound },
  { id: "billing", label: "Billing", icon: CreditCard },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "delete-account", label: "Delete account", icon: Trash2 },
] as const;

/** The settings menu (`nav` in 18-settings); Billing lives on its own page. */
export function SettingsNav() {
  const [active, setActive] = useState<string>("profile");
  return (
    <nav aria-label="Settings" className="flex shrink-0 flex-col gap-0.5 md:w-[200px]">
      {SECTIONS.map(({ id, label, icon: Icon }) => (
        <Link
          key={id}
          href={id === "billing" ? "/workspace/usage" : `#${id}`}
          onClick={() => id !== "billing" && setActive(id)}
          aria-current={active === id ? "true" : undefined}
          className={cn(
            "flex h-10 items-center gap-3 rounded-md px-3 font-medium text-foreground no-underline hover:bg-muted [&>svg]:size-4 [&>svg]:text-muted-foreground",
            active === id && "bg-accent font-semibold text-accent-foreground hover:bg-accent [&>svg]:text-brand",
          )}
        >
          <Icon />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}

const useMounted = () =>
  useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

/**
 * Delete account: everything goes — agents, chats, tasks, runs, files, VMs — and connected
 * accounts are disconnected at Google, Notion and Jira (lib/account.ts). Typing the email
 * is the confirmation, because this can't be undone. The browser signs out afterwards.
 */
export function DeleteAccountSection({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deleting, startDeleting] = useTransition();
  const matches = typed.trim().toLowerCase() === email.toLowerCase();

  const remove = () => {
    setError(null);
    startDeleting(async () => {
      const result = await deleteAccount({ confirmEmail: typed });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      // The session is a cookie the server can't revoke; ending it here is what signs out.
      await signOut({ callbackUrl: "/" });
    });
  };

  return (
    <section id="delete-account" className={cn(card, "gap-3 border-destructive")}>
      <h2 className="text-h2 font-semibold text-destructive">Delete account</h2>
      <p className="text-muted-foreground">
        Permanently deletes your agents, chats, tasks, run history, shared files and their virtual machines, and
        disconnects Gmail, Notion and Jira. This can&apos;t be undone.
      </p>
      {!open ? (
        <Button type="button" variant="destructive" size="sm" className="self-start" onClick={() => setOpen(true)}>
          <Trash2 />
          Delete my account
        </Button>
      ) : (
        <div className="flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4">
          <label htmlFor="confirm-email" className="text-body-s">
            Type <span className="font-semibold">{email}</span> to confirm.
          </label>
          <Input
            id="confirm-email"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={deleting}
            aria-invalid={Boolean(error)}
          />
          {error && (
            <p role="alert" className="text-body-s text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" disabled={deleting} onClick={() => { setOpen(false); setTyped(""); setError(null); }}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" size="sm" disabled={!matches || deleting} onClick={remove}>
              {deleting && <Loader2 className="animate-spin" />}
              {deleting ? "Deleting everything…" : "Delete my account forever"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Profile: name (saved), email, timezone. */
export function ProfileSection({ name, email }: { name: string; email: string }) {
  const [value, setValue] = useState(name);
  const [isSaving, startSaving] = useTransition();
  const mounted = useMounted();
  const timezone = mounted ? Intl.DateTimeFormat().resolvedOptions().timeZone : "";

  const save = () =>
    startSaving(async () => {
      const result = await updateProfile({ name: value });
      if ("error" in result) toast.add({ title: result.error, type: "error" });
      else toast.add({ title: "Profile saved", type: "success" });
    });

  return (
    <section id="profile" className={cn(card, "gap-5")}>
      <div className="flex items-center">
        <h2 className="flex-1 text-h2 font-semibold">Profile</h2>
        <Button variant="outline" size="sm" onClick={save} disabled={isSaving || !value.trim() || value.trim() === name}>
          {isSaving && <Loader2 className="animate-spin" />}
          Save
        </Button>
      </div>
      <div className="flex items-center gap-4">
        <span
          aria-hidden="true"
          className="flex size-14 items-center justify-center rounded-full bg-brand-fill text-[22px] font-semibold text-white"
        >
          {(value.trim() || name).charAt(0).toUpperCase()}
        </span>
        {/* TODO(backend): profile photos (the sign-in provider's image is stored, not shown). */}
        <ComingSoonButton variant="outline" size="sm" message="Changing your photo is coming soon">
          Change photo
        </ComingSoonButton>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="font-medium">Name</span>
          <Input value={value} maxLength={80} onChange={(event) => setValue(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-medium">Email</span>
          <Input value={email} readOnly className="text-muted-foreground" title="Your sign-in email" />
        </label>
      </div>
      <label className="flex flex-col gap-1.5 md:max-w-[50%]">
        <span className="font-medium">Timezone</span>
        {/* TODO(backend): a saved timezone. Chats and schedules use the browser's today. */}
        <Input value={timezone} readOnly title="Taken from this browser" />
      </label>
    </section>
  );
}

/** Appearance: theme cards (real) and reduce motion (this browser). */
export function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const current = mounted ? (theme ?? "system") : null;
  // What the page loaded with (the class the theme provider applied), until changed here.
  const stored = useSyncExternalStore(
    () => () => {},
    () => document.documentElement.classList.contains("reduce-motion"),
    () => false,
  );
  const [override, setOverride] = useState<boolean | null>(null);
  const reduce = override ?? stored;
  const setReduce = (on: boolean) => setOverride(on);

  const options = [
    { value: "light", label: "Light", icon: Sun, swatch: "#F7F8FC" },
    { value: "dark", label: "Dark", icon: Moon, swatch: "#14162A" },
    { value: "system", label: "System", icon: Monitor, swatch: "linear-gradient(90deg,#F7F8FC 50%,#14162A 50%)" },
  ];

  return (
    <section id="appearance" className={cn(card, "gap-4")}>
      <h2 className="text-h2 font-semibold">Appearance</h2>
      <div role="radiogroup" aria-label="Theme" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {options.map(({ value, label, icon: Icon, swatch }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={current === value}
            onClick={() => setTheme(value)}
            className={cn(
              "flex cursor-pointer flex-col gap-2.5 rounded-lg border bg-card p-3 text-left",
              current === value && "border-brand shadow-[0_0_0_1px_var(--brand)]",
            )}
          >
            <span className="h-16 rounded-[10px] border" style={{ background: swatch }} />
            <span className="flex items-center gap-2 text-body-s font-medium">
              <Icon className="size-3.5" />
              {label}
            </span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <span className="flex flex-1 flex-col">
          <span className="font-medium">Reduce motion</span>
          <span className="text-body-s text-muted-foreground">Turns off springs and the run spinner.</span>
        </span>
        <Switch
          checked={reduce}
          onCheckedChange={(checked) => {
            setReduce(Boolean(checked));
            setReduceMotion(Boolean(checked));
          }}
          aria-label="Reduce motion"
        />
      </div>
    </section>
  );
}

/** API keys: designed, not built (MOCK_API_KEYS). */
export function ApiKeysSection() {
  return (
    <section id="api-keys" className={cn(card, "gap-4")}>
      <div className="flex items-center gap-3">
        <div className="flex flex-1 flex-col">
          <h2 className="text-h2 font-semibold">API keys</h2>
          <p className="text-body-s text-muted-foreground">
            Use a key to run agents from your own code. Keep it secret.
          </p>
        </div>
        <ComingSoonButton size="sm" message="API keys are coming soon">
          <Plus className="size-3.5" />
          Create key
        </ComingSoonButton>
      </div>
      <div className="divide-y rounded-lg border bg-card">
        {MOCK_API_KEYS.length === 0 ? (
          <div className="flex min-h-[52px] items-center gap-3 px-4 py-3 text-muted-foreground">
            <KeyRound className="size-4" />
            <span className="flex-1 text-body-s">No API keys yet.</span>
          </div>
        ) : (
          MOCK_API_KEYS.map((key) => (
            <div key={key.id} className="flex min-h-[52px] items-center gap-3 px-4 py-3">
              <KeyRound className="size-4 text-muted-foreground" />
              <span className="flex flex-1 flex-col">
                <span className="font-medium">{key.name}</span>
                <span className="font-mono text-caption text-muted-foreground">{key.preview}</span>
              </span>
              <span className="hidden text-body-s text-muted-foreground md:inline">
                Created {key.createdAt}
                {key.lastUsed ? ` · used ${key.lastUsed}` : ""}
              </span>
              <Button variant="ghost" size="icon" aria-label="Delete key" disabled>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

/** Notifications: designed, not built (MOCK_NOTIFICATION_PREFS). */
export function NotificationsSection() {
  return (
    <section id="notifications" className={cn(card, "gap-1")}>
      <h2 className="pb-2 text-h2 font-semibold">Notifications</h2>
      {MOCK_NOTIFICATION_PREFS.map((pref) => (
        <div key={pref.key} className="flex items-center gap-3 py-2.5">
          <span className="flex flex-1 flex-col">
            <span className="font-medium">{pref.title}</span>
            <span className="text-body-s text-muted-foreground">{pref.note}</span>
          </span>
          <Switch checked={pref.on} disabled aria-label={`${pref.title} (coming soon)`} />
        </div>
      ))}
    </section>
  );
}
