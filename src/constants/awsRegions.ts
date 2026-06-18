export const awsRegions = [
  "us-east-1",
  "us-west-2",
  "eu-west-1",
  "eu-central-1",
  "ap-southeast-1",
  "ap-northeast-1"
] as const;

export type AwsRegion = (typeof awsRegions)[number];

const awsRegionPattern = /^[a-z]{2}(?:-[a-z0-9]+)*-\d+$/;

export function normalizeAwsRegion(value: string) {
  return value.trim().toLowerCase();
}

export function isAwsRegionFormat(value: string) {
  const normalized = normalizeAwsRegion(value);
  return normalized.length > 0 && awsRegionPattern.test(normalized);
}
