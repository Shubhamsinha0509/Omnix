import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown inside the workspace (the sidebar stays put) while the next page loads, so
 * moving between agents, the inbox and settings responds immediately.
 */
export default function WorkspaceLoading() {
  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-12" role="status" aria-live="polite" aria-label="Loading">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="mt-3 h-4 w-96 max-w-full" />
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
