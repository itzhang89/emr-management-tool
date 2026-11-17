import { useEffect, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { AwsRegionInput } from "@/components/aws/AwsRegionInput";
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
import { useT } from "@/i18n";
import {
  useCreateAwsAccount,
  useTestAwsAccount,
  useTestAwsCredentials,
  useUpdateAwsAccount
} from "@/hooks/useAwsSettings";
import {
  credentialSchema,
  editAccountSchema,
  toCreateAccountRequest,
  type CredentialFormValues,
  type EditAccountFormValues,
  type EditAccountSubmitValues
} from "@/services/credentialValidation";
import type { AwsAccountSummary, AwsAuthMethod } from "@/types/domain";

type CreateAccountDefaults = Partial<CredentialFormValues> & {
  notice?: string;
  title?: string;
  description?: string;
};

type AccountFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  account?: AwsAccountSummary | null;
  createDefaults?: CreateAccountDefaults | null;
};

const AUTH_OPTIONS: { value: AwsAuthMethod; label: string }[] = [
  { value: "accessKey", label: "Access Key" },
  { value: "sso", label: "SSO / Identity Center" },
  { value: "mfaSession", label: "IAM User + MFA" },
  { value: "assumeRole", label: "Assume Role" }
];

export function AccountFormDialog({
  open,
  onOpenChange,
  mode,
  account,
  createDefaults
}: AccountFormDialogProps) {
  if (mode === "edit") {
    return <EditAccountDialog open={open} onOpenChange={onOpenChange} account={account ?? null} />;
  }
  return <CreateAccountDialog open={open} onOpenChange={onOpenChange} defaults={createDefaults ?? null} />;
}

