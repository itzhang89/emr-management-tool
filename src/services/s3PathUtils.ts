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

export type S3PathSuggestionContext =
  | { mode: "bucket"; needle: string }
  | { mode: "folder"; bucket: string; parentPrefix: string; needle: string };

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

export function buildBucketSuggestions(bucketNames: string[], needle: string, limit = 12) {
  const options = bucketNames.map((name) => `${name}/`);
  if (!needle) return options.slice(0, limit);
  return options.filter((option) => option.toLowerCase().startsWith(needle)).slice(0, limit);
}

export function buildFolderSuggestions(
  bucket: string,
  parentPrefix: string,
  objects: Array<{ key: string; kind: "folder" | "file" }>,
  needle: string,
  limit = 12
) {
  const nextLevelFolders = new Set<string>();

  for (const object of objects) {
    if (object.kind !== "folder") continue;
    if (parentPrefix && !object.key.startsWith(parentPrefix)) continue;
    const relative = object.key.startsWith(parentPrefix) ? object.key.slice(parentPrefix.length) : object.key;
    const nextSegment = relative.split("/").filter(Boolean)[0];
    if (nextSegment) {
      nextLevelFolders.add(nextSegment);
    }
  }

  let options = [...nextLevelFolders]
    .sort()
    .map((folder) => `${bucket}/${parentPrefix}${folder}/`);

  if (needle) {
    options = options.filter((option) => {
      const pathAfterBucket = option.slice(bucket.length + 1);
      const relativeToParent = parentPrefix ? pathAfterBucket.slice(parentPrefix.length) : pathAfterBucket;
      const nextSegment = relativeToParent.split("/").filter(Boolean)[0] ?? "";
      return nextSegment.toLowerCase().startsWith(needle);
    });
  }

  return options.slice(0, limit);
}

export type S3BrowseListItem =
  | { type: "bucket"; name: string; pathInput: string; label: string }
  | { type: "folder"; bucket: string; key: string; pathInput: string; label: string };

export function buildBrowseListItems(
  context: S3PathSuggestionContext,
  bucketNames: string[],
  objects: Array<{ key: string; kind: "folder" | "file" }>
): S3BrowseListItem[] {
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
  const items: S3BrowseListItem[] = [];

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
