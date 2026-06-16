import { ArrowUp, Copy, Download, FileText, Folder, Lock, RefreshCw, Save, Trash2, Upload } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useActiveAwsAccount } from "@/hooks/useAwsSettings";
import {
  useDeleteS3Object,
  useRenameS3Object,
  useS3Buckets,
  useS3Objects,
  useS3TextObject,
  useSaveS3TextObject
} from "@/hooks/useS3";
import { downloadS3ObjectToDisk, uploadS3ObjectFromDisk } from "@/services/fileDownload";
import { readLastS3Path, writeLastS3Path } from "@/services/s3PathStorage";
import { getS3ObjectEditability } from "@/services/s3Rules";
import { useSessionStore } from "@/stores/sessionStore";
import type { AppError, S3ObjectEntry } from "@/types/domain";

export function S3BrowserPage() {
  const activeAccount = useActiveAwsAccount();
  const accountId = activeAccount.data?.id;
  const selectedS3Bucket = useSessionStore((state) => state.selectedS3Bucket);
  const selectedS3Prefix = useSessionStore((state) => state.selectedS3Prefix);
  const buckets = useS3Buckets();
  const [bucket, setBucket] = useState<string | undefined>();
  const [prefix, setPrefix] = useState("");
  const skipPathPersistRef = useRef(false);
  const selectedBucket = bucket ?? selectedS3Bucket ?? (buckets.isSuccess ? buckets.data?.[0]?.name : undefined);
  const currentS3Path = formatS3Path(selectedBucket, prefix);
  const displayedS3Path = formatCompactS3Path(selectedBucket, prefix);
  const [editingPath, setEditingPath] = useState(false);
  const [pathInput, setPathInput] = useState(formatPathInput(selectedBucket, prefix));
  const objects = useS3Objects(selectedBucket, prefix);
  const [selectedKey, setSelectedKey] = useState<string>();
  const [deleteTarget, setDeleteTarget] = useState<{ bucket: string; key: string }>();
  const [renamingKey, setRenamingKey] = useState<string>();
  const [renameValue, setRenameValue] = useState("");
  const selectedObject = useMemo(
    () => objects.data?.find((object) => object.key === selectedKey),
    [objects.data, selectedKey]
  );
  const textObject = useS3TextObject(selectedBucket, selectedObject?.kind === "file" ? selectedKey : undefined);
  const saveObject = useSaveS3TextObject();
  const deleteObject = useDeleteS3Object();
  const renameObject = useRenameS3Object();
  const [content, setContent] = useState("");
  const [transferPending, setTransferPending] = useState(false);
  const editability = selectedObject
    ? getS3ObjectEditability({ key: selectedObject.key, size: selectedObject.size })
    : undefined;

  useEffect(() => {
    if (!accountId) return;
    skipPathPersistRef.current = true;
    const lastPath = readLastS3Path(accountId);
    setBucket(lastPath?.bucket);
    setPrefix(lastPath?.prefix ?? "");
    setSelectedKey(undefined);
    setEditingPath(false);
  }, [accountId]);

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
    if (!accountId || !selectedBucket) return;
    if (skipPathPersistRef.current) {
      skipPathPersistRef.current = false;
      return;
    }
    writeLastS3Path(accountId, selectedBucket, prefix);
  }, [accountId, prefix, selectedBucket]);

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

  const notifyReadOnlyEditAttempt = () => {
    if (!selectedObject || editability?.editable) return;
    toast.error(editability?.reason ?? "Object is read-only.");
  };

  const copyS3Path = async (path: string) => {
    try {
      await navigator.clipboard?.writeText(path);
      toast.success("S3 path copied.");
    } catch (error) {
      toast.error(errorMessage(error, "Failed to copy S3 path."));
    }
  };

  const upload = async () => {
    if (!selectedBucket) return;
    setTransferPending(true);
    try {
      const uploaded = await uploadS3ObjectFromDisk(selectedBucket, prefix);
      if (!uploaded) {
        toast.info("Upload canceled.");
        return;
      }
      await objects.refetch();
      setSelectedKey(uploaded.key);
      toast.success(`Uploaded ${uploaded.key}`);
    } catch (error) {
      toast.error(errorMessage(error, "Failed to upload object."));
    } finally {
      setTransferPending(false);
    }
  };

  const download = async () => {
    if (!selectedBucket || !selectedKey) return;
    setTransferPending(true);
    try {
      const savedPath = await downloadS3ObjectToDisk(selectedBucket, selectedKey);
      if (!savedPath) return;
      toast.success(`Saved to ${savedPath}`);
    } catch (error) {
      toast.error(errorMessage(error, "Failed to download object."));
    } finally {
      setTransferPending(false);
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

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteObject.mutateAsync(deleteTarget);
      if (selectedKey === deleteTarget.key) {
        setSelectedKey(undefined);
        setContent("");
      }
      await objects.refetch();
      toast.success(`Deleted ${deleteTarget.key}`);
    } catch (error) {
      toast.error(errorMessage(error, "Failed to delete object."));
    } finally {
      setDeleteTarget(undefined);
    }
  };

  const startRename = (object: S3ObjectEntry) => {
    if (object.kind !== "file") return;
    setRenamingKey(object.key);
    setRenameValue(displayObjectName(object.key, prefix, object.kind));
  };

  const cancelRename = () => {
    setRenamingKey(undefined);
    setRenameValue("");
  };

  const submitRename = async (sourceKey: string) => {
    if (!selectedBucket) return;
    const trimmed = renameValue.trim();
    if (!trimmed) {
      cancelRename();
      return;
    }
    if (trimmed.includes("/")) {
      toast.error("File name cannot contain '/'.");
      return;
    }

    const parent = sourceKey.includes("/") ? sourceKey.slice(0, sourceKey.lastIndexOf("/") + 1) : "";
    const destinationKey = `${parent}${trimmed}`;
    if (destinationKey === sourceKey) {
      cancelRename();
      return;
    }

    try {
      const renamed = await renameObject.mutateAsync({
        bucket: selectedBucket,
        sourceKey,
        destinationKey
      });
      await objects.refetch();
      if (selectedKey === sourceKey) {
        setSelectedKey(renamed.key);
      }
      toast.success(`Renamed to ${trimmed}`);
    } catch (error) {
      toast.error(errorMessage(error, "Failed to rename object."));
    } finally {
      cancelRename();
    }
  };

  const handleRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>, sourceKey: string) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void submitRename(sourceKey);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancelRename();
    }
  };

  const selectedObjectPath =
    selectedBucket && selectedKey && selectedObject?.kind === "file" ? `s3://${selectedBucket}/${selectedKey}` : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">S3 Browser</h1>
          <p className="text-sm text-muted-foreground">Browse S3 buckets and edit supported text files.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={!selectedBucket || transferPending} onClick={upload}>
            <Upload data-icon="inline-start" />
            Upload
          </Button>
          <Button variant="outline" disabled={!selectedBucket || !selectedKey || transferPending} onClick={download}>
            <Download data-icon="inline-start" />
            Download
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-[340px_1fr] gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex min-w-0 items-center gap-1">
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
                  className="min-w-0 flex-1 break-all rounded-sm text-left hover:underline"
                  onClick={() => {
                    setPathInput(formatPathInput(selectedBucket, prefix));
                    setEditingPath(true);
                  }}
                >
                  {displayedS3Path}
                </button>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="Copy S3 path"
                    disabled={!selectedBucket}
                    onClick={() => void copyS3Path(currentS3Path)}
                  >
                    <Copy className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Copy S3 path</TooltipContent>
              </Tooltip>
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
              {(objects.data ?? []).map((object) => {
                const objectName = displayObjectName(object.key, prefix, object.kind);
                const isRenaming = renamingKey === object.key;

                if (isRenaming) {
                  return (
                    <Input
                      key={object.key}
                      autoFocus
                      className="h-9 font-mono text-sm"
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.target.value)}
                      onBlur={() => void submitRename(object.key)}
                      onKeyDown={(event) => handleRenameKeyDown(event, object.key)}
                    />
                  );
                }

                return (
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
                    onDoubleClick={() => startRename(object)}
                  >
                    {object.kind === "folder" ? <Folder className="size-4 text-muted-foreground" /> : <FileText className="size-4 text-muted-foreground" />}
                    {objectName}
                  </button>
                );
              })}
            </nav>
            {objects.data?.length === 0 ? <p className="text-sm text-muted-foreground">No objects under this prefix.</p> : null}
          </CardContent>
        </Card>
        <Card role="region" aria-label="Selected S3 object">
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-1.5">
              <CardTitle className="flex min-w-0 items-start gap-1 font-mono text-base">
                <span className="min-w-0 flex-1 break-all">{selectedKey ?? "Select an object"}</span>
                {selectedObjectPath ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-1.5"
                        aria-label="Copy object S3 path"
                        onClick={() => void copyS3Path(selectedObjectPath)}
                      >
                        <Copy className="size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Copy S3 path</TooltipContent>
                  </Tooltip>
                ) : null}
              </CardTitle>
              <CardDescription>
                {editability?.editable
                  ? "ETag-safe save will prevent overwriting remote changes."
                  : "Preview the selected object content."}
              </CardDescription>
            </div>
            <ObjectProperties object={selectedObject} />
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="relative">
              {!editability?.editable && selectedObject?.kind === "file" ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      aria-label="Object is read-only"
                      className="absolute right-3 top-3 rounded-md bg-background/90 p-1 text-muted-foreground shadow-sm"
                    >
                      <Lock className="size-4" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{editability?.reason ?? "Object is read-only."}</TooltipContent>
                </Tooltip>
              ) : null}
              <Textarea
                className="min-h-[480px] font-mono"
                value={content}
                readOnly={!editability?.editable}
                onChange={(event) => setContent(event.target.value)}
                onKeyDown={(event) => {
                  if (editability?.editable) return;
                  event.preventDefault();
                  notifyReadOnlyEditAttempt();
                }}
                onPaste={(event) => {
                  if (editability?.editable) return;
                  event.preventDefault();
                  notifyReadOnlyEditAttempt();
                }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                disabled={!selectedBucket || !selectedKey || deleteObject.isPending}
                onClick={() => selectedBucket && selectedKey && setDeleteTarget({ bucket: selectedBucket, key: selectedKey })}
              >
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
      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete S3 object?</DialogTitle>
            <DialogDescription>
              {deleteTarget ? `This will permanently delete s3://${deleteTarget.bucket}/${deleteTarget.key}.` : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(undefined)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={deleteObject.isPending} onClick={() => void confirmDelete()}>
              {deleteObject.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

function ObjectProperties({ object }: { object?: S3ObjectEntry }) {
  if (!object || object.kind !== "file") return null;

  const properties = [
    ["Size", formatBytes(object.size)],
    ["Last modified", formatS3Timestamp(object.lastModified)],
    ["ETag", trimEtag(object.etag)]
  ].filter(([, value]) => Boolean(value));

  if (properties.length === 0) return null;

  return (
    <dl className="grid shrink-0 grid-cols-[auto_auto] gap-x-3 gap-y-1 text-right text-xs">
      {properties.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="max-w-[180px] truncate font-mono" title={value}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function parentPrefix(prefix: string) {
  const parent = prefix.split("/").filter(Boolean).slice(0, -1).join("/");
  return parent ? `${parent}/` : "";
}

function formatS3Path(bucket: string | undefined, prefix: string) {
  return bucket ? `s3://${bucket}/${prefix}` : "s3://";
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatS3Timestamp(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function trimEtag(value?: string) {
  return value?.replace(/^"|"$/g, "");
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


function errorMessage(error: unknown, fallback: string) {
  const appError = error as Partial<AppError>;
  if (appError.code === "DemoModeUnavailable") {
    return "S3 requires the Tauri desktop runtime. Start with npm run tauri -- dev.";
  }
  return appError.message ?? fallback;
}
