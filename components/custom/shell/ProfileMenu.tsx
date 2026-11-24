"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { useTheme } from "next-themes";
import {
  ChevronsUpDown,
  CircleHelp,
  CreditCard,
  LogOut,
  Monitor,
  Moon,
  Palette,
  Settings,
  Sun,
  User,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { ShellUser } from "./AppSidebar";

/** The user's initial in an indigo circle (`.ava`), 32px or 40px. */
export function UserInitial({ name, size = 32 }: { name: string; size?: 32 | 40 }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-brand-fill font-semibold text-white",
        size === 40 ? "size-10" : "size-8",
      )}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

const THEMES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

/** True once mounted in the browser, where next-themes knows the stored choice. */
const useMounted = () =>
  useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

/** Light / dark / system, as the segmented control in the menu (`.seg`). */
export function ThemeSwitch({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const current = mounted ? (theme ?? "system") : null;

  return (
    <div role="radiogroup" aria-label="Theme" className={cn("flex gap-1 rounded-md bg-muted p-1", className)}>
      {THEMES.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={current === value}
          aria-label={label}
          onClick={() => setTheme(value)}
          className={cn(
            "flex flex-1 cursor-pointer items-center justify-center rounded-sm px-3 py-1.5 font-medium text-muted-foreground",
            current === value && "bg-card text-foreground shadow-xs",
          )}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}

/** The profile button at the foot of the sidebar and the account menu it opens. */
export function ProfileMenu({ user, onNavigate }: { user: ShellUser; onNavigate?: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-slot="profile-trigger"
        className="mt-1 flex w-full cursor-pointer items-center gap-3 rounded-md p-2 text-left text-foreground hover:bg-muted aria-expanded:bg-muted"
      >
        <UserInitial name={user.name} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">{user.name}</span>
          <span className="text-caption font-medium text-muted-foreground">{user.plan} plan</span>
        </span>
        <ChevronsUpDown className="size-4 text-muted-foreground" />
      </DropdownMenuTrigger>

      <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-66">
        <div className="flex items-center gap-3 px-2 pt-2 pb-3">
          <UserInitial name={user.name} size={40} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-semibold">{user.name}</span>
            <span className="truncate text-body-s text-muted-foreground">{user.email}</span>
          </span>
        </div>
        <DropdownMenuSeparator className="mt-0 mb-1" />
        <DropdownMenuGroup>
          <DropdownMenuItem render={<Link href="/workspace/settings#profile" onClick={onNavigate} />}>
            <User />
            My profile
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link href="/workspace/settings" onClick={onNavigate} />}>
            <Settings />
            Settings
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link href="/workspace/usage" onClick={onNavigate} />}>
            <CreditCard />
            Usage &amp; billing
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <div className="flex items-center gap-3 px-3 py-1.5">
          <Palette className="size-[18px] text-muted-foreground" />
          <span className="flex-1 font-medium">Theme</span>
        </div>
        <ThemeSwitch className="mx-2 mb-1.5" />
        <DropdownMenuItem render={<Link href="/workspace/settings#help" onClick={onNavigate} />}>
          <CircleHelp />
          Help &amp; support
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => signOut({ callbackUrl: "/" })}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
