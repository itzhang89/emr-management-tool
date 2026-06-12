import { ArrowUp, Copy, Download, FileText, Folder, RefreshCw, Save, Trash2, Upload } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  useDeleteS3Object,
  useDownloadS3Object,
  useS3Buckets,
  useS3Objects,
  useS3TextObject,
  useSaveS3TextObject,
  useUploadS3Object
} from "@/hooks/useS3";
import { getS3ObjectEditability } from "@/services/s3Rules";
import { useSessionStore } from "@/stores/sessionStore";
import type { AppError } from "@/types/domain";

const lastS3PathStorageKey = "emr-eks:last-s3-path";

export function S3BrowserPage() {
  const selectedS3Bucket = useSessionStore((state) => state.selectedS3Bucket);
  const selectedS3Prefix = useSessionStore((state) => state.selectedS3Prefix);
  const buckets = useS3Buckets();
  const [bucket, setBucket] = useState<string | undefined>(() => readLastS3Path()?.bucket);
  const [prefix, setPrefix] = useState(() => readLastS3Path()?.prefix ?? "");
  const selectedBucket = bucket ?? selectedS3Bucket ?? buckets.data?.[0]?.name;
  const currentS3Path = formatS3Path(selectedBucket, prefix);
  const displayedS3Path = formatCompactS3Path(selectedBucket, prefix);
  const [editingPath, setEditingPath] = useState(false);
  const [pathInput, setPathInput] = useState(formatPathInput(selectedBucket, prefix));
  const objects = useS3Objects(selectedBucket, prefix);
  const [selectedKey, setSelectedKey] = useState<string>();
  const selectedObject = useMemo(
    () => objects.data?.find((object) => object.key === selectedKey),
    [objects.data, selectedKey]
  );
  const textObject = useS3TextObject(selectedBucket, selectedObject?.kind === "file" ? selectedKey : undefined);
  const saveObject = useSaveS3TextObject();
  const uploadObject = useUploadS3Object();
  const downloadObject = useDownloadS3Object();
  const deleteObject = useDeleteS3Object();
  const [content, setContent] = useState("");
  const editability = selectedObject
    ? getS3ObjectEditability({ key: selectedObject.key, size: selectedObject.size })
    : undefined;

  useEffect(() => {
    if (selectedS3Bucket) {
      setBucket(selectedS3Bucket);
    }
  }, [selectedS3Bucket]);

  useEffect(() => {
    if (!editingPath) {
      setPathInput(formatPathInput(selectedBucket, prefix));
    }
  }, [editingPath, prefix, selectedBucket]);

  useEffect(() => {
    if (selectedS3Bucket !== undefined || selectedS3Prefix !== undefined) {
      setPrefix(selectedS3Prefix ?? "");
      setSelectedKey(undefined);
    }
  }, [selectedS3Bucket, selectedS3Prefix]);

  useEffect(() => {
    if (selectedBucket) {
      writeLastS3Path(selectedBucket, prefix);
    }
  }, [prefix, selectedBucket]);

  useEffect(() => {
    if (!selectedKey && objects.data?.[0]) {
      setSelectedKey(objects.data[0].key);
    }
  }, [objects.data, selectedKey]);

  useEffect(() => {
    if (textObject.data?.content !== undefined) {
      setContent(textObject.data.content);
    }
  }, [textObject.data?.content]);

  const save = async () => {
    if (!textObject.data || !editability?.editable) return;
    try {
      const saved = await saveObject.mutateAsync({ ...textObject.data, content });
      toast.success(`Saved ${saved.key}`);
    } catch (error) {
      toast.error(errorMessage(error, "Failed to save object."));
    }
  };

  const copyPath = async () => {
    if (!selectedBucket || !selectedKey) return;
    await navigator.clipboard?.writeText(`s3://${selectedBucket}/${selectedKey}`);
    toast.success("S3 path copied.");
  };

  const upload = async () => {
    if (!selectedBucket) return;
    const key = window.prompt("S3 key to upload");
    if (!key) return;
    const body = window.prompt("Text content to upload") ?? "";
    try {
      await uploadObject.mutateAsync({ bucket: selectedBucket, key, content: body });
      toast.success(`Uploaded ${key}`);
    } catch (error) {
      toast.error(errorMessage(error, "Failed to upload object."));
    }
  };

  const download = async () => {
    if (!selectedBucket || !selectedKey) return;
    try {
      const object = await downloadObject.mutateAsync({ bucket: selectedBucket, key: selectedKey });
      const url = URL.createObjectURL(new Blob([object.content], { type: object.contentType ?? "text/plain" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = selectedKey.split("/").at(-1) ?? "s3-object.txt";
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(errorMessage(error, "Failed to download object."));
    }
  };

  const openPath = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = parseS3PathInput(pathInput);
    if (!parsed) {
      setPathInput(formatPathInput(selectedBucket, prefix));
      setEditingPath(false);
      return;
    }
    setBucket(parsed.bucket);
    setPrefix(parsed.prefix);
    setSelectedKey(undefined);
    setContent("");
    setEditingPath(false);
  };

  const goUp = () => {
    const parent = parentPrefix(prefix);
    setPrefix(parent);
    setSelectedKey(undefined);
    setContent("");
  };

  const remove = async () => {
    if (!selectedBucket || !selectedKey || !window.confirm(`Delete s3://${selectedBucket}/${selectedKey}?`)) return;
    try {
      await deleteObject.mutateAsync({ bucket: selectedBucket, key: selectedKey });
      setSelectedKey(undefined);
      setContent("");
      toast.success("Object deleted.");
    } catch (error) {
      toast.error(errorMessage(error, "Failed to delete object."));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">S3 Browser</h1>
          <p className="text-sm text-muted-foreground">Browse S3 buckets and edit supported text files.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={!selectedBucket || uploadObject.isPending} onClick={upload}>
            <Upload data-icon="inline-start" />
            Upload
          </Button>
          <Button variant="outline" disabled={!selectedBucket || !selectedKey || downloadObject.isPending} onClick={download}>
            <Download data-icon="inline-start" />
            Download
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-[340px_1fr] gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {editingPath ? (
                <form className="flex min-w-0 flex-1 items-center gap-2" onSubmit={openPath}>
                  <span className="text-muted-foreground">s3://</span>
                  <Input
                    autoFocus
                    list="s3-path-options"
                    value={pathInput}
                    onChange={(event) => setPathInput(event.target.value)}
                    onBlur={() => {
                      setPathInput(formatPathInput(selectedBucket, prefix));
                      setEditingPath(false);
                    }}
                  />
                  <datalist id="s3-path-options">
                    {(buckets.data ?? []).map((entry) => (
                      <option key={entry.name} value={`${entry.name}/`}>
                        {entry.name}
                      </option>
                    ))}
                  </datalist>
                </form>
              ) : (
                <button
                  type="button"
                  title={currentS3Path}
                  className="min-w-0 break-all rounded-sm text-left hover:underline"
                  onClick={() => {
                    setPathInput(formatPathInput(selectedBucket, prefix));
                    setEditingPath(true);
                  }}
                >
                  {displayedS3Path}
                </button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Refresh"
                disabled={!selectedBucket || objects.isLoading}
                onClick={() => void objects.refetch()}
              >
                <RefreshCw data-icon="inline-start" />
              </Button>
            </CardTitle>
            <CardDescription>
              {selectedS3Prefix ? "Opened from job monitoring configuration." : "Supported text files can be edited in place."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <div className="flex gap-2">
              <Button type="button" variant="outline" aria-label="Up" disabled={!prefix} onClick={goUp}>
                <ArrowUp data-icon="inline-start" />
              </Button>
            </div>
            {buckets.isLoading || objects.isLoading ? <p className="text-sm text-muted-foreground">Loading S3 objects...</p> : null}
            {buckets.error || objects.error ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {errorMessage(buckets.error ?? objects.error, "Failed to load S3 data.")}
              </p>
            ) : null}
            <nav aria-label="S3 objects" className="flex flex-col gap-1">
              {(objects.data ?? []).map((object) => (
                <button
                  key={object.key}
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent data-[active=true]:bg-primary data-[active=true]:text-primary-foreground"
                  type="button"
                  data-active={object.key === selectedKey}
                  onClick={() => {
                    if (object.kind === "folder") {
                      setPrefix(object.key);
                      setSelectedKey(undefined);
                      setContent("");
                      return;
                    }
                    setSelectedKey(object.key);
                  }}
                >
                  {object.kind === "folder" ? <Folder className="size-4 text-muted-foreground" /> : <FileText className="size-4 text-muted-foreground" />}
                  {displayObjectName(object.key, prefix, object.kind)}
                </button>
              ))}
            </nav>
            {objects.data?.length === 0 ? <p className="text-sm text-muted-foreground">No objects under this prefix.</p> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{selectedKey ?? "Select an object"}</CardTitle>
            <CardDescription>
              {editability?.reason ?? "ETag-safe save will prevent overwriting remote changes."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Textarea
              className="min-h-[480px] font-mono"
              value={content}
              readOnly={!editability?.editable}
              onChange={(event) => setContent(event.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={copyPath}>
                <Copy data-icon="inline-start" />
                Copy S3 Path
              </Button>
              <Button variant="outline" disabled={!selectedKey || deleteObject.isPending} onClick={remove}>
                <Trash2 data-icon="inline-start" />
                Delete
              </Button>
              <Button disabled={!editability?.editable || saveObject.isPending} onClick={save}>
                <Save data-icon="inline-start" />
                {saveObject.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function displayObjectName(key: string, prefix: string, kind: "folder" | "file") {
  const relative = key.startsWith(prefix) ? key.slice(prefix.length) : key;
  if (kind === "folder") {
    const folderName = relative.split("/").filter(Boolean)[0] ?? relative;
    return `${folderName}/`;
  }
  return relative.split("/").filter(Boolean).at(-1) ?? relative;
}

function parentPrefix(prefix: string) {
  const parent = prefix.split("/").filter(Boolean).slice(0, -1).join("/");
  return parent ? `${parent}/` : "";
}

function formatS3Path(bucket: string | undefined, prefix: string) {
  return bucket ? `s3://${bucket}/${prefix}` : "s3://";
}

function formatCompactS3Path(bucket: string | undefined, prefix: string) {
  if (!bucket) return "s3://";
  const parts = prefix.split("/").filter(Boolean);
  if (parts.length <= 2) return formatS3Path(bucket, prefix);
  return `s3://${bucket}/.../${parts.slice(-2).join("/")}/`;
}

function formatPathInput(bucket: string | undefined, prefix: string) {
  return bucket ? `${bucket}/${prefix}` : "";
}

function parseS3PathInput(value: string) {
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

function readLastS3Path() {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(lastS3PathStorageKey);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { bucket?: unknown; prefix?: unknown };
    if (typeof parsed.bucket !== "string" || !parsed.bucket.trim()) return undefined;
    return {
      bucket: parsed.bucket,
      prefix: typeof parsed.prefix === "string" ? parsed.prefix : ""
    };
  } catch {
    return undefined;
  }
}

function writeLastS3Path(bucket: string, prefix: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(lastS3PathStorageKey, JSON.stringify({ bucket, prefix }));
  } catch {
    // Local storage can be unavailable in hardened browser contexts.
  }
}

function errorMessage(error: unknown, fallback: string) {
  const appError = error as Partial<AppError>;
  if (appError.code === "DemoModeUnavailable") {
    return "S3 requires the Tauri desktop runtime. Start with npm run tauri -- dev.";
  }
  return appError.message ?? fallback;
}
