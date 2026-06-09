import { z } from "zod";

export const credentialSchema = z.object({
  accessKeyId: z.string().trim().min(1, "Access Key ID is required."),
  secretAccessKey: z.string().trim().min(1, "Secret Access Key is required."),
  region: z.string().trim().min(1, "Region is required.")
});

export type CredentialFormValues = z.infer<typeof credentialSchema>;
