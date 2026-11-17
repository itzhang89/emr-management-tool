import { z } from "zod";
import { isAwsRegionFormat, normalizeAwsRegion } from "@/constants/awsRegions";
import type { AwsAuthMethod } from "@/types/domain";

const regionSchema = z
  .string()
  .trim()
  .min(1, "Region is required.")
  .transform(normalizeAwsRegion)
  .refine(isAwsRegionFormat, "Use a valid AWS region code, e.g. eu-central-1.");

export const authMethodSchema = z.enum(["accessKey", "sso", "mfaSession", "assumeRole"]);

function needsStaticCredentials(authMethod: AwsAuthMethod) {
  return authMethod === "accessKey" || authMethod === "mfaSession" || authMethod === "assumeRole";
}

export const credentialSchema = z
  .object({
    name: z.string().trim().min(1, "Account name is required."),
    authMethod: authMethodSchema,
    accessKeyId: z.string(),
    secretAccessKey: z.string(),
    region: regionSchema,
    makeActive: z.boolean(),
    ssoStartUrl: z.string(),
    ssoRegion: z.string(),
    ssoAccountId: z.string(),
    ssoRoleName: z.string(),
    mfaSerial: z.string(),
    roleArn: z.string(),
    externalId: z.string(),
    roleSessionName: z.string()
  })
  .superRefine((values, ctx) => {
    if (needsStaticCredentials(values.authMethod)) {
      if (!values.accessKeyId.trim()) {
        ctx.addIssue({ code: "custom", path: ["accessKeyId"], message: "Access Key ID is required." });
      }
      if (!values.secretAccessKey.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["secretAccessKey"],
          message: "Secret Access Key is required."
        });
      }
    }
    if (values.authMethod === "sso") {
      if (!values.ssoStartUrl.trim()) {
        ctx.addIssue({ code: "custom", path: ["ssoStartUrl"], message: "SSO start URL is required." });
      }
      if (!values.ssoAccountId.trim()) {
        ctx.addIssue({ code: "custom", path: ["ssoAccountId"], message: "SSO account ID is required." });
      }
      if (!values.ssoRoleName.trim()) {
        ctx.addIssue({ code: "custom", path: ["ssoRoleName"], message: "SSO role name is required." });
      }
    }
    if (values.authMethod === "mfaSession" && !values.mfaSerial.trim()) {
      ctx.addIssue({ code: "custom", path: ["mfaSerial"], message: "MFA serial / ARN is required." });
    }
    if (values.authMethod === "assumeRole" && !values.roleArn.trim()) {
      ctx.addIssue({ code: "custom", path: ["roleArn"], message: "Role ARN is required." });
    }
  });

export const editAccountSchema = z
  .object({
    name: z.string().trim().min(1, "Account name is required."),
    authMethod: authMethodSchema,
    accessKeyId: z.string().default(""),
    secretAccessKey: z.string().default(""),
    region: regionSchema,
    ssoStartUrl: z.string().default(""),
    ssoRegion: z.string().default(""),
    ssoAccountId: z.string().default(""),
    ssoRoleName: z.string().default(""),
    mfaSerial: z.string().default(""),
    roleArn: z.string().default(""),
    externalId: z.string().default(""),
    roleSessionName: z.string().default(""),
    /** When true, the user opted to replace the stored access key pair. */
    credentialsUnlocked: z.boolean().default(false),
    originalAuthMethod: authMethodSchema
  })
  .superRefine((values, ctx) => {
    const switchingFromSso =
      values.originalAuthMethod === "sso" && values.authMethod !== "sso";

    if (needsStaticCredentials(values.authMethod)) {
      const accessKey = values.accessKeyId.trim();
      const secret = values.secretAccessKey.trim();
      if (switchingFromSso) {
        if (!accessKey) {
          ctx.addIssue({
            code: "custom",
            path: ["accessKeyId"],
            message: "Access Key ID is required."
          });
        }
        if (!secret) {
          ctx.addIssue({
            code: "custom",
            path: ["secretAccessKey"],
            message: "Secret Access Key is required."
          });
        }
      } else if (values.credentialsUnlocked && Boolean(accessKey) !== Boolean(secret)) {
        ctx.addIssue({
          code: "custom",
          path: accessKey ? ["secretAccessKey"] : ["accessKeyId"],
          message:
            "Provide both Access Key ID and Secret Access Key, or leave both blank to keep the stored pair."
        });
      }
    }

    if (values.authMethod === "sso") {
      if (!values.ssoStartUrl.trim()) {
        ctx.addIssue({ code: "custom", path: ["ssoStartUrl"], message: "SSO start URL is required." });
      }
      if (!values.ssoAccountId.trim()) {
        ctx.addIssue({ code: "custom", path: ["ssoAccountId"], message: "SSO account ID is required." });
      }
      if (!values.ssoRoleName.trim()) {
        ctx.addIssue({ code: "custom", path: ["ssoRoleName"], message: "SSO role name is required." });
      }
    }
    if (values.authMethod === "mfaSession" && !values.mfaSerial.trim()) {
      ctx.addIssue({ code: "custom", path: ["mfaSerial"], message: "MFA serial / ARN is required." });
    }
    if (values.authMethod === "assumeRole" && !values.roleArn.trim()) {
      ctx.addIssue({ code: "custom", path: ["roleArn"], message: "Role ARN is required." });
    }
  })
  .transform((values) => {
    const trimmedAccessKey = values.accessKeyId.trim();
    const trimmedSecret = values.secretAccessKey.trim();
    return {
      name: values.name,
      authMethod: values.authMethod,
      region: values.region,
      accessKeyId: trimmedAccessKey.length > 0 ? trimmedAccessKey : undefined,
      secretAccessKey: trimmedSecret.length > 0 ? trimmedSecret : undefined,
      ssoStartUrl: values.ssoStartUrl.trim() || undefined,
      ssoRegion: values.ssoRegion.trim() || undefined,
      ssoAccountId: values.ssoAccountId.trim() || undefined,
      ssoRoleName: values.ssoRoleName.trim() || undefined,
      mfaSerial: values.mfaSerial.trim() || undefined,
      roleArn: values.roleArn.trim() || undefined,
      externalId: values.externalId.trim() || undefined,
      roleSessionName: values.roleSessionName.trim() || undefined
    };
  });

export type CredentialFormValues = z.infer<typeof credentialSchema>;
export type EditAccountFormValues = z.input<typeof editAccountSchema>;
export type EditAccountSubmitValues = z.output<typeof editAccountSchema>;

export function authMethodLabel(method: AwsAuthMethod | undefined): string {
  switch (method) {
    case "sso":
      return "SSO";
    case "mfaSession":
      return "MFA Session";
    case "assumeRole":
      return "Assume Role";
    case "accessKey":
    default:
      return "Access Key";
  }
}

export function toCreateAccountRequest(values: CredentialFormValues) {
  return {
    name: values.name,
    authMethod: values.authMethod,
    accessKeyId: values.accessKeyId.trim(),
    secretAccessKey: values.secretAccessKey.trim(),
    region: values.region,
    makeActive: values.makeActive,
    ssoStartUrl: values.ssoStartUrl.trim() || undefined,
    ssoRegion: values.ssoRegion.trim() || values.region,
    ssoAccountId: values.ssoAccountId.trim() || undefined,
    ssoRoleName: values.ssoRoleName.trim() || undefined,
    mfaSerial: values.mfaSerial.trim() || undefined,
    roleArn: values.roleArn.trim() || undefined,
    externalId: values.externalId.trim() || undefined,
    roleSessionName: values.roleSessionName.trim() || undefined
  };
}
