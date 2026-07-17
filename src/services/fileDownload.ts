import { tauriClient } from "./tauriClient";
import type { S3ObjectEntry, S3UploadFromPathRequest, S3UploadPrepareResult } from "@/types/domain";
import { isTauriRuntime } from "@/lib/tauriRuntime";

export async function openTextFile(): Promise<string | undefined> {
  if (isTauriRuntime()) {
    return tauriClient.openTextFile();
  }

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json,text/plain";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(undefined);
        return;
      }
      resolve(await file.text());
    };
    input.click();
  });
}

export async function saveTextFile(suggestedName: string, content: string): Promise<string | undefined> {
  if (isTauriRuntime()) {
    return tauriClient.saveTextFile({ suggestedName, content });
  }

  downloadViaBrowserBlob(suggestedName, content);
  return suggestedName;
}

export async function downloadS3ObjectToDisk(bucket: string, key: string): Promise<string | undefined> {
  if (isTauriRuntime()) {
    return tauriClient.downloadS3ObjectToDisk({ bucket, key });
  }

  const object = await tauriClient.downloadS3Object({ bucket, key });
  downloadViaBrowserBlob(key.split("/").at(-1) ?? "s3-object.txt", object.content, object.contentType);
  return key;
}

export async function prepareS3UploadFromDisk(
  bucket: string,
  prefix?: string
): Promise<S3UploadPrepareResult | undefined> {
  if (isTauriRuntime()) {
    return tauriClient.prepareS3UploadFromDisk({ bucket, prefix });
  }

  throw new Error("Upload requires the Tauri desktop runtime.");
}

export async function uploadS3ObjectFromPath(request: S3UploadFromPathRequest): Promise<S3ObjectEntry> {
  if (isTauriRuntime()) {
    return tauriClient.uploadS3ObjectFromPath(request);
  }

  throw new Error("Upload requires the Tauri desktop runtime.");
}

export async function s3ObjectExists(bucket: string, key: string): Promise<boolean> {
  if (isTauriRuntime()) {
    return tauriClient.s3ObjectExists({ bucket, key });
  }

  throw new Error("S3 object checks require the Tauri desktop runtime.");
}

/** @deprecated Prefer prepare + upload from path with conflict handling. */
export async function uploadS3ObjectFromDisk(bucket: string, prefix?: string) {
  if (isTauriRuntime()) {
    return tauriClient.uploadS3ObjectFromDisk({ bucket, prefix });
  }

  throw new Error("Upload requires the Tauri desktop runtime.");
}

function downloadViaBrowserBlob(fileName: string, content: string, contentType = "text/plain") {
  const url = URL.createObjectURL(new Blob([content], { type: contentType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = sanitizeFileName(fileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "download.txt";
}
