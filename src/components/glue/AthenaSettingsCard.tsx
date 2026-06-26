import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAthenaWorkgroups } from "@/hooks/useAthena";
import { useActiveAwsAccount } from "@/hooks/useAwsSettings";
import { mergeAthenaPreferences, readAthenaPreferences } from "@/services/athenaPreferencesStorage";

export function AthenaSettingsCard() {
  const activeAccount = useActiveAwsAccount();
  const accountId = activeAccount.data?.id;
  const workgroups = useAthenaWorkgroups();
  const [defaultWorkgroup, setDefaultWorkgroup] = useState("primary");
  const [outputBasePath, setOutputBasePath] = useState("");

  useEffect(() => {
    if (!accountId) return;
    const preferences = readAthenaPreferences(accountId);
    setDefaultWorkgroup(preferences.defaultWorkgroup ?? "primary");
    setOutputBasePath(preferences.outputBasePath ?? "");
  }, [accountId]);

  if (!accountId) {
    return null;
  }

  const workgroupOptions = Array.from(
    new Set([defaultWorkgroup, ...(workgroups.data ?? []).map((entry) => entry.name)])
  ).sort((left, right) => left.localeCompare(right));

  const persist = (patch: { defaultWorkgroup?: string; outputBasePath?: string }) => {
    mergeAthenaPreferences(accountId, patch);
    toast.success("Athena settings saved.");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Athena Defaults</CardTitle>
        <CardDescription>
          Per-account defaults for the Data Catalog page on {activeAccount.data?.name}. Workgroups are discovered from
          AWS automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="settings-athena-workgroup">Default workgroup</Label>
          <Select
            value={defaultWorkgroup}
            onValueChange={(value) => {
              setDefaultWorkgroup(value);
              persist({ defaultWorkgroup: value });
            }}
          >
            <SelectTrigger id="settings-athena-workgroup">
              <SelectValue placeholder="Workgroup" />
            </SelectTrigger>
            <SelectContent>
              {workgroupOptions.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="settings-athena-output">Default results S3 path</Label>
          <Input
            id="settings-athena-output"
            value={outputBasePath}
            onChange={(event) => setOutputBasePath(event.target.value)}
            onBlur={() => persist({ outputBasePath })}
            placeholder="s3://bucket/athena-results/"
            className="font-mono text-sm"
          />
        </div>
      </CardContent>
    </Card>
  );
}
