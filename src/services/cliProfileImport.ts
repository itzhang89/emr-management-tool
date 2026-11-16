import type { AwsAccountSummary, AwsCliProfileSummary } from "@/types/domain";

type ProfileNameRef = Pick<AwsCliProfileSummary, "profileName">;
type AccountNameRef = Pick<AwsAccountSummary, "name">;

function normalizeAccountName(value: string | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

/**
 * Returns the already-configured account that uses the same display name as this
 * CLI profile. Uniqueness is by account name across all auth methods — the same
 * access key may legitimately appear on multiple accounts.
 */
export function findAccountForProfileName(
  profile: ProfileNameRef,
  accounts: Array<AccountNameRef>
): AccountNameRef | null {
  const profileName = normalizeAccountName(profile.profileName);
  if (!profileName) return null;
  return accounts.find((account) => normalizeAccountName(account.name) === profileName) ?? null;
}

/** @deprecated Prefer findAccountForProfileName — kept as an alias for call sites. */
export const findAccountForProfileKey = findAccountForProfileName;

/** Returns true when Import should open the add-account dialog instead of importing silently. */
export function shouldPromptCliImport(
  profile: Pick<AwsCliProfileSummary, "profileName" | "region">,
  accounts: Array<Pick<AwsAccountSummary, "name">>
): boolean {
  const missingRegion = !profile.region?.trim();
  const nameTaken = Boolean(findAccountForProfileName(profile, accounts));
  return missingRegion || nameTaken;
}

export function cliImportPromptReason(
  profile: Pick<AwsCliProfileSummary, "profileName" | "region">,
  accounts: Array<Pick<AwsAccountSummary, "name">>
): string | null {
  const missingRegion = !profile.region?.trim();
  const nameTaken = Boolean(findAccountForProfileName(profile, accounts));
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
