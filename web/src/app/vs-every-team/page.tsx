import type { Metadata } from "next";
import { Suspense } from "react";

import { SweepPage, SweepSkeleton } from "@/components/sweep/sweep-page";

export const metadata: Metadata = {
  title: "vs Every Team",
  description: "One player's predicted points against all 29 opponents, best matchup first.",
};

export default function Page() {
  return (
    <Suspense fallback={<SweepSkeleton />}>
      <SweepPage />
    </Suspense>
  );
}
