import type { AwsAccountCredentialsInput, AwsCredentialsInput } from "@/types/domain";
import { tauriClient } from "./tauriClient";

export const awsCredentialsService = {
  getSettings: () => tauriClient.getAwsSettings(),
  listAccounts: () => tauriClient.listAwsAccounts(),
  createAccount: (account: AwsAccountCredentialsInput) => tauriClient.createAwsAccount(account),
  setActiveAccount: (accountId: string) => tauriClient.setActiveAwsAccount({ accountId }),
  deleteAccount: (accountId: string) => tauriClient.deleteAwsAccount({ accountId }),
  testConnection: (credentials: AwsCredentialsInput) => tauriClient.testAwsCredentials(credentials),
  save: (credentials: AwsCredentialsInput) => tauriClient.saveAwsCredentials(credentials),
  clear: () => tauriClient.clearAwsCredentials()
};
