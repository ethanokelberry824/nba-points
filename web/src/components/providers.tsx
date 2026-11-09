"use client";

import { ThemeProvider } from "next-themes";
import { SWRConfig } from "swr";

import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
      <SWRConfig value={{ errorRetryCount: 2 }}>
        <TooltipProvider delayDuration={150}>{children}</TooltipProvider>
      </SWRConfig>
    </ThemeProvider>
  );
}
