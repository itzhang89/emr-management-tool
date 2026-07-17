import { Info, Copy, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cloneGlueDatabaseDetail } from "@/hooks/useGlue";
import { formatAppError } from "@/services/appErrorMessage";
import { buildCreateDatabaseDdl } from "@/services/glueDatabaseDdl";
import type { GlueDatabaseDetail } from "@/types/domain";

export function DatabaseMetadataPanel({
  database,
  loading,
  error,
  editMode,
  onEditModeChange,
  onSave,
  saving
}: {
  database?: GlueDatabaseDetail;
  loading: boolean;
  error?: unknown;
  editMode: boolean;
  onEditModeChange: (editMode: boolean) => void;
  onSave: (database: GlueDatabaseDetail) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState<GlueDatabaseDetail | undefined>();
  const [newPropertyKey, setNewPropertyKey] = useState("");
  const [newPropertyValue, setNewPropertyValue] = useState("");

  useEffect(() => {
    setDraft(database ? cloneGlueDatabaseDetail(database) : undefined);
    setNewPropertyKey("");
    setNewPropertyValue("");
  }, [database]);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading database metadata...</p>;
  }

  if (error) {
    return <p className="text-sm text-destructive">Failed to load database metadata.</p>;
  }

  if (!database || !draft) {
    return (
      <p className="text-sm text-muted-foreground">
        Hover a database in the catalog and click the info icon to view metadata.
      </p>
    );
  }

  const addProperty = () => {
    const key = newPropertyKey.trim();
    if (!key) return;
    setDraft({
      ...draft,
      parameters: { ...draft.parameters, [key]: newPropertyValue }
    });
    setNewPropertyKey("");
    setNewPropertyValue("");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 font-medium">
            <Info className="size-4 text-muted-foreground" />
            {database.name}
          </h3>
          <p className="text-xs text-muted-foreground">
            Read-only by default. Enable edit mode to update Glue database metadata.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!database}
            onClick={async () => {
              try {
                await navigator.clipboard?.writeText(buildCreateDatabaseDdl(database));
                toast.success("CREATE DATABASE DDL copied.");
              } catch (error) {
                toast.error(formatAppError(error, "Failed to copy DDL."));
              }
            }}
          >
            <Copy data-icon="inline-start" />
            Copy DDL
          </Button>
          {editMode ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setDraft(cloneGlueDatabaseDetail(database));
                  onEditModeChange(false);
                }}
              >
                <X data-icon="inline-start" />
                Cancel
              </Button>
              <Button type="button" size="sm" disabled={saving} onClick={() => onSave(draft)}>
                <Save data-icon="inline-start" />
                Save
              </Button>
            </>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => onEditModeChange(true)}>
              <Pencil data-icon="inline-start" />
              Edit metadata
            </Button>
          )}
        </div>
      </div>

      <MetadataField label="COMMENT" readOnly={!editMode}>
        {editMode ? (
          <Textarea
            value={draft.description ?? ""}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            rows={2}
          />
        ) : (
          <p className="text-sm">{database.description || "—"}</p>
        )}
      </MetadataField>

      <MetadataField label="LOCATION" readOnly={!editMode}>
        {editMode ? (
          <Input
            value={draft.locationUri ?? ""}
            onChange={(event) => setDraft({ ...draft, locationUri: event.target.value })}
            placeholder="s3://bucket/path/database.db/"
          />
        ) : (
          <p className="break-all font-mono text-sm">{database.locationUri || "—"}</p>
        )}
      </MetadataField>

      <MetadataField label="Created" readOnly>
        <p className="text-sm">{database.createTime || "—"}</p>
      </MetadataField>

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">DBPROPERTIES</Label>
        <div className="overflow-auto rounded-md border">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Key</th>
                <th className="px-3 py-2">Value</th>
                {editMode ? <th className="px-3 py-2 w-12" /> : null}
              </tr>
            </thead>
            <tbody>
              {Object.entries(editMode ? draft.parameters : database.parameters).length === 0 ? (
                <tr>
                  <td colSpan={editMode ? 3 : 2} className="px-3 py-2 text-muted-foreground">
                    No properties.
                  </td>
                </tr>
              ) : (
                Object.entries(editMode ? draft.parameters : database.parameters).map(([key, value]) => (
                  <tr key={key} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">{key}</td>
                    <td className="px-3 py-2">
                      {editMode ? (
                        <Input
                          value={value}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              parameters: { ...draft.parameters, [key]: event.target.value }
                            })
                          }
                        />
                      ) : (
                        value
                      )}
                    </td>
                    {editMode ? (
                      <td className="px-3 py-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={`Remove property ${key}`}
                          onClick={() => {
                            const next = { ...draft.parameters };
                            delete next[key];
                            setDraft({ ...draft, parameters: next });
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {editMode ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[140px] flex-1 space-y-1">
              <Label className="text-xs text-muted-foreground">New key</Label>
              <Input value={newPropertyKey} onChange={(event) => setNewPropertyKey(event.target.value)} />
            </div>
            <div className="min-w-[140px] flex-1 space-y-1">
              <Label className="text-xs text-muted-foreground">New value</Label>
              <Input value={newPropertyValue} onChange={(event) => setNewPropertyValue(event.target.value)} />
            </div>
            <Button type="button" variant="outline" size="sm" onClick={addProperty} disabled={!newPropertyKey.trim()}>
              <Plus data-icon="inline-start" />
              Add
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MetadataField({
  label,
  readOnly,
  children
}: {
  label: string;
  readOnly?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">
        {label}
        {readOnly ? " (read-only)" : ""}
      </Label>
      {children}
    </div>
  );
}
