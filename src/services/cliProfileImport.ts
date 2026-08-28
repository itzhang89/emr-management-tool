import type { AwsAccountSummary, AwsCliProfileSummary } from "@/types/domain";

type ProfileKeyRef = Pick<AwsCliProfileSummary, "accessKeyIdMasked">;
type AccountKeyRef = Pick<AwsAccountSummary, "name" | "accessKeyIdMasked">;

function normalizeMaskedKey(value: string | undefined) {
  return value?.trim().toUpperCase() ?? "";
}

/**
 * Returns the already-configured account that uses the same access key as this
 * profile, or null. Backend and frontend mask keys identically (first four plus
 * last four characters), so masked values compare directly and no full secret
 * has to reach the renderer.
 */
export function findAccountForProfileKey(
  profile: ProfileKeyRef,
  accounts: Array<AccountKeyRef>
): AccountKeyRef | null {
  const profileKey = normalizeMaskedKey(profile.accessKeyIdMasked);
  if (!profileKey) return null;
  return accounts.find((account) => normalizeMaskedKey(account.accessKeyIdMasked) === profileKey) ?? null;
}

/** Returns true when Import should open the add-account dialog instead of importing silently. */
export function shouldPromptCliImport(
  profile: Pick<AwsCliProfileSummary, "profileName" | "region">,
  accounts: Array<Pick<AwsAccountSummary, "name">>
): boolean {
  const missingRegion = !profile.region?.trim();
  const nameTaken = accounts.some((account) => account.name.trim() === profile.profileName.trim());
  return missingRegion || nameTaken;
}

export function cliImportPromptReason(
  profile: Pick<AwsCliProfileSummary, "profileName" | "region">,
  accounts: Array<Pick<AwsAccountSummary, "name">>
): string | null {
  const missingRegion = !profile.region?.trim();
  const nameTaken = accounts.some((account) => account.name.trim() === profile.profileName.trim());
  if (nameTaken && missingRegion) {
    return `An account named "${profile.profileName}" already exists, and this profile has no region. Rename the account and choose a region before importing.`;
  }
  if (nameTaken) {
    return `An account named "${profile.profileName}" already exists. Rename it before importing.`;
  }
  if (missingRegion) {
    return "This profile has no region. Choose a region before importing.";
  }
  return null;
}
