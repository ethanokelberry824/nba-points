import type { Metadata } from "next";
import { Suspense } from "react";

import { MatchupPage, MatchupSkeleton } from "@/components/matchup/matchup-page";

export const metadata: Metadata = { title: { absolute: "Matchup | NBA Points Predictor" } };

export default function Home() {
  // the page reads its choices from the URL (useSearchParams), so it renders in the browser
  return (
    <Suspense fallback={<MatchupSkeleton />}>
      <MatchupPage />
    </Suspense>
  );
}
