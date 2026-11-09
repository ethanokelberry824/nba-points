import { Compass } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <Card className="mx-auto mt-10 max-w-md items-center gap-3 p-8 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl bg-brand/15 text-brand-ink">
        <Compass className="size-6" />
      </span>
      <p className="text-5xl font-semibold tracking-tight tabular-nums">404</p>
      <h1 className="text-lg font-semibold">That page airballed</h1>
      <p className="text-sm text-muted-foreground">The page you were looking for doesn&apos;t exist. Try a matchup instead.</p>
      <Button asChild className="mt-2">
        <Link href="/">Go to Matchup</Link>
      </Button>
    </Card>
  );
}
