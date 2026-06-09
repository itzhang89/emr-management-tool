import { KeyRound, Save, ShieldCheck } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSaveAwsCredentials, useTestAwsCredentials } from "@/hooks/useAwsSettings";
import { credentialSchema, type CredentialFormValues } from "@/services/credentialValidation";

const regions = ["us-east-1", "us-west-2", "ap-southeast-1", "ap-northeast-1", "eu-west-1"];

export function SettingsPage() {
  const saveCredentials = useSaveAwsCredentials();
  const testCredentials = useTestAwsCredentials();
  const form = useForm<CredentialFormValues>({
    resolver: zodResolver(credentialSchema),
    defaultValues: {
      accessKeyId: "",
      secretAccessKey: "",
      region: "us-east-1"
    }
  });

  const testConnection = form.handleSubmit(async (values) => {
    try {
      const identity = await testCredentials.mutateAsync(values);
      toast.success(`Connected to AWS account ${identity.account}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "AWS connection test failed.");
    }
  });

  const save = form.handleSubmit(async (values) => {
    try {
      await saveCredentials.mutateAsync(values);
      toast.success("AWS credentials saved.");
      form.reset({ ...values, secretAccessKey: "" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save AWS credentials.");
    }
  });

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage access-key based AWS credentials for this desktop app.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>AWS Credentials</CardTitle>
          <CardDescription>Credentials are saved through the Tauri backend, not in frontend state.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={save}>
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
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select region" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {regions.map((region) => (
                        <SelectItem key={region} value={region}>
                          {region}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError>{form.formState.errors.region?.message}</FieldError>
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" disabled={testCredentials.isPending} onClick={testConnection}>
              <ShieldCheck data-icon="inline-start" />
              {testCredentials.isPending ? "Testing..." : "Test Connection"}
            </Button>
            <Button type="submit" disabled={saveCredentials.isPending}>
              <Save data-icon="inline-start" />
              {saveCredentials.isPending ? "Saving..." : "Save Credential"}
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
