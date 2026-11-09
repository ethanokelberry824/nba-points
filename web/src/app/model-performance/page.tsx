import type { Metadata } from "next";

import { PerformancePage } from "@/components/performance/performance-page";

export const metadata: Metadata = {
  title: "Model Performance",
  description: "How accurate the NBA points model is on a full season it never saw, and live this season.",
};

export default function Page() {
  return <PerformancePage />;
}
