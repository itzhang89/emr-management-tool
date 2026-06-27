import { useCallback, useEffect, useState } from "react";
import { mergeAthenaPreferences, readAthenaPreferences } from "@/services/athenaPreferencesStorage";
import type { AthenaAccountPreferences } from "@/types/domain";

export function useAthenaAccountPreferences(accountId?: string) {
  const [preferences, setPreferences] = useState<AthenaAccountPreferences>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!accountId) {
      setPreferences({});
      setReady(false);
      return;
    }

    setReady(false);
    const loaded = readAthenaPreferences(accountId);
    setPreferences(loaded);
    setReady(true);
  }, [accountId]);

  const updatePreferences = useCallback(
    (patch: Partial<AthenaAccountPreferences>) => {
      if (!accountId) return;
      const next = mergeAthenaPreferences(accountId, patch);
      setPreferences(next);
      return next;
    },
    [accountId]
  );

  const setOutputBasePath = useCallback(
    (outputBasePath: string) => {
      updatePreferences({ outputBasePath });
    },
    [updatePreferences]
  );

  const setAppendSubmitUser = useCallback(
    (appendSubmitUser: boolean) => {
      updatePreferences({ appendSubmitUser });
    },
    [updatePreferences]
  );

  const setWorkgroup = useCallback(
    (workgroup: string) => {
      updatePreferences({ lastWorkgroup: workgroup });
    },
    [updatePreferences]
  );

  return {
    ready,
    preferences,
    outputBasePath: preferences.outputBasePath ?? "",
    appendSubmitUser: preferences.appendSubmitUser ?? true,
    workgroup: preferences.lastWorkgroup ?? "primary",
    setOutputBasePath,
    setAppendSubmitUser,
    setWorkgroup,
    updatePreferences
  };
}
