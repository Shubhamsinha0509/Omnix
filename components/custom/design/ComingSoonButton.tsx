"use client";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

/**
 * A button the design shows for something not built yet (billing, upgrades): it looks as
 * designed and says so when pressed, instead of greying out the layout.
 */
export function ComingSoonButton({
  children,
  message,
  ...props
}: React.ComponentProps<typeof Button> & { message: string }) {
  return (
    <Button {...props} onClick={() => toast.add({ title: message, type: "info" })}>
      {children}
    </Button>
  );
}
