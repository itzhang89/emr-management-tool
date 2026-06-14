import { tauriClient } from "./tauriClient";

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

export async function uploadS3ObjectFromDisk(bucket: string, prefix?: string) {
  if (isTauriRuntime()) {
    return tauriClient.uploadS3ObjectFromDisk({ bucket, prefix });
  }

  throw new Error("Upload requires the Tauri desktop runtime.");
}

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
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
