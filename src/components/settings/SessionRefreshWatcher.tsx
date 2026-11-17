import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { MfaCodeDialog } from "@/components/settings/MfaCodeDialog";
import { useAwsAccounts, useRefreshAwsAccountSession } from "@/hooks/useAwsSettings";
import { useT, type Translator } from "@/i18n";
import {
  canSilentRefresh,
  getSessionRemaining,
  needsInteractiveMfaRefresh,
  shouldProactivelyRefresh
} from "@/services/authSessionDisplay";
import type { AwsAccountSummary, AwsMfaCodeResult } from "@/types/domain";

const POLL_MS = 30_000;

/**
 * Hybrid session refresh:
 * - SSO / AssumeRole (no MFA): silent refresh when ≤10 minutes remain
 * - MFA session / AssumeRole+MFA: prompt for a TOTP code once per expiry window
 */
export function SessionRefreshWatcher() {
  const t = useT();
  const accounts = useAwsAccounts();
  const refreshSession = useRefreshAwsAccountSession();
  const [mfaAccount, setMfaAccount] = useState<AwsAccountSummary | null>(null);
  const handledRef = useRef(new Set<string>());
  const inFlightRef = useRef(new Set<string>());
  const refreshRef = useRef(refreshSession.mutateAsync);
  refreshRef.current = refreshSession.mutateAsync;

  useEffect(() => {
    const list = accounts.data;
    if (!list?.length) return;

    const evaluate = () => {
      processDueAccounts({
        accounts: list,
        handled: handledRef.current,
        inFlight: inFlightRef.current,
        refresh: (accountId) => refreshRef.current(accountId),
        promptMfa: (account) => setMfaAccount((current) => current ?? account),
        t
      });
    };

    evaluate();
    const id = window.setInterval(evaluate, POLL_MS);
    return () => window.clearInterval(id);
  }, [accounts.data, t]);

  return (
    <MfaCodeDialog
      open={Boolean(mfaAccount)}
      accountId={mfaAccount?.id ?? null}
      accountName={mfaAccount?.name}
      onOpenChange={(open) => {
        if (!open) setMfaAccount(null);
      }}
    />
  );
}

function processDueAccounts(options: {
  accounts: AwsAccountSummary[];
  handled: Set<string>;
  inFlight: Set<string>;
  refresh: (accountId: string) => Promise<AwsMfaCodeResult>;
  promptMfa: (account: AwsAccountSummary) => void;
  t: Translator;
}) {
  const { accounts, handled, inFlight, refresh, promptMfa, t } = options;
  const now = Date.now();
  const due = accounts
    .filter((account) => account.authMethod && account.authMethod !== "accessKey")
    .filter((account) => shouldProactivelyRefresh(account.sessionExpiresAt, now))
    .sort((left, right) => Number(right.isActive) - Number(left.isActive));

  for (const account of due) {
    const phase = getSessionRemaining(account.sessionExpiresAt, now)?.tone ?? "expired";
    // Separate warn vs expired so dismissing the MFA dialog at 10m still
    // re-prompts once the session actually expires.
    const handleKey = `${account.id}:${account.sessionExpiresAt ?? "none"}:${phase}`;
    if (handled.has(handleKey) || inFlight.has(account.id)) {
      continue;
    }

    if (canSilentRefresh(account)) {
      inFlight.add(account.id);
      handled.add(handleKey);
      void refresh(account.id)
        .then((result) => {
          const remaining = getSessionRemaining(result.sessionExpiresAt);
          toast.success(
            remaining && remaining.tone !== "expired"
              ? t("Session refreshed for {name} · {duration} left", {
                  name: account.name,
                  duration: remaining.durationLabel
                })
              : t("Session refreshed for {name}.", { name: account.name })
          );
        })
        .catch((error: unknown) => {
          toast.error(
            errorMessage(
              error,
              account.authMethod === "sso"
                ? t("Session refresh failed for {name}. Sign in with SSO again.", {
                    name: account.name
                  })
                : t("Session refresh failed for {name}.", { name: account.name })
            )
          );
        })
        .finally(() => {
          inFlight.delete(account.id);
        });
      continue;
    }

    if (needsInteractiveMfaRefresh(account)) {
      handled.add(handleKey);
      promptMfa(account);
      toast.message(
        phase === "expired"
          ? t("Session for {name} expired. Enter an MFA code to continue.", {
              name: account.name
            })
          : t("Session for {name} expires soon. Enter an MFA code to refresh.", {
              name: account.name
            })
      );
    }
  }
}

function errorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
}