function CreateAccountDialog({
  open,
  onOpenChange,
  defaults
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaults: CreateAccountDefaults | null;
}) {
  const t = useT();
  const createAccount = useCreateAwsAccount();
  const testCredentials = useTestAwsCredentials();
  const [showSecret, setShowSecret] = useState(false);
  const emptyValues: CredentialFormValues = {
    name: "",
    authMethod: "accessKey",
    accessKeyId: "",
    secretAccessKey: "",
    region: "",
    makeActive: true,
    ssoStartUrl: "",
    ssoRegion: "",
    ssoAccountId: "",
    ssoRoleName: "",
    mfaSerial: "",
    roleArn: "",
    externalId: "",
    roleSessionName: ""
  };
  const form = useForm<CredentialFormValues>({
    resolver: zodResolver(credentialSchema),
    defaultValues: emptyValues
  });
  const authMethod = useWatch({ control: form.control, name: "authMethod" });

  useEffect(() => {
    if (!open) return;
    setShowSecret(false);
    form.reset({
      ...emptyValues,
      ...defaults,
      name: defaults?.name ?? "",
      authMethod: defaults?.authMethod ?? "accessKey",
      accessKeyId: defaults?.accessKeyId ?? "",
      secretAccessKey: defaults?.secretAccessKey ?? "",
      region: defaults?.region?.trim() ? defaults.region : "",
      makeActive: defaults?.makeActive ?? true
    });
  }, [open, defaults, form]);

  const testConnection = form.handleSubmit(async (values) => {
    if (values.authMethod !== "accessKey") {
      toast.message(t("Save the account first, then use Sign in / MFA from the account list."));
      return;
    }
    try {
      const identity = await testCredentials.mutateAsync({
        accessKeyId: values.accessKeyId,
        secretAccessKey: values.secretAccessKey,
        region: values.region
      });
      toast.success(t("Connected to AWS account {account}", { account: identity.account }));
    } catch (error) {
      toast.error(errorMessage(error, "AWS connection test failed."));
    }
  });

  const save = form.handleSubmit(async (values) => {
    try {
      await createAccount.mutateAsync(toCreateAccountRequest(values));
      toast.success(
        values.authMethod === "sso"
          ? t("SSO account saved. Sign in from the account list.")
          : values.authMethod === "mfaSession"
            ? t("MFA account saved. Enter an MFA code when prompted.")
            : t("AWS account saved.")
      );
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error, "Failed to save AWS account."));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t(defaults?.title ?? "Add AWS Account")}</DialogTitle>
          <DialogDescription>
            {t(
              defaults?.description ??
                "Choose an authentication method, then fill in the required fields."
            )}
          </DialogDescription>
        </DialogHeader>
        {defaults?.notice ? (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-foreground">{defaults.notice}</p>
        ) : null}
        <form className="flex flex-col gap-4" onSubmit={save}>
          <Field label={t("Account Name")}>
            <Input
              placeholder={t("e.g. prod-analytics (unique, cannot rename later)")}
              {...form.register("name")}
              aria-invalid={Boolean(form.formState.errors.name)}
            />
            <FieldError>{form.formState.errors.name?.message}</FieldError>
          </Field>
          <Field label={t("Authentication")}>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              {...form.register("authMethod")}
            >
              {AUTH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.label)}
                </option>
              ))}
            </select>
          </Field>

          {(authMethod === "accessKey" || authMethod === "mfaSession" || authMethod === "assumeRole") && (
            <>
              <Field label={t("Access Key ID")}>
                <Input
                  placeholder={t("AKIAxxxxxxxx (IAM user access key ID)")}
                  {...form.register("accessKeyId")}
                  aria-invalid={Boolean(form.formState.errors.accessKeyId)}
                />
                <FieldError>{form.formState.errors.accessKeyId?.message}</FieldError>
              </Field>
              <Field label={t("Secret Access Key")}>
                <div className="relative">
                  <Input
                    type={showSecret ? "text" : "password"}
                    placeholder={t("Secret key paired with the access key")}
                    className="pr-10"
                    {...form.register("secretAccessKey")}
                    aria-invalid={Boolean(form.formState.errors.secretAccessKey)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-10 w-10 text-muted-foreground hover:text-foreground"
                    aria-label={showSecret ? t("Hide secret access key") : t("Show secret access key")}
                    onClick={() => setShowSecret((visible) => !visible)}
                  >
                    {showSecret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </Button>
                </div>
                <FieldError>{form.formState.errors.secretAccessKey?.message}</FieldError>
              </Field>
            </>
          )}

          {authMethod === "sso" && (
            <>
              <Field label={t("SSO start URL")}>
                <Input
                  placeholder={t("https://my-org.awsapps.com/start")}
                  {...form.register("ssoStartUrl")}
                />
                <FieldError>{form.formState.errors.ssoStartUrl?.message}</FieldError>
              </Field>
              <Field label={t("SSO region")}>
                <Input placeholder={t("e.g. ap-southeast-1 (Identity Center region)")} {...form.register("ssoRegion")} />
              </Field>
              <Field label={t("SSO account ID")}>
                <Input placeholder={t("12-digit AWS account ID, e.g. 123456789012")} {...form.register("ssoAccountId")} />
                <FieldError>{form.formState.errors.ssoAccountId?.message}</FieldError>
              </Field>
              <Field label={t("SSO role name")}>
                <Input
                  placeholder={t("Permission set / role name, e.g. AdministratorAccess")}
                  {...form.register("ssoRoleName")}
                />
                <FieldError>{form.formState.errors.ssoRoleName?.message}</FieldError>
              </Field>
            </>
          )}

          {authMethod === "mfaSession" ? (
            <p className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              {t(
                "IAM User + MFA uses sts:GetSessionToken. API calls still run as that IAM user (ASIA temporary keys). If EMR permissions are on a role, choose Assume Role and set MFA there instead."
              )}
            </p>
          ) : null}

          {(authMethod === "mfaSession" || authMethod === "assumeRole") && (
            <Field label={t("MFA serial / ARN")}>
              <Input
                placeholder={t("arn:aws:iam::123456789012:mfa/username")}
                {...form.register("mfaSerial")}
              />
              <FieldError>{form.formState.errors.mfaSerial?.message}</FieldError>
            </Field>
          )}

          {authMethod === "assumeRole" && (
            <>
              <Field label={t("Role ARN")}>
                <Input
                  placeholder={t("arn:aws:iam::123456789012:role/MyRole")}
                  {...form.register("roleArn")}
                />
                <FieldError>{form.formState.errors.roleArn?.message}</FieldError>
              </Field>
              <Field label={t("External ID (optional)")}>
                <Input placeholder={t("External ID required by the role trust policy")} {...form.register("externalId")} />
              </Field>
              <Field label={t("Role session name (optional)")}>
                <Input
                  placeholder={t("Session name shown in CloudTrail, e.g. emr-management-tool")}
                  {...form.register("roleSessionName")}
                />
              </Field>
            </>
          )}

          <Field label={t("Region")}>
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
          </Field>
          <DialogFooter>
            {authMethod === "accessKey" ? (
              <Button type="button" variant="outline" disabled={testCredentials.isPending} onClick={testConnection}>
                <ShieldCheck data-icon="inline-start" />
                {testCredentials.isPending ? t("Testing...") : t("Test Connection")}
              </Button>
            ) : null}
            <Button type="submit" disabled={createAccount.isPending}>
              <Save data-icon="inline-start" />
              {createAccount.isPending ? t("Saving...") : t("Save Account")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditAccountDialog({
  open,
  onOpenChange,
  account
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: AwsAccountSummary | null;
}) {
  const t = useT();
  const updateAccount = useUpdateAwsAccount();
  const testAccount = useTestAwsAccount();
  const originalAuthMethod = account?.authMethod ?? "accessKey";
  const form = useForm<EditAccountFormValues>({
    resolver: zodResolver(editAccountSchema),
    defaultValues: {
      name: "",
      authMethod: "accessKey",
      accessKeyId: "",
      region: "us-east-1",
      secretAccessKey: "",
      ssoStartUrl: "",
      ssoRegion: "",
      ssoAccountId: "",
      ssoRoleName: "",
      mfaSerial: "",
      roleArn: "",
      externalId: "",
      roleSessionName: "",
      credentialsUnlocked: false,
      originalAuthMethod: "accessKey"
    }
  });
  const authMethod = useWatch({ control: form.control, name: "authMethod" }) ?? originalAuthMethod;
  const credentialsUnlocked =
    useWatch({ control: form.control, name: "credentialsUnlocked" }) ?? false;
  const switchingFromSso = originalAuthMethod === "sso" && authMethod !== "sso";
  const showCredentialEditors =
    authMethod === "accessKey" || authMethod === "mfaSession" || authMethod === "assumeRole";
  const credentialsEditable = credentialsUnlocked || switchingFromSso;

  useEffect(() => {
    if (!open || !account) return;
    form.reset({
      name: account.name,
      authMethod: account.authMethod ?? "accessKey",
      accessKeyId: "",
      region: account.region,
      secretAccessKey: "",
      ssoStartUrl: account.ssoStartUrl ?? "",
      ssoRegion: "",
      ssoAccountId: account.ssoAccountId ?? "",
      ssoRoleName: account.ssoRoleName ?? "",
      mfaSerial: account.mfaSerial ?? "",
      roleArn: account.roleArn ?? "",
      externalId: "",
      roleSessionName: "",
      credentialsUnlocked: false,
      originalAuthMethod: account.authMethod ?? "accessKey"
    });
  }, [open, account, form]);

  useEffect(() => {
    if (switchingFromSso) {
      form.setValue("credentialsUnlocked", true);
    }
  }, [switchingFromSso, form]);

  const testConnection = form.handleSubmit(async (values) => {
    if (!account) return;
    const parsed = values as EditAccountSubmitValues;
    try {
      const identity = await testAccount.mutateAsync({
        accountId: account.id,
        region: parsed.region,
        secretAccessKey: credentialsEditable ? parsed.secretAccessKey : undefined
      });
      toast.success(t("Connected to AWS account {account}", { account: identity.account }));
    } catch (error) {
      toast.error(errorMessage(error, "AWS connection test failed."));
    }
  });

  const save = form.handleSubmit(async (values) => {
    if (!account) return;
    const parsed = values as EditAccountSubmitValues;
    try {
      await updateAccount.mutateAsync({
        accountId: account.id,
        name: account.name,
        authMethod: parsed.authMethod,
        region: parsed.region,
        accessKeyId: credentialsEditable ? parsed.accessKeyId : undefined,
        secretAccessKey: credentialsEditable ? parsed.secretAccessKey : undefined,
        ssoStartUrl: parsed.ssoStartUrl,
        ssoRegion: parsed.ssoRegion,
        ssoAccountId: parsed.ssoAccountId,
        ssoRoleName: parsed.ssoRoleName,
        mfaSerial: parsed.mfaSerial,
        roleArn: parsed.roleArn,
        externalId: parsed.externalId,
        roleSessionName: parsed.roleSessionName
      });
      toast.success(t("AWS account updated."));
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error, "Failed to update AWS account."));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("Edit AWS Account")}</DialogTitle>
          <DialogDescription>
            {t(
              "Account name is locked. You can change authentication method, credentials, and region."
            )}
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={save}>
          <Field label={t("Account Name")}>
            <Input
              value={account?.name ?? ""}
              readOnly
              disabled
              aria-label={t("Account Name (locked)")}
            />
            <p className="text-xs text-muted-foreground">
              {t("Account name cannot be changed after creation.")}
            </p>
          </Field>
          <Field label={t("Authentication")}>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              {...form.register("authMethod")}
            >
              {AUTH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.label)}
                </option>
              ))}
            </select>
          </Field>

          {showCredentialEditors && (
            <>
              {credentialsEditable ? (
                <>
                  <Field label={t("Access Key ID")}>
                    <Input
                      placeholder={
                        account?.accessKeyIdMasked
                          ? t("Current {masked} — enter a new Access Key ID to replace", {
                              masked: account.accessKeyIdMasked
                            })
                          : t("AKIAxxxxxxxx (IAM user access key ID)")
                      }
                      {...form.register("accessKeyId")}
                      aria-invalid={Boolean(form.formState.errors.accessKeyId)}
                    />
                    <FieldError>{form.formState.errors.accessKeyId?.message}</FieldError>
                  </Field>
                  <Field label={t("Secret Access Key")}>
                    <Input
                      type="password"
                      placeholder={
                        switchingFromSso
                          ? t("Secret key paired with the access key")
                          : t("Enter new secret (leave blank with Access Key ID empty to keep)")
                      }
                      {...form.register("secretAccessKey")}
                      aria-invalid={Boolean(form.formState.errors.secretAccessKey)}
                    />
                    <FieldError>{form.formState.errors.secretAccessKey?.message}</FieldError>
                  </Field>
                </>
              ) : (
                <>
                  <Field label={t("Access Key ID")}>
                    <div className="flex gap-2">
                      <Input
                        value={account?.accessKeyIdMasked ?? ""}
                        readOnly
                        disabled
                        aria-label={t("Access Key ID (masked)")}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => form.setValue("credentialsUnlocked", true)}
                      >
                        {t("Change")}
                      </Button>
                    </div>
                  </Field>
                  <Field label={t("Secret Access Key")}>
                    <Input
                      value="••••••••••••••••"
                      readOnly
                      disabled
                      aria-label={t("Secret Access Key (masked)")}
                    />
                  </Field>
                </>
              )}
            </>
          )}

          {authMethod === "sso" && (
            <>
              <Field label={t("SSO start URL")}>
                <Input
                  placeholder={t("https://my-org.awsapps.com/start")}
                  {...form.register("ssoStartUrl")}
                />
                <FieldError>{form.formState.errors.ssoStartUrl?.message}</FieldError>
              </Field>
              <Field label={t("SSO account ID")}>
                <Input
                  placeholder={t("12-digit AWS account ID, e.g. 123456789012")}
                  {...form.register("ssoAccountId")}
                />
                <FieldError>{form.formState.errors.ssoAccountId?.message}</FieldError>
              </Field>
              <Field label={t("SSO role name")}>
                <Input
                  placeholder={t("Permission set / role name, e.g. AdministratorAccess")}
                  {...form.register("ssoRoleName")}
                />
                <FieldError>{form.formState.errors.ssoRoleName?.message}</FieldError>
              </Field>
            </>
          )}

          {authMethod === "mfaSession" ? (
            <p className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              {t(
                "IAM User + MFA uses sts:GetSessionToken. API calls still run as that IAM user (ASIA temporary keys). If EMR permissions are on a role, choose Assume Role and set MFA there instead."
              )}
            </p>
          ) : null}

          {(authMethod === "mfaSession" || authMethod === "assumeRole") && (
            <Field label={t("MFA serial / ARN")}>
              <Input
                placeholder={t("arn:aws:iam::123456789012:mfa/username")}
                {...form.register("mfaSerial")}
              />
              <FieldError>{form.formState.errors.mfaSerial?.message}</FieldError>
            </Field>
          )}

          {authMethod === "assumeRole" && (
            <>
              <Field label={t("Role ARN")}>
                <Input
                  placeholder={t("arn:aws:iam::123456789012:role/MyRole")}
                  {...form.register("roleArn")}
                />
                <FieldError>{form.formState.errors.roleArn?.message}</FieldError>
              </Field>
              <Field label={t("External ID (optional)")}>
                <Input
                  placeholder={t("External ID required by the role trust policy")}
                  {...form.register("externalId")}
                />
              </Field>
              <Field label={t("Role session name (optional)")}>
                <Input
                  placeholder={t("Session name shown in CloudTrail, e.g. emr-management-tool")}
                  {...form.register("roleSessionName")}
                />
              </Field>
            </>
          )}

          <Field label={t("Region")}>
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
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={testAccount.isPending || !account} onClick={testConnection}>
              <ShieldCheck data-icon="inline-start" />
              {testAccount.isPending ? t("Testing...") : t("Test Connection")}
            </Button>
            <Button type="submit" disabled={updateAccount.isPending || !account}>
              <Save data-icon="inline-start" />
              {updateAccount.isPending ? t("Saving...") : t("Save Changes")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
