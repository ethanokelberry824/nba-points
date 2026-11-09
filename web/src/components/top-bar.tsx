"use client";

import { AlertTriangle, CalendarClock, Loader2, Moon, Search, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { longDate, shortDate } from "@/lib/format";
import { useMeta, useSlowRequests } from "@/lib/hooks";
import { searchStore, staleStore, useStore } from "@/lib/stores";

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle light and dark mode"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun className="hidden size-4 dark:block" />
      <Moon className="size-4 dark:hidden" />
    </Button>
  );
}

export function TopBar() {
  const { data: meta, isLoading } = useMeta();

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/60 sm:px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />

      <button
        type="button"
        onClick={() => searchStore.set(true)}
        className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted sm:max-w-72"
      >
        <Search className="size-4 shrink-0" />
        <span className="truncate">Search players...</span>
        <kbd className="pointer-events-none ml-auto hidden h-5 items-center gap-0.5 rounded border bg-background px-1.5 font-mono text-[10px] font-medium sm:flex">
          <span className="text-xs">⌘</span>K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <div className="flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs text-muted-foreground">
          <CalendarClock className="size-3.5" />
          {isLoading || !meta ? (
            <Skeleton className="h-3 w-24" />
          ) : (
            <>
              <span className="hidden md:inline">Stats through {longDate(meta.stats_through)}</span>
              <span className="md:hidden">{shortDate(meta.stats_through)}</span>
            </>
          )}
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}

/** Banners under the top bar: cold start ("waking up") and stale data. */
export function TopBanners() {
  const slow = useSlowRequests();
  const { data: meta } = useMeta();
  const pageWarning = useStore(staleStore);
  const warning = pageWarning === undefined ? meta?.stale_warning : pageWarning;

  return (
    <>
      {slow && (
        <div role="status" className="flex items-center gap-2 border-b bg-brand/10 px-4 py-2 text-sm text-foreground">
          <Loader2 className="size-4 shrink-0 animate-spin text-brand" />
          Waking up the model, this can take up to a minute.
        </div>
      )}
      {warning && (
        <div role="alert" className="flex items-start gap-2 border-b bg-amber-500/10 px-4 py-2 text-sm text-amber-800 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{warning}</span>
        </div>
      )}
    </>
  );
}
