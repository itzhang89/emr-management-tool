import type { AppError } from "@/types/domain";

export interface AwsErrorContext {
  operation?: string;
  resource?: string;
}

function asAppError(error: unknown): Partial<AppError> {
  if (error && typeof error === "object") {
    return error as Partial<AppError>;
  }
  return {};
}

function isGenericAwsMessage(message: string) {
  return /^(service error|dispatch failure|request has timed out|failed to construct request|response error)$/i.test(
    message.trim()
  );
}

function formatAwsAccessDenied(service: string | undefined, context?: AwsErrorContext) {
  switch (service) {
    case "s3":
      return context?.operation === "listBuckets"
        ? "Access denied when listing S3 buckets. Grant s3:ListAllMyBuckets (and s3:ListBucket for specific buckets) to this account in IAM, then verify the region in Settings."
        : context?.operation === "listObjects"
          ? `Access denied when listing objects${context.resource ? ` in ${context.resource}` : ""}. Grant s3:ListBucket to this account in IAM.`
          : "Access denied for S3. Grant the required s3:* permissions to this account in IAM and verify the region in Settings.";
    case "emr-containers":
      return "Access denied for EMR on EKS. Check IAM permissions for emr-containers actions on this account.";
    case "cloudwatchlogs":
      return "Access denied for CloudWatch Logs. Check IAM permissions for logs:FilterLogEvents and related actions.";
    case "sts":
      return "Access denied when validating AWS credentials. Ensure sts:GetCallerIdentity is allowed for this account.";
    default:
      return "Access denied. Check IAM permissions for the active AWS account in Settings.";
  }
}

function formatAwsErrorCode(code: string, service: string | undefined, context?: AwsErrorContext) {
  switch (code) {
    case "AccessDenied":
    case "AccessDeniedException":
      return formatAwsAccessDenied(service, context);
    case "InvalidAccessKeyId":
      return "Invalid AWS Access Key ID. Verify the credentials saved for this account in Settings.";
    case "SignatureDoesNotMatch":
      return "AWS secret access key does not match the access key ID. Update the account credentials in Settings.";
    case "ExpiredToken":
    case "InvalidToken":
    case "TokenRefreshRequired":
      return "AWS session token has expired. Update the temporary credentials for this account in Settings.";
    case "NoSuchBucket":
      return "The S3 bucket does not exist or is not accessible in the configured region.";
    case "PermanentRedirect":
      return context?.operation === "listObjects" && context.resource
        ? `S3 bucket ${context.resource} is in a different AWS region than the active account. The app will retry with the bucket region automatically; if this persists, update the account region in Settings.`
        : "S3 bucket is in a different AWS region than the active account. Update the account region in Settings or reopen the bucket after listing buckets.";
    case "NoSuchKey":
      return "The S3 object does not exist.";
    case "UnauthorizedOperation":
      return "This AWS account is not authorized for this operation. Check IAM permissions in Settings.";
    default:
      return undefined;
  }
}

function formatGenericAwsFailure(service: string | undefined, message: string, context?: AwsErrorContext) {
  if (!isGenericAwsMessage(message)) {
    return message;
  }

  if (service === "s3") {
    if (context?.operation === "listBuckets") {
      return "Failed to list S3 buckets. Check IAM permissions (s3:ListAllMyBuckets), credentials, and region in Settings.";
    }
    if (context?.operation === "listObjects") {
      return `Failed to list S3 objects${context.resource ? ` in ${context.resource}` : ""}. Check IAM permissions (s3:ListBucket) and bucket region.`;
    }
    return "Failed to reach S3. Check account permissions, credentials, and region in Settings.";
  }

  if (message === "request has timed out") {
    return `AWS ${service ?? "service"} request timed out. Try again.`;
  }
  if (message === "dispatch failure") {
    return `Could not connect to AWS ${service ?? "service"}. Check network connectivity.`;
  }

  return `AWS ${service ?? "service"} request failed. Check account permissions and region in Settings.`;
}

export function formatAppError(error: unknown, fallback: string, context?: AwsErrorContext) {
  const appError = asAppError(error);

  if (appError.code === "DemoModeUnavailable") {
    return appError.message ?? fallback;
  }

  if (appError.kind === "aws") {
    const rawMessage = appError.message?.trim();
    if (rawMessage && !isGenericAwsMessage(rawMessage)) {
      if (/specified endpoint/i.test(rawMessage)) {
        return formatAwsErrorCode("PermanentRedirect", appError.service, context)
          ?? "S3 bucket is in a different AWS region than the active account. Update the account region in Settings.";
      }
      return rawMessage;
    }

    if (appError.code) {
      const byCode = formatAwsErrorCode(appError.code, appError.service, context);
      if (byCode) return byCode;
    }

    if (rawMessage) {
      return formatGenericAwsFailure(appError.service, rawMessage, context);
    }
  }

  return appError.message ?? fallback;
}

export function formatS3BrowserError(error: unknown, operation: "listBuckets" | "listObjects", resource?: string) {
  const fallback =
    operation === "listBuckets" ? "Failed to load S3 buckets." : "Failed to load S3 objects.";
  const demoFallback =
    operation === "listBuckets"
      ? "S3 requires the Tauri desktop runtime. Start with npm run tauri -- dev."
      : fallback;

  const appError = asAppError(error);
  if (appError.code === "DemoModeUnavailable") {
    return demoFallback;
  }

  return formatAppError(error, fallback, { operation, resource });
}
