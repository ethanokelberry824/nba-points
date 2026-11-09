"use client";

import { AlertCircle, Check, Link2, RotateCcw } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { API_URL } from "@/lib/api";

/** Title row used by every page: same size, spacing and action slot everywhere. */
export function PageHeader({ title, description, actions }: { title: string; description: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Copies the current address (which always holds the full selection) to the clipboard. */
export function CopyLinkButton() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      // older browsers / no permission: select-and-copy fallback
      const t = document.createElement("textarea");
      t.value = window.location.href;
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <Button variant="outline" size="sm" onClick={copy} aria-live="polite">
      {copied ? <Check className="text-pos" /> : <Link2 />}
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
}

export function ApiErrorCard({ message, onRetry, title = "Can't reach the model" }: { message?: string; onRetry: () => void; title?: string }) {
  return (
    <Card className="mx-auto mt-10 max-w-lg items-start gap-3 p-6" role="alert">
      <AlertCircle className="size-6 text-neg" />
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">
        {message} The site talks to the API at <code className="rounded bg-muted px-1 py-0.5 text-xs">{API_URL}</code>.
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCcw /> Try again
      </Button>
    </Card>
  );
}

/** Plain-words takeaway under a chart. */
export function Takeaway({ children }: { children: React.ReactNode }) {
  return <p className="border-t pt-3 text-sm leading-relaxed text-muted-foreground">{children}</p>;
}
