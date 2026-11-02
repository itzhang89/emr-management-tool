import { Copy, Pencil, Save, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n";
import { formatAppError } from "@/services/appErrorMessage";
import { cn } from "@/lib/utils";
import type { DbTableColumn, DbTableDetail, DbTableIndex } from "@/types/domain";

function cloneDetail(table: DbTableDetail): DbTableDetail {
  return {
    ...table,
    columns: table.columns.map((column) => ({ ...column })),
    indexes: table.indexes.map((index) => ({
      ...index,
      columns: [...index.columns]
    })),
    properties: { ...table.properties }
  };
}

function formatBytes(value?: number) {
  if (value == null || Number.isNaN(value)) return "—";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value;
  let unit = -1;
  do {
    size /= 1024;
    unit += 1;
  } while (size >= 1024 && unit < units.length - 1);
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function DbTableMetadataPanel({
  table,
  loading,
  error,
  editMode,
  onEditModeChange,
  onSave,
  saving,
  canEdit
}: {
  table?: DbTableDetail;
  loading: boolean;
  error?: unknown;
  editMode: boolean;
  onEditModeChange: (editMode: boolean) => void;
  onSave: (draft: {
    comment?: string | null;
    columnComments: Array<{ name: string; comment?: string | null }>;
  }) => void;
  saving: boolean;
  /** False when the connection forbids writes — Edit stays hidden. */
  canEdit: boolean;
}) {
  const t = useT();
  const [draft, setDraft] = useState<DbTableDetail | undefined>();
  const [descriptionEditing, setDescriptionEditing] = useState(false);

  useEffect(() => {
    setDraft(table ? cloneDetail(table) : undefined);
    setDescriptionEditing(false);
  }, [table]);

  useEffect(() => {
    if (!editMode) setDescriptionEditing(false);
  }, [editMode]);

  if (loading) {
    return <p className="text-sm text-muted-foreground">{t("Loading table metadata...")}</p>;
  }

  if (error) {
    return (
      <p className="text-sm text-destructive">
        {formatAppError(error, t("Failed to load table metadata."))}
      </p>
    );
  }

  if (!table || !draft) {
    return <p className="text-sm text-muted-foreground">{t("Select a table to view metadata.")}</p>;
  }

  const exitEditMode = () => {
    setDraft(cloneDetail(table));
    setDescriptionEditing(false);
    onEditModeChange(false);
  };

  const qualified = [table.database, table.schema, table.name].filter(Boolean).join(".");
  const ddl = table.ddl?.trim() ?? "";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-medium">{qualified}</h3>
          <p className="text-xs text-muted-foreground">
            {canEdit
              ? t("Read-only by default. Enable edit mode to update comments.")
              : t("Read-only. Turn on Allow writes on the connection to edit comments.")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!ddl}
            onClick={async () => {
              try {
                await navigator.clipboard?.writeText(ddl);
                toast.success(t("CREATE TABLE DDL copied."));
              } catch (copyError) {
                toast.error(formatAppError(copyError, t("Failed to copy DDL.")));
              }
            }}
          >
            <Copy data-icon="inline-start" />
            {t("Copy DDL")}
          </Button>
          {canEdit ? (
            editMode ? (
              <>
                <Button type="button" variant="outline" size="sm" onClick={exitEditMode}>
                  <X data-icon="inline-start" />
                  {t("Cancel")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={saving}
                  onClick={() => {
                    setDescriptionEditing(false);
                    onSave({
                      comment: draft.comment ?? "",
                      columnComments: draft.columns.map((column) => ({
                        name: column.name,
                        comment: column.comment ?? ""
                      }))
                    });
                  }}
                >
                  <Save data-icon="inline-start" />
                  {t("Save")}
                </Button>
              </>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={() => onEditModeChange(true)}>
                <Pencil data-icon="inline-start" />
                {t("Edit metadata")}
              </Button>
            )
          ) : null}
        </div>
      </div>

      <MetadataField
        label={t("Description")}
        readOnly={!editMode || !descriptionEditing}
        hint={editMode && !descriptionEditing ? t("Double-click to edit") : undefined}
      >
        {editMode && descriptionEditing ? (
          <Textarea
            value={draft.comment ?? ""}
            onChange={(event) => setDraft({ ...draft, comment: event.target.value })}
            rows={2}
            autoFocus
          />
        ) : (
          <p
            className={cn(
              "text-sm",
              editMode && "cursor-text rounded-md px-1 py-0.5 hover:bg-muted/60"
            )}
            title={editMode ? t("Double-click to edit description") : undefined}
            onDoubleClick={() => {
              if (editMode) setDescriptionEditing(true);
            }}
          >
            {(editMode ? draft.comment : table.comment) || "—"}
          </p>
        )}
      </MetadataField>

      <div className="grid gap-4 md:grid-cols-2">
        <MetadataField label={t("Table type")} readOnly>
          <p className="text-sm">{table.tableType || table.objectKind || "—"}</p>
        </MetadataField>
        <MetadataField label={t("Engine")} readOnly>
          <p className="text-sm">{table.engine || "—"}</p>
        </MetadataField>
        <MetadataField label={t("Collation")} readOnly>
          <p className="text-sm">{table.collation || "—"}</p>
        </MetadataField>
        <MetadataField label={t("Estimated rows")} readOnly>
          <p className="text-sm tabular-nums">
            {table.rowEstimate != null ? table.rowEstimate.toLocaleString() : "—"}
          </p>
        </MetadataField>
        <MetadataField label={t("Data size")} readOnly>
          <p className="text-sm">{formatBytes(table.dataLength)}</p>
        </MetadataField>
        <MetadataField label={t("Created")} readOnly>
          <p className="text-sm">{table.createTime || "—"}</p>
        </MetadataField>
        <MetadataField label={t("Updated")} readOnly>
          <p className="text-sm">{table.updateTime || "—"}</p>
        </MetadataField>
      </div>

      <ColumnSection
        columns={editMode ? draft.columns : table.columns}
        editMode={editMode}
        onChange={(columns) => setDraft({ ...draft, columns })}
      />

      <IndexSection indexes={table.indexes} />

      {Object.keys(table.properties).length > 0 ? (
        <KeyValueSection title={t("Properties")} values={table.properties} />
      ) : null}

      {ddl ? (
        <MetadataField label={t("DDL")} readOnly>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-muted/40 p-2 font-mono text-xs leading-relaxed">
            {ddl}
          </pre>
        </MetadataField>
      ) : null}
    </div>
  );
}

function MetadataField({
  label,
  readOnly,
  hint,
  children
}: {
  label: string;
  readOnly?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">
        {label}
        {readOnly ? t(" (read-only)") : ""}
        {hint ? <span className="ml-1 font-normal text-muted-foreground/80">· {hint}</span> : null}
      </Label>
      {children}
    </div>
  );
}

function ColumnSection({
  columns,
  editMode,
  onChange
}: {
  columns: DbTableColumn[];
  editMode: boolean;
  onChange: (columns: DbTableColumn[]) => void;
}) {
  const t = useT();
  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground">{t("Columns")}</Label>
      <div className="overflow-auto rounded-md border">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">{t("#")}</th>
              <th className="px-3 py-2">{t("Name")}</th>
              <th className="px-3 py-2">{t("Type")}</th>
              <th className="px-3 py-2">{t("Null")}</th>
              <th className="px-3 py-2">{t("Default")}</th>
              <th className="px-3 py-2">{t("Key")}</th>
              <th className="px-3 py-2">{t("Extra")}</th>
              <th className="px-3 py-2">{t("Comment")}</th>
            </tr>
          </thead>
          <tbody>
            {columns.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-2 text-muted-foreground">
                  {t("No columns.")}
                </td>
              </tr>
            ) : (
              columns.map((column, index) => (
                <tr key={`${column.name}-${index}`} className="border-t align-top">
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">
                    {column.ordinal ?? index + 1}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{column.name}</td>
                  <td className="px-3 py-2 font-mono text-xs">{column.dataType}</td>
                  <td className="px-3 py-2">
                    {column.nullable == null ? "—" : column.nullable ? t("Yes") : t("No")}
                  </td>
                  <td className="max-w-[12rem] truncate px-3 py-2 font-mono text-xs">
                    {column.defaultValue || "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{column.columnKey || "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{column.extra || "—"}</td>
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

function IndexSection({ indexes }: { indexes: DbTableIndex[] }) {
  const t = useT();
  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground">{t("Indexes")}</Label>
      <div className="overflow-auto rounded-md border">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">{t("Name")}</th>
              <th className="px-3 py-2">{t("Columns")}</th>
              <th className="px-3 py-2">{t("Unique")}</th>
              <th className="px-3 py-2">{t("Type")}</th>
            </tr>
          </thead>
          <tbody>
            {indexes.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-2 text-muted-foreground">
                  {t("No indexes.")}
                </td>
              </tr>
            ) : (
              indexes.map((index) => (
                <tr key={index.name} className="border-t">
                  <td className="px-3 py-2 font-mono text-xs">{index.name}</td>
                  <td className="px-3 py-2 font-mono text-xs">{index.columns.join(", ")}</td>
                  <td className="px-3 py-2">{index.unique ? t("Yes") : t("No")}</td>
                  <td className="px-3 py-2 font-mono text-xs">{index.indexType || "—"}</td>
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
  values
}: {
  title: string;
  values: Record<string, string>;
}) {
  const t = useT();
  const entries = Object.entries(values);
  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground">{title}</Label>
      <div className="overflow-auto rounded-md border">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">{t("Key")}</th>
              <th className="px-3 py-2">{t("Value")}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([key, value]) => (
              <tr key={key} className="border-t">
                <td className="px-3 py-2 font-mono text-xs">{key}</td>
                <td className="px-3 py-2">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
