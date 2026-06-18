import { z } from "zod";
import { isAwsRegionFormat, normalizeAwsRegion } from "@/constants/awsRegions";

export const credentialSchema = z.object({
  name: z.string().trim().min(1, "Account name is required."),
  accessKeyId: z.string().trim().min(1, "Access Key ID is required."),
  secretAccessKey: z.string().trim().min(1, "Secret Access Key is required."),
  region: z
    .string()
    .trim()
    .min(1, "Region is required.")
    .transform(normalizeAwsRegion)
    .refine(isAwsRegionFormat, "Use a valid AWS region code, e.g. eu-central-1."),
  makeActive: z.boolean()
});

export type CredentialFormValues = z.infer<typeof credentialSchema>;
