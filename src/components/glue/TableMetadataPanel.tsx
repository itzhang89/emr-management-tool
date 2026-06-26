import { Pencil, Save, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cloneGlueTableDetail } from "@/hooks/useGlue";
import type { GlueTableDetail } from "@/types/domain";

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
        onChange={(columns) => setDraft({ ...draft, columns })}
      />

      <ColumnSection
        title="Partition keys"
        columns={editMode ? draft.partitionKeys : table.partitionKeys}
        editMode={editMode}
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

function ColumnSection({
  title,
  columns,
  editMode,
  onChange
}: {
  title: string;
  columns: GlueTableDetail["columns"];
  editMode: boolean;
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
            </tr>
          </thead>
          <tbody>
            {columns.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-2 text-muted-foreground">
                  No columns.
                </td>
              </tr>
            ) : (
              columns.map((column, index) => (
                <tr key={`${column.name}-${index}`} className="border-t">
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
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
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
  const entries = Object.entries(values);

  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground">{title}</Label>
      <div className="overflow-auto rounded-md border">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Key</th>
              <th className="px-3 py-2">Value</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={2} className="px-3 py-2 text-muted-foreground">
                  No parameters.
                </td>
              </tr>
            ) : (
              entries.map(([key, value]) => (
                <tr key={key} className="border-t">
                  <td className="px-3 py-2 font-mono text-xs">{key}</td>
                  <td className="px-3 py-2">
                    {editMode ? (
                      <Input
                        value={value}
                        onChange={(event) => onChange({ ...values, [key]: event.target.value })}
                      />
                    ) : (
                      value
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
