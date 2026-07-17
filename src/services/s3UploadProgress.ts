import { listen } from "@tauri-apps/api/event";
import { isTauriRuntime } from "@/lib/tauriRuntime";

export const S3_UPLOAD_PROGRESS_EVENT = "s3:upload-progress";

export type S3UploadPhase = "preparing" | "reading" | "uploading" | "completing" | "completed" | string;

export interface S3UploadProgress {
  fileName: string;
  key: string;
  phase: S3UploadPhase;
  bytesUploaded: number;
  totalBytes: number;
  percent: number;
}

export function formatUploadPhase(phase: S3UploadPhase): string {
  switch (phase) {
    case "preparing":
      return "Preparing";
    case "reading":
      return "Reading";
    case "uploading":
      return "Uploading";
    case "completing":
      return "Finalizing";
    case "completed":
      return "Uploaded";
    default:
      return "Uploading";
  }
}

export function formatUploadBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

export async function bindS3UploadProgress(onProgress: (progress: S3UploadProgress) => void) {
  if (!isTauriRuntime()) {
    return () => {};
  }

  const unlisten = await listen<S3UploadProgress>(S3_UPLOAD_PROGRESS_EVENT, (event) => {
    onProgress(event.payload);
  });

  return unlisten;
}
