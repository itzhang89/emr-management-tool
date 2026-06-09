import { Copy, Download, Folder, Save, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useS3Buckets, useS3Objects, useS3TextObject, useSaveS3TextObject } from "@/hooks/useS3";
import { getS3ObjectEditability } from "@/services/s3Rules";

export function S3BrowserPage() {
  const buckets = useS3Buckets();
  const selectedBucket = buckets.data?.[0]?.name;
  const objects = useS3Objects(selectedBucket);
  const [selectedKey, setSelectedKey] = useState<string>();
  const selectedObject = useMemo(
    () => objects.data?.find((object) => object.key === selectedKey),
    [objects.data, selectedKey]
  );
  const textObject = useS3TextObject(selectedBucket, selectedKey);
  const saveObject = useSaveS3TextObject();
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
    const saved = await saveObject.mutateAsync({ ...textObject.data, content });
    toast.success(`Saved ${saved.key}`);
  };

  const copyPath = async () => {
    if (!selectedBucket || !selectedKey) return;
    await navigator.clipboard?.writeText(`s3://${selectedBucket}/${selectedKey}`);
    toast.success("S3 path copied.");
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">S3 Browser</h1>
          <p className="text-sm text-muted-foreground">Browse S3 buckets and edit supported text files.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">
            <Upload data-icon="inline-start" />
            Upload
          </Button>
          <Button variant="outline">
            <Download data-icon="inline-start" />
            Download
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-[340px_1fr] gap-6">
        <Card>
          <CardHeader>
            <CardTitle>s3://{selectedBucket ?? "loading"}</CardTitle>
            <CardDescription>Supported text files can be edited in place.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {(objects.data ?? []).map((object) => (
              <button
                key={object.key}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent data-[active=true]:bg-primary data-[active=true]:text-primary-foreground"
                type="button"
                data-active={object.key === selectedKey}
                onClick={() => setSelectedKey(object.key)}
              >
                <Folder className="size-4 text-muted-foreground" />
                {object.key}
              </button>
            ))}
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
              <Button variant="outline">
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
