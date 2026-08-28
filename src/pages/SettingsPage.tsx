import { useState } from "react";
import { CheckCircle2, Download, FileDown, KeyRound, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PageHeader } from "@/components/layout/PageHeader";
import { AccountFormDialog } from "@/components/settings/AccountFormDialog";
import { DeleteAccountDialog } from "@/components/settings/DeleteAccountDialog";
import { ImportCliProfileDialog } from "@/components/settings/ImportCliProfileDialog";
import {
  useAwsAccounts,
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
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const accounts = useAwsAccounts();
  const importCliProfile = useImportAwsCliProfile();
  const loadCliProfile = useLoadAwsCliProfile();
  const setActiveAccount = useSetActiveAwsAccount();
  const deleteAccount = useDeleteAwsAccount();

  const openImportDialog = async (profile: AwsCliProfileSummary) => {
    const notice = cliImportPromptReason(profile, accounts.data ?? []);
    try {
      const credentials = await loadCliProfile.mutateAsync(profile.profileName);
      setImportDialogOpen(false);
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
        onSuccess: () => {
          toast.success(`${profile.profileName} imported.`);
          setImportDialogOpen(false);
        },
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
    <div className="flex w-full min-w-0 flex-col gap-6 overflow-auto">
      <PageHeader
        pageId="settings"
        showIcon
        titleAddon={
          <>
            <Separator orientation="vertical" className="h-5" />
            <span className="text-sm font-medium text-muted-foreground" aria-live="polite">
              v{releaseInfo.version}
              {availableUpdate ? (
                <>
                  {" → "}
                  <span className="text-foreground">v{availableUpdate.version}</span>
                </>
              ) : null}
            </span>
            {releaseInfo.isDevelopment ? <Badge variant="secondary">Development</Badge> : null}
          </>
        }
        actions={
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
        }
      />

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 p-4 2xl:p-5">
          <div className="space-y-1">
            <CardTitle className="text-base 2xl:text-lg">Configured Accounts</CardTitle>
            <CardDescription className="text-xs 2xl:text-sm">
              Double-click an account to make it active. Use Edit to change the name or region. Access Key stays fixed;
              unlock Secret only when rotating the secret for the same key. Use the import icon to bring in local AWS CLI
              profiles.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-9 2xl:size-10"
                  aria-label="Import AWS CLI profiles"
                  onClick={() => setImportDialogOpen(true)}
                >
                  <FileDown className="size-4 2xl:size-[18px]" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Import AWS CLI profiles</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-9 2xl:size-10"
                  aria-label="Add account"
                  onClick={() => setAccountDialog({ mode: "create" })}
                >
                  <Plus className="size-4 2xl:size-[18px]" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Add account</TooltipContent>
            </Tooltip>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 p-4 pt-0 2xl:space-y-2.5 2xl:p-5 2xl:pt-0">
          {accounts.isLoading ? <p className="text-sm text-muted-foreground">Loading accounts...</p> : null}
          {accounts.error ? <DemoError error={accounts.error} /> : null}
          {accounts.data?.length === 0 ? (
            <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground 2xl:p-4 2xl:text-sm">
              No AWS accounts are configured yet. Click + to add one and enable production commands.
            </p>
          ) : null}
          {accounts.data?.map((account) => (
            <div
              key={account.id}
              title="Double-click to use this account"
              className="flex cursor-default items-center justify-between gap-3 rounded-md border px-3 py-2.5 transition-colors hover:bg-accent/40 2xl:px-4 2xl:py-3 3xl:px-5 3xl:py-3.5"
              onDoubleClick={() => activateAccount(account)}
            >
              <div className="min-w-0 space-y-0.5 2xl:space-y-1">
                <div className="flex min-w-0 items-center gap-2">
                  <p className="truncate text-sm font-medium 2xl:text-base">{account.name}</p>
                  {account.isActive ? (
                    <Badge className="px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide 2xl:text-[11px]">
                      Active
                    </Badge>
                  ) : null}
                </div>
                <p className="truncate text-xs text-muted-foreground 2xl:text-sm">
                  {account.region} · {account.accessKeyIdMasked}
                  {account.identity ? ` · ${account.identity.account}` : ""}
                </p>
                {account.identity ? (
                  <p className="truncate text-[11px] text-muted-foreground/80 2xl:text-xs">{account.identity.arn}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1" onDoubleClick={(event) => event.stopPropagation()}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-9 2xl:size-10"
                      aria-label={`Use ${account.name}`}
                      disabled={account.isActive || setActiveAccount.isPending}
                      onClick={() => activateAccount(account)}
                    >
                      <CheckCircle2 className="size-4 2xl:size-[18px]" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{account.isActive ? "Already active" : "Use this account"}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-9 2xl:size-10"
                      aria-label={`Edit ${account.name}`}
                      onClick={() => setAccountDialog({ mode: "edit", account })}
                    >
                      <Pencil className="size-4 2xl:size-[18px]" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Edit</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-9 text-destructive hover:bg-destructive/10 hover:text-destructive 2xl:size-10"
                      aria-label={`Delete ${account.name}`}
                      onClick={() => setAccountPendingDelete(account)}
                    >
                      <Trash2 className="size-4 2xl:size-[18px]" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Delete</TooltipContent>
                </Tooltip>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 2xl:p-5">
          <CardTitle className="flex items-center gap-2 text-base 2xl:text-lg">
            <KeyRound className="size-4 2xl:size-[18px]" />
            Future Authentication
          </CardTitle>
          <CardDescription className="text-xs 2xl:text-sm">
            AWS Profile, SSO, and Assume Role are reserved for later versions.
          </CardDescription>
        </CardHeader>
      </Card>

      <ImportCliProfileDialog
        open={importDialogOpen}
        pending={importCliProfile.isPending || loadCliProfile.isPending}
        accounts={accounts.data ?? []}
        onOpenChange={setImportDialogOpen}
        onImport={handleImportProfile}
        renderError={(error) => <DemoError error={error} />}
      />
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
