import type { AwsAccountCredentialsInput, AwsCredentialsInput, ImportAwsCliProfileRequest } from "@/types/domain";
import { tauriClient } from "./tauriClient";

export const awsCredentialsService = {
  getSettings: () => tauriClient.getAwsSettings(),
  listAccounts: () => tauriClient.listAwsAccounts(),
  listCliProfiles: () => tauriClient.listAwsCliProfiles(),
  createAccount: (account: AwsAccountCredentialsInput) => tauriClient.createAwsAccount(account),
  importCliProfile: (request: ImportAwsCliProfileRequest) => tauriClient.importAwsCliProfile(request),
  setActiveAccount: (accountId: string) => tauriClient.setActiveAwsAccount({ accountId }),
  deleteAccount: (accountId: string) => tauriClient.deleteAwsAccount({ accountId }),
  testConnection: (credentials: AwsCredentialsInput) => tauriClient.testAwsCredentials(credentials),
  save: (credentials: AwsCredentialsInput) => tauriClient.saveAwsCredentials(credentials),
  clear: () => tauriClient.clearAwsCredentials()
};
