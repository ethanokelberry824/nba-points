"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { fmt, initials } from "@/lib/format";
import { usePlayers } from "@/lib/hooks";
import { searchStore, useStore } from "@/lib/stores";
import { setUrlParams } from "@/lib/url-state";

/** Cmd+K / Ctrl+K player search. Picking a player opens his matchup. */
export function PlayerSearch() {
  const open = useStore(searchStore);
  const { data: players } = usePlayers();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchStore.set(!searchStore.get());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sorted = useMemo(
    () => (players ?? []).slice().sort((a, b) => (b.ppg ?? 0) - (a.ppg ?? 0)),
    [players],
  );

  const pick = (id: number) => {
    searchStore.set(false);
    if (pathname === "/" || pathname === "/vs-every-team") {
      setUrlParams({ player: String(id), out: null, oout: null });
    } else {
      router.push(`/?player=${id}`);
    }
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={searchStore.set}
      title="Find a player"
      description="Search every player who has played this season"
    >
        <Command>
        <CommandInput placeholder="Search players or teams..." />
        <CommandList className="max-h-[min(60vh,420px)]">
          <CommandEmpty>{players ? "No player found." : "Loading players..."}</CommandEmpty>
          <CommandGroup heading="Players, highest scoring first">
            {sorted.map((p) => (
              <CommandItem key={p.id} value={`${p.name} ${p.team} ${p.id}`} onSelect={() => pick(p.id)}>
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                  {initials(p.name)}
                </span>
                <span className="truncate">{p.name}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {p.team}
                </span>
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">{fmt(p.ppg)} ppg</span>
              </CommandItem>
            ))}
        </CommandGroup>
      </CommandList>
      </Command>
    </CommandDialog>
  );
}
