"use client";

import { BarChart3, BookOpen, Crosshair, ListOrdered } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { useMeta } from "@/lib/hooks";
import { selectionQuery } from "@/lib/use-selection";

export const NAV = [
  { href: "/", label: "Matchup", icon: Crosshair },
  { href: "/vs-every-team", label: "vs Every Team", icon: ListOrdered },
  { href: "/model-performance", label: "Model Performance", icon: BarChart3 },
  { href: "/how-it-works", label: "How It Works", icon: BookOpen },
];

/** Matchup and vs Every Team share player / home / date (and opponent) through the URL. */
const SHARES_SELECTION = new Set(["/", "/vs-every-team"]);

function NavItems({ query = "" }: { query?: string }) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenu>
      {NAV.map((item) => (
        <SidebarMenuItem key={item.href}>
          <SidebarMenuButton asChild isActive={pathname === item.href} tooltip={item.label}>
            <Link
              href={SHARES_SELECTION.has(item.href) ? `${item.href}${query}` : item.href}
              onClick={() => setOpenMobile(false)}
              aria-current={pathname === item.href ? "page" : undefined}
            >
              <item.icon />
              <span>{item.label}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}

function NavItemsWithSelection() {
  const sp = useSearchParams();
  const pathname = usePathname();
  // only carry the selection when we're on a page that has one
  return <NavItems query={SHARES_SELECTION.has(pathname) ? selectionQuery(new URLSearchParams(sp.toString())) : ""} />;
}

export function AppSidebar() {
  const { data: meta } = useMeta();
  const { setOpenMobile } = useSidebar();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="Points Predictor">
              <Link href="/" onClick={() => setOpenMobile(false)}>
                <div className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-brand-solid text-sm font-bold text-white">
                  PP
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-semibold">Points Predictor</span>
                  <span className="truncate text-xs text-muted-foreground">
                    NBA {meta?.season ?? "season"}
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Predict</SidebarGroupLabel>
          <Suspense fallback={<NavItems />}>
            <NavItemsWithSelection />
          </Suspense>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="group-data-[collapsible=icon]:hidden">
        <div className="rounded-lg border bg-background/40 p-3 text-xs leading-relaxed text-muted-foreground">
          {meta ? (
            <>
              <div className="mb-1 font-medium text-foreground">Tested on {meta.test_season}</div>
              Off by <span className="font-semibold text-foreground tabular-nums">{meta.test_mae.toFixed(2)}</span> points
              a game on average, vs {meta.baseline_l5_mae.toFixed(2)} for a last 5 games average.
            </>
          ) : (
            <span>Intro to AI final project, CSUSM</span>
          )}
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
