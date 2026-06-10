import { Copy, Download, Folder, Save, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import type { AppError } from "@/types/domain";

export function S3BrowserPage() {
  const buckets = useS3Buckets();
  const selectedBucket = buckets.data?.[0]?.name;
  const [prefix, setPrefix] = useState("");
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
            <CardTitle>s3://{selectedBucket ?? "loading"}/{prefix}</CardTitle>
            <CardDescription>Supported text files can be edited in place.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {prefix ? (
              <Button
                type="button"
                variant="ghost"
                className="justify-start"
                onClick={() => {
                  const parent = prefix.split("/").filter(Boolean).slice(0, -1).join("/");
                  setPrefix(parent ? `${parent}/` : "");
                  setSelectedKey(undefined);
                }}
              >
                ../
              </Button>
            ) : null}
            {buckets.isLoading || objects.isLoading ? <p className="text-sm text-muted-foreground">Loading S3 objects...</p> : null}
            {buckets.error || objects.error ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {errorMessage(buckets.error ?? objects.error, "Failed to load S3 data.")}
              </p>
            ) : null}
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
                    return;
                  }
                  setSelectedKey(object.key);
                }}
              >
                <Folder className="size-4 text-muted-foreground" />
                {object.key}
              </button>
            ))}
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

function errorMessage(error: unknown, fallback: string) {
  const appError = error as Partial<AppError>;
  if (appError.code === "DemoModeUnavailable") {
    return "S3 requires the Tauri desktop runtime. Start with npm run tauri -- dev.";
  }
  return appError.message ?? fallback;
}
