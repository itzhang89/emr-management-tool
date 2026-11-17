import { useEffect, useState } from "react";
import { getSessionRemaining } from "@/services/authSessionDisplay";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

type SessionExpiryLabelProps = {
  expiresAt?: string;
  className?: string;
};

/** Live countdown for SSO / MFA / AssumeRole temporary sessions. */
export function SessionExpiryLabel({ expiresAt, className }: SessionExpiryLabelProps) {
  const t = useT();
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => setNowMs(Date.now());
    tick();
    const id = window.setInterval(tick, 15_000);
    return () => window.clearInterval(id);
  }, [expiresAt]);

  const remaining = getSessionRemaining(expiresAt, nowMs);
  if (!remaining) return null;

  const text =
    remaining.tone === "expired"
      ? t("Session expired")
      : t("Session: {duration} left", { duration: remaining.durationLabel });

  return (
    <span
      className={cn(
        "text-[11px] 2xl:text-xs",
        remaining.tone === "ok" && "text-muted-foreground",
        remaining.tone === "warn" && "text-amber-600 dark:text-amber-400",
        remaining.tone === "expired" && "text-destructive",
        className
      )}
      title={expiresAt ? new Date(expiresAt).toLocaleString() : undefined}
    >
      {text}
    </span>
  );
}
