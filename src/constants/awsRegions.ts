export const awsRegions = [
  "us-east-1",
  "us-west-2",
  "eu-west-1",
  "eu-central-1",
  "ap-southeast-1",
  "ap-northeast-1"
] as const;

export type AwsRegion = (typeof awsRegions)[number];
