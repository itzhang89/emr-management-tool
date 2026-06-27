export function isAthenaOutputPathError(message: string | undefined): boolean {
  if (!message) return false;

  const lower = message.toLowerCase();
  return (
    lower.includes("output location") ||
    lower.includes("results location") ||
    lower.includes("query result location") ||
    lower.includes("s3 staging directory") ||
    lower.includes("unable to verify/create") ||
    (lower.includes("s3://") && lower.includes("access")) ||
    (lower.includes("bucket") && (lower.includes("not found") || lower.includes("does not exist"))) ||
    lower.includes("must be writable") ||
    lower.includes("invalid s3") ||
    lower.includes("no output location")
  );
}
