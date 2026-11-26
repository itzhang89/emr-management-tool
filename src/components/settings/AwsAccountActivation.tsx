import { useRef, useState } from "react";
import { toast } from "sonner";
import { MfaCodeDialog } from "@/components/settings/MfaCodeDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { useCancelAwsSsoLogin, useSetActiveAwsAccount, useStartAwsSsoLogin } from "@/hooks/useAwsSettings";
import { useT } from "@/i18n";
import type { AwsAccountSummary } from "@/types/domain";

export function canActivateAwsAccount(account: AwsAccountSummary) {
  return !account.isActive || Boolean(account.authMethod && account.authMethod !== "accessKey");
}

type ActivationCallbacks = {
  onSuccess?: () => void;
  onAuthRequired?: () => void;
};

type PendingAuthentication = {
  account: AwsAccountSummary;
  method: "mfa" | "sso";
  callbacks: ActivationCallbacks;
};

export function useAwsAccountActivation() {
  const t = useT();
  const setActive = useSetActiveAwsAccount();
  const [authentication, setAuthentication] = useState<PendingAuthentication | null>(null);
  const pendingAuth = useRef<PendingAuthentication | null>(null);

  const requestActivation = (account: AwsAccountSummary, callbacks: ActivationCallbacks) => {
    setActive.mutate(account.id, {
      onSuccess: () => {
        toast.success(t("{name} is now active.", { name: account.name }));
        callbacks.onSuccess?.();
      },
      onError: (error) => {
        const code = errorCode(error);
        if (code === "MfaCodeRequired" || code === "SsoLoginRequired") {
          const next: PendingAuthentication = {
            account,
            method: code === "MfaCodeRequired" ? "mfa" : "sso",
            callbacks
          };
          pendingAuth.current = next;
          setAuthentication(next);
          callbacks.onAuthRequired?.();
        } else {
          toast.error(errorMessage(error, "Failed to set active account."));
        }
      }
    });
  };

  const dismissAuthentication = () => {
    pendingAuth.current = null;
    setAuthentication(null);
  };

  const completeAuthentication = () => {
    if (!authentication || pendingAuth.current !== authentication) return;
    dismissAuthentication();
    requestActivation(authentication.account, authentication.callbacks);
  };

  return {
    isActivating: setActive.isPending || authentication !== null,
    activateAccount: (account: AwsAccountSummary, callbacks: ActivationCallbacks = {}) => {
      if (!setActive.isPending && !pendingAuth.current && canActivateAwsAccount(account)) {
        requestActivation(account, callbacks);
      }
    },
    authenticationDialog: authentication?.method === "mfa" ? (
      <MfaCodeDialog
        open
        accountId={authentication.account.id}
        accountName={authentication.account.name}
        onOpenChange={(open) => {
          if (!open) dismissAuthentication();
        }}
        onSuccess={completeAuthentication}
      />
    ) : authentication ? (
      <SsoActivationDialog
        account={authentication.account}
        onCancel={dismissAuthentication}
        onSuccess={completeAuthentication}
      />
    ) : null
  };
}

function SsoActivationDialog({
  account,
  onCancel,
  onSuccess
}: {
  account: AwsAccountSummary;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const t = useT();
  const login = useStartAwsSsoLogin();
  const cancelLogin = useCancelAwsSsoLogin();
  const cancelled = useRef(false);

  const signIn = () => {
    login.mutate(account.id, {
      onSuccess: () => {
        if (!cancelled.current) onSuccess();
      },
      onError: (error) => {
        if (!cancelled.current) toast.error(errorMessage(error, "SSO sign-in failed."));
      }
    });
  };

  const cancel = () => {
    cancelled.current = true;
    if (login.isPending) cancelLogin.mutate(account.id);
    onCancel();
  };

  return (
    <Dialog open onOpenChange={(open) => {
      if (!open) cancel();
    }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Sign in with SSO")}</DialogTitle>
          <DialogDescription>
            {login.isPending
              ? t("Complete SSO sign-in in your browser to continue.")
              : t("Sign in with SSO to activate {name}.", { name: account.name })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={cancel}>{t("Cancel")}</Button>
          <Button type="button" disabled={login.isPending} onClick={signIn}>{t("Sign in with SSO")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error ? error.code : undefined;
}

function errorMessage(error: unknown, fallback: string) {
  return error && typeof error === "object" && "message" in error && typeof error.message === "string"
    ? error.message
    : fallback;
}
