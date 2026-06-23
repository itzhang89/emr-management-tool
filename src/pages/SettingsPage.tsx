import { useState } from "react";
import { CheckCircle2, Download, KeyRound, RefreshCw, Save, ShieldCheck, Trash2 } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { zodResolver } from "@hookform/resolvers/zod";
import { AwsRegionInput } from "@/components/aws/AwsRegionInput";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useAwsAccounts,
  useAwsCliProfiles,
  useCreateAwsAccount,
  useDeleteAwsAccount,
  useImportAwsCliProfile,
  useSetActiveAwsAccount,
  useTestAwsCredentials
} from "@/hooks/useAwsSettings";
import { credentialSchema, type CredentialFormValues } from "@/services/credentialValidation";
import { appUpdater, type UpdateCheckResult } from "@/services/appUpdater";
import { getReleaseInfo } from "@/services/releaseInfo";
import type { AppError } from "@/types/domain";

export function SettingsPage() {
  const releaseInfo = getReleaseInfo();
  const [availableUpdate, setAvailableUpdate] = useState<Extract<UpdateCheckResult, { status: "available" }> | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const accounts = useAwsAccounts();
  const cliProfiles = useAwsCliProfiles();
  const createAccount = useCreateAwsAccount();
  const importCliProfile = useImportAwsCliProfile();
  const setActiveAccount = useSetActiveAwsAccount();
  const deleteAccount = useDeleteAwsAccount();
  const testCredentials = useTestAwsCredentials();
  const form = useForm<CredentialFormValues>({
    resolver: zodResolver(credentialSchema),
    defaultValues: {
      name: "",
      accessKeyId: "",
      secretAccessKey: "",
      region: "us-east-1",
      makeActive: true
    }
  });

  const testConnection = form.handleSubmit(async (values) => {
    try {
      const identity = await testCredentials.mutateAsync(values);
      toast.success(`Connected to AWS account ${identity.account}`);
    } catch (error) {
      toast.error(errorMessage(error, "AWS connection test failed."));
    }
  });

  const save = form.handleSubmit(async (values) => {
    try {
      await createAccount.mutateAsync(values);
      toast.success("AWS account saved.");
      form.reset({ name: "", accessKeyId: "", secretAccessKey: "", region: values.region, makeActive: true });
    } catch (error) {
      toast.error(errorMessage(error, "Failed to save AWS account."));
    }
  });

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

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
            {releaseInfo.isDevelopment ? <Badge variant="secondary">Development</Badge> : null}
          </div>
          <p className="text-sm text-muted-foreground">
            Manage named AWS accounts. Development builds store secrets in a local development store; production builds use the OS keychain.
          </p>
        </div>
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
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configured Accounts</CardTitle>
          <CardDescription>
            Region is fixed when the account is created. If Virtual Clusters is empty, confirm this region matches the
            AWS Console region for your EMR virtual cluster.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {accounts.isLoading ? <p className="text-sm text-muted-foreground">Loading accounts...</p> : null}
          {accounts.error ? <DemoError error={accounts.error} /> : null}
          {accounts.data?.length === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              No AWS accounts are configured yet. Add one below to enable production commands.
            </p>
          ) : null}
          {accounts.data?.map((account) => (
            <div key={account.id} className="flex items-center justify-between rounded-lg border p-4">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium">{account.name}</p>
                  {account.isActive ? <Badge>Active</Badge> : null}
                </div>
                <p className="text-sm text-muted-foreground">
                  {account.region} · {account.accessKeyIdMasked}
                  {account.identity ? ` · ${account.identity.account}` : ""}
                </p>
                {account.identity ? <p className="truncate text-xs text-muted-foreground">{account.identity.arn}</p> : null}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={account.isActive || setActiveAccount.isPending}
                  onClick={() => {
                    setActiveAccount.mutate(account.id, {
                      onSuccess: () => toast.success(`${account.name} is now active.`),
                      onError: (error) => toast.error(errorMessage(error, "Failed to set active account."))
                    });
                  }}
                >
                  <CheckCircle2 data-icon="inline-start" />
                  Use
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={deleteAccount.isPending}
                  onClick={() => {
                    deleteAccount.mutate(account.id, {
                      onSuccess: () => toast.success(`${account.name} deleted.`),
                      onError: (error) => toast.error(errorMessage(error, "Failed to delete account."))
                    });
                  }}
                >
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
            Detect local AWS CLI static credential profiles and import them without exposing secret values to the UI.
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
                disabled={!profile.canImport || importCliProfile.isPending}
                onClick={() => {
                  importCliProfile.mutate(
                    { profileName: profile.profileName, makeActive: true },
                    {
                      onSuccess: () => toast.success(`${profile.profileName} imported.`),
                      onError: (error) => toast.error(errorMessage(error, "Failed to import AWS CLI profile."))
                    }
                  );
                }}
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
          <CardTitle>AWS Credentials</CardTitle>
          <CardDescription>Create or replace a named access-key account.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={save}>
          <Field label="Account Name">
            <Input placeholder="Production analytics" {...form.register("name")} aria-invalid={Boolean(form.formState.errors.name)} />
            <FieldError>{form.formState.errors.name?.message}</FieldError>
          </Field>
          <Field label="Access Key ID">
            <Input placeholder="AKIA..." {...form.register("accessKeyId")} aria-invalid={Boolean(form.formState.errors.accessKeyId)} />
            <FieldError>{form.formState.errors.accessKeyId?.message}</FieldError>
          </Field>
          <Field label="Secret Access Key">
            <Input
              type="password"
              placeholder="••••••••••••••••"
              {...form.register("secretAccessKey")}
              aria-invalid={Boolean(form.formState.errors.secretAccessKey)}
            />
            <FieldError>{form.formState.errors.secretAccessKey?.message}</FieldError>
          </Field>
          <Field label="Region">
            <Controller
              control={form.control}
              name="region"
              render={({ field }) => (
                <AwsRegionInput
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  aria-invalid={Boolean(form.formState.errors.region)}
                />
              )}
            />
            <FieldError>{form.formState.errors.region?.message}</FieldError>
            <p className="text-xs text-muted-foreground">
              Pick a common region from the suggestions or type any AWS region code. Importing an AWS CLI profile copies
              its region automatically.
            </p>
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" disabled={testCredentials.isPending} onClick={testConnection}>
              <ShieldCheck data-icon="inline-start" />
              {testCredentials.isPending ? "Testing..." : "Test Connection"}
            </Button>
            <Button type="submit" disabled={createAccount.isPending}>
              <Save data-icon="inline-start" />
              {createAccount.isPending ? "Saving..." : "Save Account"}
            </Button>
          </div>
          </form>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function FieldError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;

  return <p className="text-xs text-destructive">{children}</p>;
}

function errorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
}
