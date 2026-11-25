import { PageWrap } from "@/components/custom/design/HeroWash";
import {
  ApiKeysSection,
  AppearanceSection,
  DeleteAccountSection,
  NotificationsSection,
  ProfileSection,
  SettingsNav,
} from "@/components/custom/settings/SettingsSections";
import { getCurrentUser } from "@/lib/auth";

/** Settings (design/reference/18-settings.html). */
export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  return (
    <PageWrap>
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-h1 font-semibold tracking-[-0.015em]">Settings</h1>
        <p className="text-muted-foreground">Manage your profile and how Omnix works for you.</p>
      </div>
      <div className="flex flex-col items-stretch gap-8 md:flex-row md:items-start">
        <SettingsNav />
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <ProfileSection name={user.name ?? ""} email={user.email} />
          <AppearanceSection />
          <ApiKeysSection />
          <NotificationsSection />
          <DeleteAccountSection email={user.email} />
        </div>
      </div>
    </PageWrap>
  );
}
