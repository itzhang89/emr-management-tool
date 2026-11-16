import type {
  AwsAccountCredentialsInput,
  AwsAccountUpdateInput,
  AwsCredentialsInput,
  ImportAwsCliProfileRequest,
  TestAwsAccountRequest
} from "@/types/domain";
import { tauriClient } from "./tauriClient";

export const awsCredentialsService = {
  getSettings: () => tauriClient.getAwsSettings(),
  listAccounts: () => tauriClient.listAwsAccounts(),
  listCliProfiles: () => tauriClient.listAwsCliProfiles(),
  createAccount: (account: AwsAccountCredentialsInput) => tauriClient.createAwsAccount(account),
  renameAccount: (accountId: string, name: string) => tauriClient.renameAwsAccount({ accountId, name }),
  updateAccount: (account: AwsAccountUpdateInput) => tauriClient.updateAwsAccount(account),
  importCliProfile: (request: ImportAwsCliProfileRequest) => tauriClient.importAwsCliProfile(request),
  loadCliProfile: (profileName: string) => tauriClient.loadAwsCliProfile({ profileName }),
  setActiveAccount: (accountId: string) => tauriClient.setActiveAwsAccount({ accountId }),
  deleteAccount: (accountId: string) => tauriClient.deleteAwsAccount({ accountId }),
  testConnection: (credentials: AwsCredentialsInput) => tauriClient.testAwsCredentials(credentials),
  testAccountConnection: (request: TestAwsAccountRequest) => tauriClient.testAwsAccount(request),
  getAuthStatus: (accountId: string) => tauriClient.getAwsAccountAuthStatus({ accountId }),
  startSsoLogin: (accountId: string) => tauriClient.startAwsSsoLogin({ accountId }),
  cancelSsoLogin: (accountId: string) => tauriClient.cancelAwsSsoLogin({ accountId }),
  signOutSso: (accountId: string) => tauriClient.signOutAwsSso({ accountId }),
  submitMfaCode: (accountId: string, tokenCode: string) =>
    tauriClient.submitAwsMfaCode({ accountId, tokenCode }),
  save: (credentials: AwsCredentialsInput) => tauriClient.saveAwsCredentials(credentials),
  clear: () => tauriClient.clearAwsCredentials()
};
