import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAthenaWorkgroups } from "@/hooks/useAthena";
import { useAthenaAccountPreferences } from "@/hooks/useAthenaAccountPreferences";
import { useActiveAwsAccount } from "@/hooks/useAwsSettings";

export function AthenaSettingsCard() {
  const activeAccount = useActiveAwsAccount();
  const accountId = activeAccount.data?.id;
  const workgroups = useAthenaWorkgroups();
  const athenaPrefs = useAthenaAccountPreferences(accountId);
  const [defaultWorkgroup, setDefaultWorkgroup] = useState("primary");

  useEffect(() => {
    if (!accountId || !athenaPrefs.ready) return;
    setDefaultWorkgroup(athenaPrefs.preferences.defaultWorkgroup ?? "primary");
  }, [accountId, athenaPrefs.ready, athenaPrefs.preferences.defaultWorkgroup]);

  if (!accountId) {
    return null;
  }

  const workgroupOptions = Array.from(
    new Set([defaultWorkgroup, ...(workgroups.data ?? []).map((entry) => entry.name)])
  ).sort((left, right) => left.localeCompare(right));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Athena Defaults</CardTitle>
        <CardDescription>
          Per-account default workgroup for the Data Catalog page on {activeAccount.data?.name}. Workgroups are
          discovered from AWS automatically. Set the Athena results S3 path from the Data Catalog query bar.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="settings-athena-workgroup">Default workgroup</Label>
          <Select
            value={defaultWorkgroup}
            onValueChange={(value) => {
              setDefaultWorkgroup(value);
              athenaPrefs.updatePreferences({ defaultWorkgroup: value });
              toast.success("Athena settings saved.");
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
      </CardContent>
    </Card>
  );
}
