import { Copy, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cloneGlueTableDetail } from "@/hooks/useGlue";
import { buildCreateTableDdl } from "@/services/glueTableDdl";
import { formatAppError } from "@/services/appErrorMessage";
import type { GlueColumn, GlueTableDetail } from "@/types/domain";

export function TableMetadataPanel({
  table,
  loading,
  error,
  editMode,
  onEditModeChange,
  onSave,
  saving
}: {
  table?: GlueTableDetail;
  loading: boolean;
  error?: unknown;
  editMode: boolean;
  onEditModeChange: (editMode: boolean) => void;
  onSave: (table: GlueTableDetail) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState<GlueTableDetail | undefined>();

  useEffect(() => {
    setDraft(table ? cloneGlueTableDetail(table) : undefined);
  }, [table]);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading table metadata...</p>;
  }

  if (error) {
    return <p className="text-sm text-destructive">Failed to load table metadata.</p>;
  }

  if (!table || !draft) {
    return <p className="text-sm text-muted-foreground">Select a table to view metadata.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-medium">
            {table.databaseName}.{table.name}
          </h3>
          <p className="text-xs text-muted-foreground">Read-only by default. Enable edit mode to update Glue metadata.</p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!table}
            onClick={async () => {
              try {
                await navigator.clipboard?.writeText(buildCreateTableDdl(table));
                toast.success("CREATE TABLE DDL copied.");
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
                  setDraft(cloneGlueTableDetail(table));
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

      <MetadataField label="Description" readOnly={!editMode}>
        {editMode ? (
          <Textarea
            value={draft.description ?? ""}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            rows={2}
          />
        ) : (
          <p className="text-sm">{table.description || "—"}</p>
        )}
      </MetadataField>

      <div className="grid gap-4 md:grid-cols-2">
        <MetadataField label="Owner" readOnly={!editMode}>
          {editMode ? (
            <Input value={draft.owner ?? ""} onChange={(event) => setDraft({ ...draft, owner: event.target.value })} />
          ) : (
            <p className="text-sm">{table.owner || "—"}</p>
          )}
        </MetadataField>
        <MetadataField label="Table type" readOnly={!editMode}>
          {editMode ? (
            <Input
              value={draft.tableType ?? ""}
              onChange={(event) => setDraft({ ...draft, tableType: event.target.value })}
            />
          ) : (
            <p className="text-sm">{table.tableType || "—"}</p>
          )}
        </MetadataField>
      </div>

      <MetadataField label="Location" readOnly={!editMode}>
        {editMode ? (
          <Input
            value={draft.location ?? ""}
            onChange={(event) => setDraft({ ...draft, location: event.target.value })}
          />
        ) : (
          <p className="break-all font-mono text-sm">{table.location || "—"}</p>
        )}
      </MetadataField>

      <ColumnSection
        title="Columns"
        columns={editMode ? draft.columns : table.columns}
        editMode={editMode}
        addLabel="Add column"
        onChange={(columns) => setDraft({ ...draft, columns })}
      />

      <ColumnSection
        title="Partition keys"
        columns={editMode ? draft.partitionKeys : table.partitionKeys}
        editMode={editMode}
        addLabel="Add partition key"
        onChange={(partitionKeys) => setDraft({ ...draft, partitionKeys })}
      />

      <MetadataField label="Storage formats" readOnly>
        <p className="font-mono text-xs text-muted-foreground">
          input: {table.inputFormat || "—"} · output: {table.outputFormat || "—"} · serde: {table.serdeLibrary || "—"}
        </p>
      </MetadataField>

      <KeyValueSection
        title="Parameters"
        values={editMode ? draft.parameters : table.parameters}
        editMode={editMode}
        onChange={(parameters) => setDraft({ ...draft, parameters })}
      />
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

function emptyColumn(): GlueColumn {
  return { name: "", type: "string", comment: "" };
}

function ColumnSection({
  title,
  columns,
  editMode,
  addLabel,
  onChange
}: {
  title: string;
  columns: GlueTableDetail["columns"];
  editMode: boolean;
  addLabel: string;
  onChange: (columns: GlueTableDetail["columns"]) => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground">{title}</Label>
      <div className="overflow-auto rounded-md border">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Comment</th>
              {editMode ? <th className="w-12 px-3 py-2" /> : null}
            </tr>
          </thead>
          <tbody>
            {columns.length === 0 ? (
              <tr>
                <td colSpan={editMode ? 4 : 3} className="px-3 py-2 text-muted-foreground">
                  No columns.
                </td>
              </tr>
            ) : (
              columns.map((column, index) => (
                <tr key={`column-${index}`} className="border-t">
                  <td className="px-3 py-2">
                    {editMode ? (
                      <Input
                        value={column.name}
                        onChange={(event) => {
                          const next = [...columns];
                          next[index] = { ...column, name: event.target.value };
                          onChange(next);
                        }}
                      />
                    ) : (
                      column.name
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {editMode ? (
                      <Input
                        value={column.type}
                        onChange={(event) => {
                          const next = [...columns];
                          next[index] = { ...column, type: event.target.value };
                          onChange(next);
                        }}
                      />
                    ) : (
                      column.type
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {editMode ? (
                      <Input
                        value={column.comment ?? ""}
                        onChange={(event) => {
                          const next = [...columns];
                          next[index] = { ...column, comment: event.target.value };
                          onChange(next);
                        }}
                      />
                    ) : (
                      column.comment || "—"
                    )}
                  </td>
                  {editMode ? (
                    <td className="px-3 py-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={`Remove ${title.toLowerCase()} ${column.name || index + 1}`}
                        onClick={() => onChange(columns.filter((_, entryIndex) => entryIndex !== index))}
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
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...columns, emptyColumn()])}>
          <Plus data-icon="inline-start" />
          {addLabel}
        </Button>
      ) : null}
    </div>
  );
}

function KeyValueSection({
  title,
  values,
  editMode,
  onChange
}: {
  title: string;
  values: Record<string, string>;
  editMode: boolean;
  onChange: (values: Record<string, string>) => void;
}) {
  const [entries, setEntries] = useState<Array<{ key: string; value: string }>>(() =>
    Object.entries(values).map(([key, value]) => ({ key, value }))
  );

  useEffect(() => {
    if (editMode) return;
    setEntries(Object.entries(values).map(([key, value]) => ({ key, value })));
  }, [editMode, values]);

  useEffect(() => {
    if (!editMode) return;
    setEntries(Object.entries(values).map(([key, value]) => ({ key, value })));
  }, [editMode]);

  const toRecord = (next: Array<{ key: string; value: string }>) => {
    const record: Record<string, string> = {};
    for (const entry of next) {
      const key = entry.key.trim();
      if (!key) continue;
      record[key] = entry.value;
    }
    return record;
  };

  const commitEntries = (next: Array<{ key: string; value: string }>) => {
    setEntries(next);
    onChange(toRecord(next));
  };

  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground">{title}</Label>
      <div className="overflow-auto rounded-md border">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Key</th>
              <th className="px-3 py-2">Value</th>
              {editMode ? <th className="w-12 px-3 py-2" /> : null}
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={editMode ? 3 : 2} className="px-3 py-2 text-muted-foreground">
                  No parameters.
                </td>
              </tr>
            ) : (
              entries.map((entry, index) => (
                <tr key={`param-${index}`} className="border-t">
                  <td className="px-3 py-2">
                    {editMode ? (
                      <Input
                        value={entry.key}
                        className="font-mono text-xs"
                        onChange={(event) => {
                          const next = [...entries];
                          next[index] = { ...entry, key: event.target.value };
                          commitEntries(next);
                        }}
                      />
                    ) : (
                      <span className="font-mono text-xs">{entry.key}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {editMode ? (
                      <Input
                        value={entry.value}
                        onChange={(event) => {
                          const next = [...entries];
                          next[index] = { ...entry, value: event.target.value };
                          commitEntries(next);
                        }}
                      />
                    ) : (
                      entry.value
                    )}
                  </td>
                  {editMode ? (
                    <td className="px-3 py-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={`Remove parameter ${entry.key || index + 1}`}
                        onClick={() => commitEntries(entries.filter((_, entryIndex) => entryIndex !== index))}
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setEntries([...entries, { key: "", value: "" }])}
        >
          <Plus data-icon="inline-start" />
          Add parameter
        </Button>
      ) : null}
    </div>
  );
}
