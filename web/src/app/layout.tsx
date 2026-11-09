import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { AppSidebar } from "@/components/app-sidebar";
import { PlayerSearch } from "@/components/player-search";
import { Providers } from "@/components/providers";
import { TopBanners, TopBar } from "@/components/top-bar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const DESCRIPTION =
  "Pick a player and an opponent. A machine learning model predicts how many points he scores. Intro to AI final project, CSUSM.";

export const metadata: Metadata = {
  // set NEXT_PUBLIC_SITE_URL on Vercel so share images get absolute URLs
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: { default: "NBA Points Predictor", template: "%s | NBA Points Predictor" },
  description: DESCRIPTION,
  openGraph: { title: "NBA Points Predictor", description: DESCRIPTION, type: "website", siteName: "NBA Points Predictor" },
  twitter: { card: "summary_large_image", title: "NBA Points Predictor", description: DESCRIPTION },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <body>
        <Providers>
          <SidebarProvider>
            <AppSidebar />
            <SidebarInset className="min-w-0">
              <TopBar />
              <TopBanners />
              <main className="mx-auto w-full max-w-[1400px] flex-1 px-3 py-4 sm:px-6 sm:py-6">{children}</main>
            </SidebarInset>
          </SidebarProvider>
          <PlayerSearch />
        </Providers>
      </body>
    </html>
  );
}
