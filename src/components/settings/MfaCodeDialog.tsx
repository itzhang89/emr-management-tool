import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSubmitAwsMfaCode } from "@/hooks/useAwsSettings";
import { useT } from "@/i18n";
import { getSessionRemaining } from "@/services/authSessionDisplay";

type MfaCodeDialogProps = {
  open: boolean;
  accountId: string | null;
  accountName?: string;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
};

export function MfaCodeDialog({
  open,
  accountId,
  accountName,
  onOpenChange,
  onSuccess
}: MfaCodeDialogProps) {
  const t = useT();
  const submitMfa = useSubmitAwsMfaCode();
  const [tokenCode, setTokenCode] = useState("");

  useEffect(() => {
    if (open) setTokenCode("");
  }, [open, accountId]);

  const submit = async () => {
    if (!accountId) return;
    try {
      const result = await submitMfa.mutateAsync({ accountId, tokenCode });
      const remaining = getSessionRemaining(result.sessionExpiresAt);
      const base = t("Temporary credentials ready for {account}", {
        account: result.identity.account
      });
      toast.success(
        remaining && remaining.tone !== "expired"
          ? `${base} · ${t("{duration} left", { duration: remaining.durationLabel })}`
          : base
      );
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      toast.error(errorMessage(error, "Failed to submit MFA code."));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Enter MFA Code")}</DialogTitle>
          <DialogDescription>
            {accountName
              ? t("Enter the MFA token for {name} to continue.", { name: accountName })
              : t("Enter the MFA token to continue.")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="mfa-token">{t("MFA token")}</Label>
          <Input
            id="mfa-token"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            value={tokenCode}
            onChange={(event) => setTokenCode(event.target.value.trim())}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("Cancel")}
          </Button>
          <Button type="button" disabled={!accountId || tokenCode.length < 6 || submitMfa.isPending} onClick={() => void submit()}>
            {submitMfa.isPending ? t("Verifying...") : t("Continue")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function errorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
}
