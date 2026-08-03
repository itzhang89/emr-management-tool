import { ArrowUp, Copy, Download, FileText, Folder, FolderOpen, FolderPlus, Lock, RefreshCw, Save, Trash2, Upload } from "lucide-react";
import { type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from "react";
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
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { S3PathPickerDialog } from "@/components/s3/S3PathPicker";
import { S3ObjectEditor, type S3ObjectEditorHandle } from "@/components/s3/S3ObjectEditor";
import { PageHeader } from "@/components/layout/PageHeader";
import { cn } from "@/lib/utils";
import { useActiveAwsAccount } from "@/hooks/useAwsSettings";
import {
  useCreateS3Folder,
  useDeleteS3Object,
  useDeleteS3Prefix,
  useRenameS3Object,
  useS3Buckets,
  useS3Objects,
  useS3TextObject,
  useSaveS3TextObject
} from "@/hooks/useS3";
import { downloadS3ObjectToDisk, prepareS3UploadFromDisk, s3ObjectExists, uploadS3ObjectFromPath } from "@/services/fileDownload";
import { formatAppError, formatS3BrowserError } from "@/services/appErrorMessage";
import { s3Service } from "@/services/s3Service";
import { readLastS3Path, writeLastS3Path } from "@/services/s3PathStorage";
import {
  buildFolderKey,
  displayObjectName,
  formatCompactS3Path,
  formatS3Path,
  parentPrefix,
  parseS3PathInput,
  validateS3FolderName
} from "@/services/s3PathUtils";
import { getS3ObjectEditability } from "@/services/s3Rules";
import {
  bindS3UploadProgress,
  formatUploadBytes,
  formatUploadPhase,
  type S3UploadProgress
} from "@/services/s3UploadProgress";
import { isValidUploadFileName, nextConflictFileName } from "@/services/s3UploadConflict";
import { useSessionStore } from "@/stores/sessionStore";
import type { S3ObjectEntry, S3PrefixDeletionSummary, S3UploadPrepareResult } from "@/types/domain";

type DeleteTarget = {
  bucket: string;
  key: string;
  kind: S3ObjectEntry["kind"];
};

const BROWSER_PANE_MIN_WIDTH = 220;
const BROWSER_PANE_MAX_WIDTH = 720;
const BROWSER_PANE_DEFAULT_WIDTH = 280;

export function S3BrowserPage() {
  const activeAccount = useActiveAwsAccount();
  const accountId = activeAccount.data?.id;
  const selectedS3Bucket = useSessionStore((state) => state.selectedS3Bucket);
  const selectedS3Prefix = useSessionStore((state) => state.selectedS3Prefix);
  const buckets = useS3Buckets();
  const [bucket, setBucket] = useState<string | undefined>();
  const [prefix, setPrefix] = useState("");
  const skipPathPersistRef = useRef(false);
  const objectListRef = useRef<HTMLElement>(null);
  const editorRef = useRef<S3ObjectEditorHandle>(null);
  const selectedBucket = bucket ?? selectedS3Bucket ?? (buckets.isSuccess ? buckets.data?.[0]?.name : undefined);
  const currentS3Path = formatS3Path(selectedBucket, prefix) || "s3://";
  const displayedS3Path = formatCompactS3Path(selectedBucket, prefix);
  const [pathPickerOpen, setPathPickerOpen] = useState(false);
  const [browserPaneWidth, setBrowserPaneWidth] = useState(BROWSER_PANE_DEFAULT_WIDTH);
  const objects = useS3Objects(selectedBucket, prefix);
  const [selectedKey, setSelectedKey] = useState<string>();
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>();
  const [deleteSummary, setDeleteSummary] = useState<S3PrefixDeletionSummary>();
  const [deleteSummaryLoading, setDeleteSummaryLoading] = useState(false);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingKey, setRenamingKey] = useState<string>();
  const [renameValue, setRenameValue] = useState("");
  const selectedObject = useMemo(
    () => objects.data?.find((object) => object.key === selectedKey),
    [objects.data, selectedKey]
  );
  const textObject = useS3TextObject(selectedBucket, selectedObject?.kind === "file" ? selectedKey : undefined);
  const saveObject = useSaveS3TextObject();
  const deleteObject = useDeleteS3Object();
  const deletePrefix = useDeleteS3Prefix();
  const createFolder = useCreateS3Folder();
  const renameObject = useRenameS3Object();
  const [content, setContent] = useState("");
  const [transferPending, setTransferPending] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<S3UploadProgress | null>(null);
  const [uploadConflict, setUploadConflict] = useState<S3UploadPrepareResult | null>(null);
  const [conflictRenameValue, setConflictRenameValue] = useState("");
  const [conflictBusy, setConflictBusy] = useState(false);
  const resolvingUploadConflictRef = useRef(false);
  const editability = selectedObject
    ? getS3ObjectEditability({ key: selectedObject.key, size: selectedObject.size })
    : undefined;

  useEffect(() => {
    let disposed = false;
    let unbind: (() => void) | undefined;
    void bindS3UploadProgress((progress) => {
      if (!disposed) {
        setUploadProgress(progress);
      }
    }).then((unsubscribe) => {
      if (disposed) {
        unsubscribe();
        return;
      }
      unbind = unsubscribe;
    });
    return () => {
      disposed = true;
      unbind?.();
    };
  }, []);

  useEffect(() => {
    if (!accountId) return;
    skipPathPersistRef.current = true;
    const lastPath = readLastS3Path(accountId);
    setBucket(lastPath?.bucket);
    setPrefix(lastPath?.prefix ?? "");
    setSelectedKey(undefined);
  }, [accountId]);

  useEffect(() => {
    objectListRef.current?.focus();
  }, []);

  useEffect(() => {
    if (selectedS3Bucket) {
      setBucket(selectedS3Bucket);
    }
  }, [selectedS3Bucket]);

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
      return;
    }
    if (selectedKey && selectedObject?.kind === "file" && !textObject.isLoading) {
      setContent("");
    }
  }, [textObject.data?.content, textObject.isLoading, selectedKey, selectedObject?.kind]);

  const save = async () => {
    if (!textObject.data || !editability?.editable) return;
    try {
      const saved = await saveObject.mutateAsync({ ...textObject.data, content });
      toast.success(`Saved ${saved.key}`);
    } catch (error) {
      toast.error(formatAppError(error, "Failed to save object."));
    }
  };

  const notifyReadOnlyEditAttempt = () => {
    if (!selectedObject || selectedObject.kind !== "file" || editability?.editable) return;
    toast.error(editability?.reason ?? "Object is read-only.");
  };

  const copyS3Path = async (path: string) => {
    try {
      await navigator.clipboard?.writeText(path);
      toast.success("S3 path copied.");
    } catch (error) {
      toast.error(formatAppError(error, "Failed to copy S3 path."));
    }
  };

  const executeUpload = async (prepared: S3UploadPrepareResult, key: string) => {
    resolvingUploadConflictRef.current = true;
    setUploadConflict(null);
    setConflictRenameValue("");
    setConflictBusy(false);
    setTransferPending(true);
    setUploadProgress({
      fileName: key.split("/").at(-1) || prepared.fileName,
      key,
      phase: "preparing",
      bytesUploaded: 0,
      totalBytes: prepared.totalBytes,
      percent: 0
    });
    try {
      const uploaded = await uploadS3ObjectFromPath({
        bucket: prepared.bucket,
        key,
        localPath: prepared.localPath
      });
      await objects.refetch();
      setSelectedKey(uploaded.key);
      toast.success(`Uploaded ${uploaded.key}`);
    } catch (error) {
      toast.error(formatAppError(error, "Failed to upload object."));
    } finally {
      resolvingUploadConflictRef.current = false;
      setTransferPending(false);
      setUploadProgress(null);
    }
  };

  const closeUploadConflict = (options?: { canceled?: boolean }) => {
    setUploadConflict(null);
    setConflictRenameValue("");
    setConflictBusy(false);
    setTransferPending(false);
    setUploadProgress(null);
    if (options?.canceled) {
      toast.info("Upload canceled.");
    }
  };

  const upload = async () => {
    if (!selectedBucket) return;
    setTransferPending(true);
    setUploadProgress({
      fileName: "…",
      key: "",
      phase: "preparing",
      bytesUploaded: 0,
      totalBytes: 0,
      percent: 0
    });
    try {
      const prepared = await prepareS3UploadFromDisk(selectedBucket, prefix);
      if (!prepared) {
        toast.info("Upload canceled.");
        setTransferPending(false);
        setUploadProgress(null);
        return;
      }
      if (prepared.exists) {
        setUploadConflict(prepared);
        setConflictRenameValue(prepared.suggestedFileName ?? nextConflictFileName(prepared.fileName));
        setTransferPending(false);
        setUploadProgress(null);
        return;
      }
      await executeUpload(prepared, prepared.key);
    } catch (error) {
      toast.error(formatAppError(error, "Failed to upload object."));
      setTransferPending(false);
      setUploadProgress(null);
    }
  };

  const overwriteConflictUpload = () => {
    if (!uploadConflict) return;
    void executeUpload(uploadConflict, uploadConflict.key);
  };

  const renameConflictUpload = async () => {
    if (!uploadConflict) return;
    const renamed = conflictRenameValue.trim();
    if (!isValidUploadFileName(renamed)) {
      toast.error("Enter a valid file name without path separators.");
      return;
    }
    const key = `${prefix}${renamed}`;
    setConflictBusy(true);
    try {
      const exists = await s3ObjectExists(uploadConflict.bucket, key);
      if (exists) {
        const suggestion = nextConflictFileName(renamed);
        setConflictRenameValue(suggestion);
        toast.error(`s3://${uploadConflict.bucket}/${key} already exists. Try ${suggestion}.`);
        return;
      }
      await executeUpload(uploadConflict, key);
    } catch (error) {
      toast.error(formatAppError(error, "Failed to check existing object."));
    } finally {
      setConflictBusy(false);
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
      toast.error(formatAppError(error, "Failed to download object."));
    } finally {
      setTransferPending(false);
    }
  };

  const applySelectedPath = (path: string) => {
    const parsed = parseS3PathInput(path);
    if (!parsed) return;
    setBucket(parsed.bucket);
    setPrefix(parsed.prefix);
    setSelectedKey(undefined);
    setContent("");
    setPathPickerOpen(false);
  };

  const goUp = () => {
    const parent = parentPrefix(prefix);
    setPrefix(parent);
    setSelectedKey(undefined);
    setContent("");
  };

  const closeDeleteDialog = () => {
    setDeleteTarget(undefined);
    setDeleteSummary(undefined);
    setDeleteSummaryLoading(false);
  };

  const openDeleteDialog = async (target: DeleteTarget) => {
    setDeleteTarget(target);
    setDeleteSummary(undefined);
    if (target.kind !== "folder") return;

    if (!accountId) {
      toast.error("Select an AWS account first.");
      closeDeleteDialog();
      return;
    }

    setDeleteSummaryLoading(true);
    try {
      const summary = await s3Service.describePrefixDeletion(accountId, target.bucket, target.key);
      setDeleteSummary(summary);
    } catch (error) {
      toast.error(formatAppError(error, "Failed to inspect folder contents."));
      closeDeleteDialog();
    } finally {
      setDeleteSummaryLoading(false);
    }
  };

  const requestDeleteSelected = () => {
    if (!selectedBucket || !selectedKey) return;
    const object = objects.data?.find((entry) => entry.key === selectedKey);
    if (!object) return;
    void openDeleteDialog({ bucket: selectedBucket, key: object.key, kind: object.kind });
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    closeDeleteDialog();

    void (async () => {
      try {
        if (target.kind === "folder") {
          await deletePrefix.mutateAsync({ bucket: target.bucket, key: target.key });
        } else {
          await deleteObject.mutateAsync({ bucket: target.bucket, key: target.key });
        }

        if (selectedKey === target.key || selectedKey?.startsWith(target.key)) {
          setSelectedKey(undefined);
          setContent("");
        }
        if (target.kind === "folder" && prefix.startsWith(target.key)) {
          setPrefix(parentPrefix(target.key));
        }

        await objects.refetch();
        toast.success(
          target.kind === "folder" ? `Deleted folder ${target.key}` : `Deleted ${target.key}`
        );
      } catch (error) {
        toast.error(formatAppError(error, "Failed to delete object."));
      }
    })();
  };

  const submitCreateFolder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedBucket) return;

    const validationError = validateS3FolderName(newFolderName);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    const folderKey = buildFolderKey(prefix, newFolderName);
    const folderExists = (objects.data ?? []).some((object) => object.key === folderKey);
    if (folderExists) {
      toast.error(`Folder "${displayObjectName(folderKey, prefix, "folder")}" already exists.`);
      return;
    }

    try {
      await createFolder.mutateAsync({
        bucket: selectedBucket,
        parentPrefix: prefix,
        folderName: newFolderName.trim()
      });
      await objects.refetch();
      toast.success(`Created ${newFolderName.trim()}/`);
      setCreateFolderOpen(false);
      setNewFolderName("");
    } catch (error) {
      toast.error(formatAppError(error, "Failed to create folder."));
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
      toast.error(formatAppError(error, "Failed to rename object."));
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

  const handleObjectListKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const currentObjects = objects.data ?? [];
    if (currentObjects.length === 0) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const currentIndex = currentObjects.findIndex((object) => object.key === selectedKey);
      const fallbackIndex = event.key === "ArrowDown" ? 0 : currentObjects.length - 1;
      const nextIndex =
        currentIndex === -1
          ? fallbackIndex
          : event.key === "ArrowDown"
            ? Math.min(currentIndex + 1, currentObjects.length - 1)
            : Math.max(currentIndex - 1, 0);
      setSelectedKey(currentObjects[nextIndex]?.key);
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      editorRef.current?.focus();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const selected = currentObjects.find((object) => object.key === selectedKey);
      if (selected?.kind === "folder") {
        setPrefix(selected.key);
        setSelectedKey(undefined);
        setContent("");
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      if (prefix) {
        goUp();
      }
      return;
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      requestDeleteSelected();
    }
  };

  const selectedObjectPath =
    selectedBucket && selectedKey ? `s3://${selectedBucket}/${selectedKey}` : undefined;

  const deletePending = deleteObject.isPending || deletePrefix.isPending;
  const folderDeleteIsNonEmpty =
    deleteSummary != null && (deleteSummary.fileCount > 0 || deleteSummary.folderCount > 0);

  const beginBrowserPaneResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = browserPaneWidth;

    const onMouseMove = (moveEvent: globalThis.MouseEvent) => {
      const nextWidth = Math.min(
        BROWSER_PANE_MAX_WIDTH,
        Math.max(BROWSER_PANE_MIN_WIDTH, startWidth + moveEvent.clientX - startX)
      );
      setBrowserPaneWidth(nextWidth);
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  const nudgeBrowserPaneWidth = (delta: number) => {
    setBrowserPaneWidth((current) => Math.min(BROWSER_PANE_MAX_WIDTH, Math.max(BROWSER_PANE_MIN_WIDTH, current + delta)));
  };

  return (
    <div className="flex h-[calc(100vh-3rem)] min-h-0 flex-col gap-4 overflow-hidden">
      <PageHeader
        pageId="s3"
        actions={
          <>
            <Button variant="outline" disabled={!selectedBucket || transferPending} onClick={upload}>
              <Upload data-icon="inline-start" />
              {uploadProgress ? `Uploading ${uploadProgress.percent}%` : "Upload"}
            </Button>
            <Button variant="outline" disabled={!selectedBucket || !selectedKey || transferPending} onClick={download}>
              <Download data-icon="inline-start" />
              Download
            </Button>
          </>
        }
      />
      {uploadProgress ? (
        <Card className="shrink-0 border-primary/20 bg-primary/5 py-3">
          <CardContent className="space-y-2 px-4 py-0">
            <div className="flex items-center justify-between gap-3 text-xs">
              <p className="min-w-0 truncate font-medium">
                {formatUploadPhase(uploadProgress.phase)}
                {uploadProgress.fileName && uploadProgress.fileName !== "…"
                  ? ` · ${uploadProgress.fileName}`
                  : ""}
              </p>
              <p className="shrink-0 tabular-nums text-muted-foreground">
                {uploadProgress.totalBytes > 0
                  ? `${formatUploadBytes(uploadProgress.bytesUploaded)} / ${formatUploadBytes(uploadProgress.totalBytes)} · ${uploadProgress.percent}%`
                  : "Waiting for file…"}
              </p>
            </div>
            <Progress value={uploadProgress.percent} aria-label="Upload progress" />
          </CardContent>
        </Card>
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1">
        <Card className="flex shrink-0 flex-col overflow-hidden" style={{ width: browserPaneWidth }}>
          <CardHeader className="shrink-0 space-y-1.5 p-4">
            <CardTitle className="flex min-w-0 items-center gap-1 text-sm">
              <span title={currentS3Path} className="min-w-0 flex-1 truncate font-mono text-xs font-normal">
                {displayedS3Path}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Browse S3 path"
                onClick={() => setPathPickerOpen(true)}
              >
                <FolderOpen data-icon="inline-start" />
              </Button>
            </CardTitle>
            <CardDescription className="text-xs">
              {selectedS3Prefix ? "Opened from job monitoring configuration." : "Supported text files can be edited in place."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden p-4 pt-0">
            <div className="flex shrink-0 gap-2">
              <Button type="button" variant="outline" size="sm" className="h-7 px-2" aria-label="Up" disabled={!prefix} onClick={goUp}>
                <ArrowUp data-icon="inline-start" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2"
                aria-label="Create folder"
                disabled={!selectedBucket || createFolder.isPending}
                onClick={() => {
                  setNewFolderName("");
                  setCreateFolderOpen(true);
                }}
              >
                <FolderPlus data-icon="inline-start" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2"
                aria-label="Refresh"
                disabled={!selectedBucket || objects.isLoading}
                onClick={() => void objects.refetch()}
              >
                <RefreshCw data-icon="inline-start" />
              </Button>
            </div>
            {buckets.isLoading || objects.isLoading ? (
              <p className="shrink-0 text-xs text-muted-foreground">Loading S3 objects...</p>
            ) : null}
            {buckets.error || objects.error ? (
              <p className="shrink-0 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                {buckets.error
                  ? formatS3BrowserError(buckets.error, "listBuckets")
                  : formatS3BrowserError(objects.error, "listObjects", currentS3Path)}
              </p>
            ) : null}
            <nav
              aria-label="S3 objects"
              className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              tabIndex={0}
              ref={objectListRef}
              onKeyDown={handleObjectListKeyDown}
            >
              {(objects.data ?? []).map((object) => {
                const objectName = displayObjectName(object.key, prefix, object.kind);
                const isRenaming = renamingKey === object.key;

                if (isRenaming) {
                  return (
                    <Input
                      key={object.key}
                      autoFocus
                      className="h-7 font-mono text-xs"
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
                    className={cn(
                      "flex min-w-0 w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-1.5 text-left text-xs hover:bg-accent",
                      object.kind === "file" && "font-mono",
                      object.key === selectedKey && "bg-primary/10 text-primary"
                    )}
                    type="button"
                    data-active={object.key === selectedKey}
                    title={objectName}
                    onClick={() => setSelectedKey(object.key)}
                    onDoubleClick={() => {
                      if (object.kind === "folder") {
                        setPrefix(object.key);
                        setSelectedKey(undefined);
                        setContent("");
                        return;
                      }
                      startRename(object);
                    }}
                  >
                    <span className="flex min-w-0 w-full items-center gap-1.5">
                      {object.kind === "folder" ? (
                        <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 truncate">{objectName}</span>
                    </span>
                    {object.kind === "file" ? (
                      <span className="w-full truncate pl-5 text-[10px] leading-tight text-muted-foreground">
                        {formatObjectListMeta(object)}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </nav>
            {objects.data?.length === 0 ? <p className="shrink-0 text-xs text-muted-foreground">No objects under this prefix.</p> : null}
          </CardContent>
        </Card>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize browser pane"
          aria-valuemin={BROWSER_PANE_MIN_WIDTH}
          aria-valuemax={BROWSER_PANE_MAX_WIDTH}
          aria-valuenow={browserPaneWidth}
          tabIndex={0}
          className="group relative w-2 shrink-0 cursor-col-resize touch-none"
          onMouseDown={beginBrowserPaneResize}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              nudgeBrowserPaneWidth(-16);
            }
            if (event.key === "ArrowRight") {
              event.preventDefault();
              nudgeBrowserPaneWidth(16);
            }
          }}
        >
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:bg-primary/50 group-focus-visible:bg-primary" />
        </div>
        <Card className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" role="region" aria-label="Selected S3 object">
          <CardHeader className="shrink-0 flex-row items-start justify-between gap-4">
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
                        className="h-6 shrink-0 px-1.5"
                        aria-label="Copy S3 path"
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
          <CardContent className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
            {textObject.error ? (
              <p className="shrink-0 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                {formatS3BrowserError(textObject.error, "getObject", selectedObjectPath)}
              </p>
            ) : null}
            {textObject.isLoading && selectedObject?.kind === "file" ? (
              <p className="shrink-0 text-xs text-muted-foreground">Loading object content...</p>
            ) : null}
            <div className="relative min-h-0 flex-1">
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
              <S3ObjectEditor
                ref={editorRef}
                className="h-full"
                value={content}
                fileKey={selectedKey}
                readOnly={!editability?.editable}
                onChange={setContent}
                onSave={() => void save()}
                onFocusList={() => objectListRef.current?.focus()}
                onReadOnlyInput={notifyReadOnlyEditAttempt}
              />
            </div>
            <div className="flex shrink-0 justify-end gap-2">
              <Button
                variant="outline"
                disabled={!selectedBucket || !selectedKey || deletePending || deleteSummaryLoading}
                onClick={requestDeleteSelected}
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
      {pathPickerOpen ? (
        <S3PathPickerDialog
          open={pathPickerOpen}
          onOpenChange={setPathPickerOpen}
          initialPath={currentS3Path}
          onSelect={applySelectedPath}
        />
      ) : null}
      <Dialog open={createFolderOpen} onOpenChange={(open) => !open && setCreateFolderOpen(false)}>
        <DialogContent>
          <form onSubmit={(event) => void submitCreateFolder(event)}>
            <DialogHeader>
              <DialogTitle>Create folder</DialogTitle>
              <DialogDescription>
                {selectedBucket
                  ? `Create a new folder under s3://${selectedBucket}/${prefix}`
                  : "Select a bucket first."}
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Input
                autoFocus
                value={newFolderName}
                placeholder="folder-name"
                className="font-mono text-sm"
                onChange={(event) => setNewFolderName(event.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateFolderOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createFolder.isPending || !selectedBucket}>
                {createFolder.isPending ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(uploadConflict)}
        onOpenChange={(open) => {
          if (!open && !resolvingUploadConflictRef.current && !conflictBusy && !transferPending) {
            closeUploadConflict({ canceled: true });
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Object already exists</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>An object already exists at this location:</p>
                {uploadConflict ? (
                  <p className="break-all font-mono text-foreground">
                    s3://{uploadConflict.bucket}/{uploadConflict.key}
                  </p>
                ) : null}
                <p>Overwrite it, upload under a new name, or cancel.</p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <label htmlFor="upload-conflict-rename" className="text-sm font-medium">
              Upload as
            </label>
            <Input
              id="upload-conflict-rename"
              autoFocus
              value={conflictRenameValue}
              className="font-mono text-sm"
              disabled={conflictBusy || transferPending}
              onChange={(event) => setConflictRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void renameConflictUpload();
                }
              }}
            />
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              disabled={conflictBusy || transferPending}
              onClick={() => closeUploadConflict({ canceled: true })}
            >
              Cancel
            </Button>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={conflictBusy || transferPending || !uploadConflict}
                onClick={overwriteConflictUpload}
              >
                Overwrite
              </Button>
              <Button
                type="button"
                disabled={
                  conflictBusy ||
                  transferPending ||
                  !uploadConflict ||
                  !isValidUploadFileName(conflictRenameValue)
                }
                onClick={() => void renameConflictUpload()}
              >
                {conflictBusy ? "Checking…" : "Rename & upload"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && closeDeleteDialog()}>
        <DialogContent className="max-w-lg overflow-hidden">
          <DialogHeader>
            <DialogTitle>
              {deleteTarget?.kind === "folder" ? "Delete S3 folder?" : "Delete S3 object?"}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                {deleteTarget ? (
                  <p>
                    This will permanently delete{" "}
                    <span className="block break-all font-mono text-foreground">
                      s3://{deleteTarget.bucket}/{deleteTarget.key}
                    </span>
                  </p>
                ) : null}
                {deleteTarget?.kind === "folder" && deleteSummaryLoading ? (
                  <p>Inspecting folder contents...</p>
                ) : null}
                {deleteTarget?.kind === "folder" && deleteSummary && folderDeleteIsNonEmpty ? (
                  <div className="rounded-md border bg-muted/30 p-3 text-foreground">
                    <p className="font-medium">Expected deletion summary</p>
                    <ul className="mt-2 space-y-1 font-mono text-xs">
                      <li>Files: {deleteSummary.fileCount}</li>
                      <li>Subfolders: {deleteSummary.folderCount}</li>
                      <li>Total objects: {deleteSummary.totalObjectCount}</li>
                      <li>Total size: {formatBytes(deleteSummary.totalBytes)}</li>
                    </ul>
                    {deleteSummary.truncated ? (
                      <p className="mt-2 text-xs text-amber-600">
                        Preview is truncated. The folder may contain more objects than shown.
                      </p>
                    ) : null}
                    <p className="mt-2 text-xs">
                      All files and subfolders under this prefix will be deleted.
                    </p>
                  </div>
                ) : null}
                {deleteTarget?.kind === "folder" && deleteSummary && !folderDeleteIsNonEmpty ? (
                  <p>This folder appears empty and will be removed.</p>
                ) : null}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={closeDeleteDialog}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteSummaryLoading}
              onClick={confirmDelete}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function formatObjectListMeta(object: S3ObjectEntry) {
  const parts = [formatBytes(object.size)];
  const modified = formatS3Timestamp(object.lastModified);
  if (modified) parts.push(modified);
  return parts.join(" · ");
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
