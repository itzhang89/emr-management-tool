export function isLikelyEmrJobRunId(value: string) {
  const trimmed = value.trim();
  return /^job-[A-Za-z0-9-]+$/.test(trimmed) || /^[a-z0-9]{16,64}$/.test(trimmed);
}
