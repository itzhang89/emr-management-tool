import { useState } from "react";
import { CheckCircle2, Download, KeyRound, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PageHeader } from "@/components/layout/PageHeader";
import { AccountFormDialog } from "@/components/settings/AccountFormDialog";
import { DeleteAccountDialog } from "@/components/settings/DeleteAccountDialog";
import {
  useAwsAccounts,
  useAwsCliProfiles,
  useDeleteAwsAccount,
  useImportAwsCliProfile,
  useLoadAwsCliProfile,
  useSetActiveAwsAccount
} from "@/hooks/useAwsSettings";
import { appUpdater, type UpdateCheckResult } from "@/services/appUpdater";
import { cliImportPromptReason, shouldPromptCliImport } from "@/services/cliProfileImport";
import type { CredentialFormValues } from "@/services/credentialValidation";
import { getReleaseInfo } from "@/services/releaseInfo";
import type { AppError, AwsAccountSummary, AwsCliProfileSummary } from "@/types/domain";

type AccountDialogState =
  | {
      mode: "create";
      createDefaults?: Partial<CredentialFormValues> & {
        notice?: string;
        title?: string;
        description?: string;
      };
    }
  | { mode: "edit"; account: AwsAccountSummary };

export function SettingsPage() {
  const releaseInfo = getReleaseInfo();
  const [availableUpdate, setAvailableUpdate] = useState<Extract<UpdateCheckResult, { status: "available" }> | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [accountDialog, setAccountDialog] = useState<AccountDialogState | null>(null);
  const [accountPendingDelete, setAccountPendingDelete] = useState<AwsAccountSummary | null>(null);
  const accounts = useAwsAccounts();
  const cliProfiles = useAwsCliProfiles();
  const importCliProfile = useImportAwsCliProfile();
  const loadCliProfile = useLoadAwsCliProfile();
  const setActiveAccount = useSetActiveAwsAccount();
  const deleteAccount = useDeleteAwsAccount();

  const openImportDialog = async (profile: AwsCliProfileSummary) => {
    const notice = cliImportPromptReason(profile, accounts.data ?? []);
    try {
      const credentials = await loadCliProfile.mutateAsync(profile.profileName);
      setAccountDialog({
        mode: "create",
        createDefaults: {
          title: "Import AWS CLI Profile",
          description: `Complete the account details for profile "${profile.profileName}", then save.`,
          notice: notice ?? undefined,
          name: credentials.profileName,
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
          region: credentials.region?.trim() || "",
          makeActive: true
        }
      });
    } catch (error) {
      toast.error(errorMessage(error, "Failed to load AWS CLI profile."));
    }
  };

  const handleImportProfile = (profile: AwsCliProfileSummary) => {
    if (shouldPromptCliImport(profile, accounts.data ?? [])) {
      void openImportDialog(profile);
      return;
    }

    importCliProfile.mutate(
      {
        profileName: profile.profileName,
        name: profile.profileName,
        region: profile.region,
        makeActive: true
      },
      {
        onSuccess: () => toast.success(`${profile.profileName} imported.`),
        onError: (error) => toast.error(errorMessage(error, "Failed to import AWS CLI profile."))
      }
    );
  };

  const checkForUpdates = async () => {
    setCheckingUpdate(true);
    setAvailableUpdate(null);
    try {
      const result = await appUpdater.checkForUpdate();
      if (result.status === "unavailable") {
        toast.info(result.reason);
      } else if (result.status === "no-update") {
        toast.success("You are already using the latest version.");
      } else {
        setAvailableUpdate(result);
        toast.success(`Version ${result.version} is available.`);
      }
    } catch (error) {
      toast.error(errorMessage(error, "Failed to check for updates."));
    } finally {
      setCheckingUpdate(false);
    }
  };

  const installUpdate = async () => {
    if (!availableUpdate) return;

    setInstallingUpdate(true);
    try {
      await availableUpdate.install();
      toast.success("Update installed. Restart the app to use the new version.");
    } catch (error) {
      toast.error(errorMessage(error, "Failed to install update."));
    } finally {
      setInstallingUpdate(false);
    }
  };
  const updateButtonLabel = availableUpdate
    ? installingUpdate
      ? "Installing..."
      : `Install ${availableUpdate.version}`
    : checkingUpdate
      ? "Checking..."
      : "Check for Updates";
  const updateTooltip = `${releaseInfo.channelLabel} · ${releaseInfo.canUseAutoUpdater ? "Automatic updates enabled" : "Manual updates only"}`;

  const activateAccount = (account: AwsAccountSummary) => {
    if (account.isActive || setActiveAccount.isPending) return;
    setActiveAccount.mutate(account.id, {
      onSuccess: () => toast.success(`${account.name} is now active.`),
      onError: (error) => toast.error(errorMessage(error, "Failed to set active account."))
    });
  };

  return (
    <div className="flex max-w-5xl flex-col gap-6 overflow-auto">
      <PageHeader
        pageId="settings"
        titleAddon={releaseInfo.isDevelopment ? <Badge variant="secondary">Development</Badge> : null}
        actions={
          <div className="flex flex-col items-end gap-1.5">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {availableUpdate ? (
                <>
                  Current version: <span className="font-medium text-foreground">{releaseInfo.version}</span>
                  {" · "}
                  Upgrade to <span className="font-medium text-foreground">{availableUpdate.version}</span>
                </>
              ) : (
                <>
                  Current version: <span className="font-medium text-foreground">{releaseInfo.version}</span>
                </>
              )}
            </p>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  disabled={checkingUpdate || installingUpdate}
                  onClick={availableUpdate ? installUpdate : checkForUpdates}
                >
                  {availableUpdate ? <Download data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
                  {updateButtonLabel}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{updateTooltip}</TooltipContent>
            </Tooltip>
          </div>
        }
      />

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Configured Accounts</CardTitle>
            <CardDescription>
              Double-click an account to make it active. Use Edit to change the name or region. Access Key stays fixed;
              unlock Secret only when rotating the secret for the same key.
            </CardDescription>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Add account"
                onClick={() => setAccountDialog({ mode: "create" })}
              >
                <Plus />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Add account</TooltipContent>
          </Tooltip>
        </CardHeader>
        <CardContent className="space-y-3">
          {accounts.isLoading ? <p className="text-sm text-muted-foreground">Loading accounts...</p> : null}
          {accounts.error ? <DemoError error={accounts.error} /> : null}
          {accounts.data?.length === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              No AWS accounts are configured yet. Click + to add one and enable production commands.
            </p>
          ) : null}
          {accounts.data?.map((account) => (
            <div
              key={account.id}
              title="Double-click to use this account"
              className="flex cursor-default items-center justify-between rounded-lg border p-4"
              onDoubleClick={() => activateAccount(account)}
            >
              <div className="min-w-0 space-y-1">
                <div className="flex min-w-0 items-center gap-2">
                  <p className="truncate font-medium">{account.name}</p>
                  {account.isActive ? <Badge>Active</Badge> : null}
                </div>
                <p className="text-sm text-muted-foreground">
                  {account.region} · {account.accessKeyIdMasked}
                  {account.identity ? ` · ${account.identity.account}` : ""}
                </p>
                {account.identity ? <p className="truncate text-xs text-muted-foreground">{account.identity.arn}</p> : null}
              </div>
              <div className="flex gap-2" onDoubleClick={(event) => event.stopPropagation()}>
                <Button
                  type="button"
                  variant="outline"
                  disabled={account.isActive || setActiveAccount.isPending}
                  onClick={() => activateAccount(account)}
                >
                  <CheckCircle2 data-icon="inline-start" />
                  Use
                </Button>
                <Button type="button" variant="outline" onClick={() => setAccountDialog({ mode: "edit", account })}>
                  <Pencil data-icon="inline-start" />
                  Edit
                </Button>
                <Button type="button" variant="destructive" onClick={() => setAccountPendingDelete(account)}>
                  <Trash2 data-icon="inline-start" />
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AWS CLI Profiles</CardTitle>
          <CardDescription>
            Import local AWS CLI static credential profiles. If the profile is missing a region or the name is already
            used, you will complete the details in the add-account form.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {cliProfiles.isLoading ? <p className="text-sm text-muted-foreground">Scanning AWS CLI profiles...</p> : null}
          {cliProfiles.error ? <DemoError error={cliProfiles.error} /> : null}
          {cliProfiles.data?.length === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              No AWS CLI profiles were found in the local credentials or config files.
            </p>
          ) : null}
          {cliProfiles.data?.map((profile) => (
            <div key={profile.profileName} className="flex items-center justify-between rounded-lg border p-4">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium">{profile.profileName}</p>
                  {profile.canImport ? <Badge variant="secondary">Importable</Badge> : <Badge variant="outline">Unsupported</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">
                  {profile.region ?? "No region"} · {profile.accessKeyIdMasked ?? "No static access key"}
                </p>
                {profile.importError ? <p className="text-xs text-muted-foreground">{profile.importError}</p> : null}
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={!profile.canImport || importCliProfile.isPending || loadCliProfile.isPending}
                onClick={() => handleImportProfile(profile)}
              >
                <Download data-icon="inline-start" />
                Import
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-5" />
            Future Authentication
          </CardTitle>
          <CardDescription>AWS Profile, SSO, and Assume Role are reserved for later versions.</CardDescription>
        </CardHeader>
      </Card>

      <AccountFormDialog
        open={Boolean(accountDialog)}
        mode={accountDialog?.mode ?? "create"}
        account={accountDialog?.mode === "edit" ? accountDialog.account : undefined}
        createDefaults={accountDialog?.mode === "create" ? accountDialog.createDefaults : null}
        onOpenChange={(open) => {
          if (!open) setAccountDialog(null);
        }}
      />
      <DeleteAccountDialog
        open={Boolean(accountPendingDelete)}
        accountName={accountPendingDelete?.name}
        pending={deleteAccount.isPending}
        onOpenChange={(open) => {
          if (!open) setAccountPendingDelete(null);
        }}
        onConfirm={() => {
          if (!accountPendingDelete) return;
          deleteAccount.mutate(accountPendingDelete.id, {
            onSuccess: () => {
              toast.success(`${accountPendingDelete.name} deleted.`);
              setAccountPendingDelete(null);
            },
            onError: (error) => toast.error(errorMessage(error, "Failed to delete account."))
          });
        }}
      />
    </div>
  );
}

function DemoError({ error }: { error: unknown }) {
  const appError = error as Partial<AppError>;
  return (
    <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
      {appError.code === "DemoModeUnavailable"
        ? "Settings require the Tauri desktop runtime. Start with npm run tauri -- dev."
        : errorMessage(error, "Failed to load accounts.")}
    </p>
  );
}

function errorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
}
