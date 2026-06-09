const EDITABLE_EXTENSIONS = new Set(["sql", "yaml", "yml", "json", "conf", "properties", "txt"]);
const PREVIEWABLE_EXTENSIONS = new Set([...EDITABLE_EXTENSIONS]);
const EDITOR_SIZE_LIMIT_BYTES = 5 * 1024 * 1024;

export interface S3EditabilityInput {
  key: string;
  size: number;
}

export interface S3Editability {
  editable: boolean;
  previewable: boolean;
  reason?: string;
}

export function getS3ObjectEditability(input: S3EditabilityInput): S3Editability {
  const extension = getExtension(input.key);
  const previewable = PREVIEWABLE_EXTENSIONS.has(extension);

  if (!previewable) {
    return {
      editable: false,
      previewable: false,
      reason: "File type is read-only."
    };
  }

  if (input.size > EDITOR_SIZE_LIMIT_BYTES) {
    return {
      editable: false,
      previewable: true,
      reason: "File is larger than the 5 MB editor limit."
    };
  }

  return {
    editable: true,
    previewable: true,
    reason: undefined
  };
}

function getExtension(key: string) {
  const fileName = key.split("/").filter(Boolean).at(-1) ?? "";
  const index = fileName.lastIndexOf(".");

  return index === -1 ? "" : fileName.slice(index + 1).toLowerCase();
}
