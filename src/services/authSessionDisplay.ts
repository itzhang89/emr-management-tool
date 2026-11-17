export type SessionRemainingTone = "ok" | "warn" | "expired";

export type SessionRemaining = {
  msLeft: number;
  tone: SessionRemainingTone;
  /** Numeric duration only, e.g. "11h 42m". Empty when expired. */
  durationLabel: string;
};

export const SESSION_REFRESH_WITHIN_MS = 10 * 60 * 1000;

/** Format a temporary-session expiry for Settings / toasts. */
export function getSessionRemaining(
  expiresAt: string | undefined | null,
  nowMs = Date.now()
): SessionRemaining | null {
  if (!expiresAt) return null;
  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresMs)) return null;

  const msLeft = expiresMs - nowMs;
  if (msLeft <= 0) {
    return { msLeft: 0, tone: "expired", durationLabel: "" };
  }

  return {
    msLeft,
    tone: msLeft <= SESSION_REFRESH_WITHIN_MS ? "warn" : "ok",
    durationLabel: formatRemainingDuration(msLeft)
  };
}

/** True when a temporary session should be refreshed (≤10m left or already expired). */
export function shouldProactivelyRefresh(
  expiresAt: string | undefined | null,
  nowMs = Date.now()
): boolean {
  const remaining = getSessionRemaining(expiresAt, nowMs);
  return remaining !== null && remaining.tone !== "ok";
}

export function canSilentRefresh(account: {
  authMethod?: string;
  mfaSerial?: string | null;
}): boolean {
  if (account.authMethod === "sso") return true;
  if (account.authMethod === "assumeRole") {
    return !account.mfaSerial?.trim();
  }
  return false;
}

export function needsInteractiveMfaRefresh(account: {
  authMethod?: string;
  mfaSerial?: string | null;
}): boolean {
  if (account.authMethod === "mfaSession") return true;
  if (account.authMethod === "assumeRole") {
    return Boolean(account.mfaSerial?.trim());
  }
  return false;
}

export function formatRemainingDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (minutes > 0) {
    return minutes >= 10 || seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}
