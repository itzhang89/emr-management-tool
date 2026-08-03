import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
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
import {
  useCreateAwsAccount,
  useTestAwsAccount,
  useTestAwsCredentials,
  useUpdateAwsAccount
} from "@/hooks/useAwsSettings";
import {
  credentialSchema,
  editAccountSchema,
  type CredentialFormValues,
  type EditAccountFormValues,
  type EditAccountSubmitValues
} from "@/services/credentialValidation";
import type { AwsAccountSummary } from "@/types/domain";

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
  const createAccount = useCreateAwsAccount();
  const testCredentials = useTestAwsCredentials();
  const [showSecret, setShowSecret] = useState(false);
  const emptyValues: CredentialFormValues = {
    name: "",
    accessKeyId: "",
    secretAccessKey: "",
    region: "",
    makeActive: true
  };
  const form = useForm<CredentialFormValues>({
    resolver: zodResolver(credentialSchema),
    defaultValues: emptyValues
  });

  useEffect(() => {
    if (!open) return;
    setShowSecret(false);
    form.reset({
      ...emptyValues,
      ...defaults,
      name: defaults?.name ?? "",
      accessKeyId: defaults?.accessKeyId ?? "",
      secretAccessKey: defaults?.secretAccessKey ?? "",
      region: defaults?.region?.trim() ? defaults.region : "",
      makeActive: defaults?.makeActive ?? true
    });
  }, [open, defaults, form]);

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
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error, "Failed to save AWS account."));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{defaults?.title ?? "Add AWS Account"}</DialogTitle>
          <DialogDescription>
            {defaults?.description ?? "Create a named access-key account for EMR, CloudWatch, and S3."}
          </DialogDescription>
        </DialogHeader>
        {defaults?.notice ? (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-foreground">{defaults.notice}</p>
        ) : null}
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
            <div className="relative">
              <Input
                type={showSecret ? "text" : "password"}
                placeholder="••••••••••••••••"
                className="pr-10"
                {...form.register("secretAccessKey")}
                aria-invalid={Boolean(form.formState.errors.secretAccessKey)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-10 w-10 text-muted-foreground hover:text-foreground"
                aria-label={showSecret ? "Hide secret access key" : "Show secret access key"}
                onClick={() => setShowSecret((visible) => !visible)}
              >
                {showSecret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
            </div>
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
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={testCredentials.isPending} onClick={testConnection}>
              <ShieldCheck data-icon="inline-start" />
              {testCredentials.isPending ? "Testing..." : "Test Connection"}
            </Button>
            <Button type="submit" disabled={createAccount.isPending}>
              <Save data-icon="inline-start" />
              {createAccount.isPending ? "Saving..." : "Save Account"}
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
  const updateAccount = useUpdateAwsAccount();
  const testAccount = useTestAwsAccount();
  const [secretUnlocked, setSecretUnlocked] = useState(false);
  const form = useForm<EditAccountFormValues>({
    resolver: zodResolver(editAccountSchema),
    defaultValues: {
      name: "",
      region: "us-east-1",
      secretAccessKey: ""
    }
  });

  useEffect(() => {
    if (!open || !account) return;
    setSecretUnlocked(false);
    form.reset({
      name: account.name,
      region: account.region,
      secretAccessKey: ""
    });
  }, [open, account, form]);

  const testConnection = form.handleSubmit(async (values) => {
    if (!account) return;
    const parsed = values as EditAccountSubmitValues;
    try {
      const identity = await testAccount.mutateAsync({
        accountId: account.id,
        region: parsed.region,
        secretAccessKey: secretUnlocked ? parsed.secretAccessKey : undefined
      });
      toast.success(`Connected to AWS account ${identity.account}`);
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
        name: parsed.name,
        region: parsed.region,
        secretAccessKey: secretUnlocked ? parsed.secretAccessKey : undefined
      });
      toast.success("AWS account updated.");
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error, "Failed to update AWS account."));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit AWS Account</DialogTitle>
          <DialogDescription>
            Update the display name and region. Access Key cannot be changed here; unlock Secret only when rotating the
            secret for the same key. To replace the full key pair, delete the account and add a new one.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={save}>
          <Field label="Account Name">
            <Input placeholder="Production analytics" {...form.register("name")} aria-invalid={Boolean(form.formState.errors.name)} />
            <FieldError>{form.formState.errors.name?.message}</FieldError>
          </Field>
          <Field label="Access Key ID">
            <Input value={account?.accessKeyIdMasked ?? ""} readOnly disabled aria-label="Access Key ID (read-only)" />
          </Field>
          <Field label="Secret Access Key">
            {secretUnlocked ? (
              <Input
                type="password"
                placeholder="Enter new secret to update"
                {...form.register("secretAccessKey")}
                aria-invalid={Boolean(form.formState.errors.secretAccessKey)}
              />
            ) : (
              <div className="flex gap-2">
                <Input value="••••••••••••••••" readOnly disabled aria-label="Secret Access Key (masked)" />
                <Button type="button" variant="outline" onClick={() => setSecretUnlocked(true)}>
                  Change
                </Button>
              </div>
            )}
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
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={testAccount.isPending || !account} onClick={testConnection}>
              <ShieldCheck data-icon="inline-start" />
              {testAccount.isPending ? "Testing..." : "Test Connection"}
            </Button>
            <Button type="submit" disabled={updateAccount.isPending || !account}>
              <Save data-icon="inline-start" />
              {updateAccount.isPending ? "Saving..." : "Save Changes"}
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
