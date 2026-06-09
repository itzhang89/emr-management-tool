import type { AwsCredentialsInput } from "@/types/domain";
import { tauriClient } from "./tauriClient";

export const awsCredentialsService = {
  getSettings: () => tauriClient.getAwsSettings(),
  testConnection: (credentials: AwsCredentialsInput) => tauriClient.testAwsCredentials(credentials),
  save: (credentials: AwsCredentialsInput) => tauriClient.saveAwsCredentials(credentials),
  clear: () => tauriClient.clearAwsCredentials()
};
