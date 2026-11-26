import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAccountTemplateVariables, useSaveAccountTemplateVariables } from "@/hooks/useAccountTemplateVariables";
import { useT } from "@/i18n";
import {
  AccountVariablesEnvError,
  formatAccountTemplateVariablesEnv,
  isAccountTemplateVariableName,
  parseAccountTemplateVariablesEnv
} from "@/services/accountTemplateVariablesEnv";
import type { AccountTemplateVariables } from "@/types/domain";

const envErrors = {
  assignment: "Expected KEY=value.",
  name: "Invalid or reserved variable name.",
  duplicate: "This variable is already defined.",
  quote: "Check the quoted value."
};

function makeRows(variables: AccountTemplateVariables) {
  return Object.entries(variables).map(([name, value]) => ({ id: crypto.randomUUID(), name, value }));
}

export function AccountTemplateVariablesEditor({ accountId }: { accountId: string }) {
  const t = useT();
  const variables = useAccountTemplateVariables(accountId);

  return (
    <section className="space-y-3">
      <h2 className="text-base font-medium">{t("Custom variables")}</h2>
      {variables.data ? (
        <AccountTemplateVariablesForm key={accountId} accountId={accountId} initialValues={variables.data} />
      ) : variables.isError ? (
        <p role="alert" className="text-sm text-destructive">{t("Could not load account template variables.")}</p>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">{t("Loading…")}</p>
      )}
    </section>
  );
}

function AccountTemplateVariablesForm({
  accountId,
  initialValues
}: {
  accountId: string;
  initialValues: AccountTemplateVariables;
}) {
  const t = useT();
  const save = useSaveAccountTemplateVariables(accountId);
  const [savedRows, setSavedRows] = useState(() => makeRows(initialValues));
  const [savedEnv, setSavedEnv] = useState(() => formatAccountTemplateVariablesEnv(initialValues));
  const [rows, setRows] = useState(savedRows);
  const [mode, setMode] = useState<"form" | "env">("form");
  const [envDraft, setEnvDraft] = useState(savedEnv);
  const [envError, setEnvError] = useState<string>();
  const rowsDirty = rows.length !== savedRows.length || rows.some(
    (row, index) => row.name !== savedRows[index].name || row.value !== savedRows[index].value
  );
  const dirty = mode === "env" ? envDraft !== savedEnv : rowsDirty;

  const readForm = () => {
    const variables: AccountTemplateVariables = Object.create(null);
    for (const row of rows) {
      const name = row.name.trim();
      if (!isAccountTemplateVariableName(name)) {
        toast.error(t("Use letters, numbers or underscores for variable names. Built-in names are reserved."));
        return;
      }
      if (Object.hasOwn(variables, name)) {
        toast.error(t("Variable {name} appears more than once.", { name }));
        return;
      }
      variables[name] = row.value;
    }
    return variables;
  };

  const readEnv = () => {
    try {
      setEnvError(undefined);
      return parseAccountTemplateVariablesEnv(envDraft);
    } catch (error) {
      if (!(error instanceof AccountVariablesEnvError)) throw error;
      setEnvError(t("Line {line}: {reason}", { line: error.line, reason: t(envErrors[error.reason]) }));
    }
  };

  const switchMode = (nextMode: "form" | "env") => {
    if (mode === nextMode) return;
    if (nextMode === "env") {
      const variables = readForm();
      if (!variables) return;
      setEnvDraft(formatAccountTemplateVariablesEnv(variables));
    } else {
      const variables = readEnv();
      if (!variables) return;
      setRows(makeRows(variables));
    }
    setMode(nextMode);
  };

  const saveVariables = async (event: FormEvent) => {
    event.preventDefault();
    if (!dirty || save.isPending) return;
    const variables = mode === "env" ? readEnv() : readForm();
    if (!variables) return;
    try {
      await save.mutateAsync(variables);
      const normalizedRows = mode === "env" ? makeRows(variables) : rows.map((row) => ({ ...row, name: row.name.trim() }));
      const normalizedEnv = formatAccountTemplateVariablesEnv(variables);
      setSavedRows(normalizedRows);
      setRows(normalizedRows);
      setSavedEnv(normalizedEnv);
      setEnvDraft(normalizedEnv);
      toast.success(t("Account template variables saved."));
    } catch {
      toast.error(t("Could not save account template variables."));
    }
  };

  return (
    <form className="space-y-4" onSubmit={saveVariables}>
      <fieldset disabled={save.isPending} className="space-y-4">
        <div className="flex gap-2" role="group" aria-label={t("Variable editor mode")}>
          <Button type="button" variant={mode === "form" ? "secondary" : "ghost"}
            aria-pressed={mode === "form"} onClick={() => switchMode("form")}>
            {t("Form")}
          </Button>
          <Button type="button" variant={mode === "env" ? "secondary" : "ghost"}
            aria-pressed={mode === "env"} onClick={() => switchMode("env")}>
            .env
          </Button>
        </div>
        {mode === "env" ? (
          <div className="space-y-2">
            <Textarea
              aria-label={t("Edit variables as .env")}
              aria-invalid={Boolean(envError)}
              aria-describedby={envError ? "account-env-error" : undefined}
              className="min-h-52 font-mono"
              rows={10}
              spellCheck={false}
              autoCapitalize="none"
              value={envDraft}
              onChange={(event) => {
                setEnvDraft(event.target.value);
                setEnvError(undefined);
              }}
            />
            {envError ? <p id="account-env-error" role="alert" className="text-sm text-destructive">{envError}</p> : null}
            <p className="text-sm text-muted-foreground">{t("Use KEY=value, one variable per line. Lines starting with # are comments.")}</p>
          </div>
        ) : (
          <>
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("No template variables for this account.")}</p>
            ) : null}
            <div className="max-h-[50vh] space-y-2 overflow-auto">
              {rows.map((row, index) => (
                <div className="grid grid-cols-[1fr_1.5fr_auto] gap-2" key={row.id}>
                  <Input
                    aria-label={t("Variable name {index}", { index: index + 1 })}
                    placeholder={t("Variable name")}
                    value={row.name}
                    autoCapitalize="none"
                    spellCheck={false}
                    onChange={(event) => {
                      const name = event.target.value;
                      setRows((current) => current.map((item) => item.id === row.id ? { ...item, name } : item));
                    }}
                  />
                  <Textarea
                    rows={1}
                    className="min-h-9"
                    aria-label={t("Variable value {index}", { index: index + 1 })}
                    placeholder={t("Value")}
                    value={row.value}
                    onChange={(event) => {
                      const value = event.target.value;
                      setRows((current) => current.map((item) => item.id === row.id ? { ...item, value } : item));
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("Remove variable {index}", { index: index + 1 })}
                    onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRows((current) => [...current, { id: crypto.randomUUID(), name: "", value: "" }])}
            >
              <Plus /> {t("Add Variable")}
            </Button>
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={!dirty} onClick={() => {
            setRows(savedRows);
            setEnvDraft(savedEnv);
            setEnvError(undefined);
          }}>
            {t("Reset")}
          </Button>
          <Button type="submit" disabled={!dirty || save.isPending}>{t("Save")}</Button>
        </div>
      </fieldset>
    </form>
  );
}
