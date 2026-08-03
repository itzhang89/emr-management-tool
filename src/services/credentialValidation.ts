import { z } from "zod";
import { isAwsRegionFormat, normalizeAwsRegion } from "@/constants/awsRegions";

const regionSchema = z
  .string()
  .trim()
  .min(1, "Region is required.")
  .transform(normalizeAwsRegion)
  .refine(isAwsRegionFormat, "Use a valid AWS region code, e.g. eu-central-1.");

export const credentialSchema = z.object({
  name: z.string().trim().min(1, "Account name is required."),
  accessKeyId: z.string().trim().min(1, "Access Key ID is required."),
  secretAccessKey: z.string().trim().min(1, "Secret Access Key is required."),
  region: regionSchema,
  makeActive: z.boolean()
});

export const editAccountSchema = z.object({
  name: z.string().trim().min(1, "Account name is required."),
  region: regionSchema,
  secretAccessKey: z.string().default("")
}).transform((values) => {
  const trimmed = values.secretAccessKey.trim();
  return {
    name: values.name,
    region: values.region,
    secretAccessKey: trimmed.length > 0 ? trimmed : undefined
  };
});

export type CredentialFormValues = z.infer<typeof credentialSchema>;
export type EditAccountFormValues = z.input<typeof editAccountSchema>;
export type EditAccountSubmitValues = z.output<typeof editAccountSchema>;
