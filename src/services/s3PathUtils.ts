export function formatS3Path(bucket: string | undefined, prefix: string) {
  return bucket ? `s3://${bucket}/${prefix}` : "";
}

export function formatPathInput(bucket: string | undefined, prefix: string) {
  return bucket ? `${bucket}/${prefix}` : "";
}

export function parseS3PathInput(value: string) {
  const trimmed = value.trim();
  const withoutScheme = trimmed.startsWith("s3://") ? trimmed.slice("s3://".length) : trimmed;
  const match = /^([^/\s]+)\/?(.*)$/.exec(withoutScheme);
  if (!match) return undefined;
  const prefix = match[2] ?? "";
  return {
    bucket: match[1],
    prefix: prefix && !prefix.endsWith("/") ? `${prefix}/` : prefix
  };
}

export function parseS3Uri(value: string) {
  const parsed = parseS3PathInput(value);
  if (!parsed) return undefined;
  return {
    bucket: parsed.bucket,
    prefix: parsed.prefix
  };
}

export function parentPrefix(prefix: string) {
  const parent = prefix.split("/").filter(Boolean).slice(0, -1).join("/");
  return parent ? `${parent}/` : "";
}

export function displayObjectName(key: string, prefix: string, kind: "folder" | "file") {
  const relative = key.startsWith(prefix) ? key.slice(prefix.length) : key;
  if (kind === "folder") {
    const folderName = relative.split("/").filter(Boolean)[0] ?? relative;
    return `${folderName}/`;
  }
  return relative.split("/").filter(Boolean).at(-1) ?? relative;
}
