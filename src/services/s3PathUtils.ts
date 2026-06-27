export function formatS3Path(bucket: string | undefined, prefix: string) {
  return bucket ? `s3://${bucket}/${prefix}` : "";
}

export function formatCompactS3Path(bucket: string | undefined, prefix: string) {
  if (!bucket) return "s3://";
  const parts = prefix.split("/").filter(Boolean);
  if (parts.length <= 2) return formatS3Path(bucket, prefix);
  return `s3://${bucket}/.../${parts.slice(-2).join("/")}/`;
}

export function formatPathInput(bucket: string | undefined, prefix: string) {
  return bucket ? `${bucket}/${prefix}` : "";
}

export function validateS3FolderName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return "Folder name is required.";
  if (trimmed.includes("/")) return "Folder name cannot contain '/'.";
  if (trimmed.includes("\\")) return "Folder name cannot contain '\\'.";
  return undefined;
}

export function buildFolderKey(parentPrefix: string, folderName: string) {
  const normalizedParent = parentPrefix && !parentPrefix.endsWith("/") ? `${parentPrefix}/` : parentPrefix;
  return `${normalizedParent}${folderName.trim()}/`;
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

export type S3PathSuggestionContext =
  | { mode: "bucket"; needle: string }
  | { mode: "folder"; bucket: string; parentPrefix: string; needle: string };

export type S3PathOption =
  | { type: "bucket"; name: string; pathInput: string; label: string }
  | { type: "folder"; bucket: string; key: string; pathInput: string; label: string };

export const S3_PATH_SUGGESTION_LIMIT = 12;

export function stripS3Scheme(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith("s3://") ? trimmed.slice("s3://".length) : trimmed;
}

export function appendSlashForMatching(value: string) {
  const withoutScheme = stripS3Scheme(value);
  if (!withoutScheme || withoutScheme.endsWith("/")) return withoutScheme;
  return `${withoutScheme}/`;
}

export type S3PathEnterAction = "select-suggestion" | "navigate" | "noop";

export function resolvePathInputEnterAction(raw: string, suggestionCount: number): S3PathEnterAction {
  if (suggestionCount === 1) return "select-suggestion";
  if (suggestionCount > 1) return "noop";

  const withoutScheme = stripS3Scheme(raw.trim());
  if (!withoutScheme) return "noop";
  if (withoutScheme.endsWith("/")) return "navigate";
  return "noop";
}

export function parsePathInputForSuggestions(value: string): S3PathSuggestionContext {
  const withoutScheme = stripS3Scheme(value);
  const slashIndex = withoutScheme.indexOf("/");

  if (slashIndex === -1) {
    return { mode: "bucket", needle: withoutScheme.toLowerCase() };
  }

  const bucket = withoutScheme.slice(0, slashIndex);
  const afterBucket = withoutScheme.slice(slashIndex + 1);

  if (afterBucket === "") {
    return { mode: "folder", bucket, parentPrefix: "", needle: "" };
  }

  if (afterBucket.endsWith("/")) {
    return { mode: "folder", bucket, parentPrefix: afterBucket, needle: "" };
  }

  const segments = afterBucket.split("/");
  const needle = segments.pop() ?? "";
  const parentPrefix = segments.length > 0 ? `${segments.join("/")}/` : "";

  return { mode: "folder", bucket, parentPrefix, needle: needle.toLowerCase() };
}

export function listS3PathOptions(
  context: S3PathSuggestionContext,
  bucketNames: string[],
  objects: Array<{ key: string; kind: "folder" | "file" }>
): S3PathOption[] {
  if (context.mode === "bucket") {
    return bucketNames
      .filter((name) => !context.needle || name.toLowerCase().startsWith(context.needle))
      .sort()
      .map((name) => ({
        type: "bucket",
        name,
        pathInput: `${name}/`,
        label: `${name}/`
      }));
  }

  const seen = new Set<string>();
  const items: S3PathOption[] = [];

  for (const object of objects) {
    if (object.kind !== "folder") continue;
    if (context.parentPrefix && !object.key.startsWith(context.parentPrefix)) continue;
    const relative = object.key.startsWith(context.parentPrefix)
      ? object.key.slice(context.parentPrefix.length)
      : object.key;
    const segment = relative.split("/").filter(Boolean)[0];
    if (!segment || seen.has(segment)) continue;
    if (context.needle && !segment.toLowerCase().startsWith(context.needle)) continue;
    seen.add(segment);
    const folderKey = `${context.parentPrefix}${segment}/`;
    items.push({
      type: "folder",
      bucket: context.bucket,
      key: folderKey,
      pathInput: `${context.bucket}/${folderKey}`,
      label: `${segment}/`
    });
  }

  return items.sort((left, right) => left.label.localeCompare(right.label));
}

export function listS3PathSuggestions(options: S3PathOption[], limit = S3_PATH_SUGGESTION_LIMIT) {
  return options.slice(0, limit).map((option) => option.pathInput);
}
