import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { RedactCategory, RedactRule, RedactTestResult } from "@/types/domain";
import { REDACT_CATEGORIES } from "@/types/domain";
import {
  useRedactConfig,
  useResetRedactConfig,
  useSaveRedactConfig,
  useTestRedactRules
} from "@/hooks/useRedactConfig";
import { applyReplacement, blankCustomRule } from "@/services/redactReplacements";

/** Fixed display label for each category, driven by the wire `category` value. */
const CATEGORY_LABELS: Record<RedactCategory, string> = {
  secret: "Secrets / Tokens",
  pii: "Personal info",
  network: "Network / paths",
  custom: "Custom"
};

/** Readable caption of a built-in's fixed conservative behaviour. */
const BUILTIN_HINTS: Record<string, string> = {
  arn: "a whole ARN (account + resource) becomes [ARN]",
  "s3-bucket": "s3://bucket becomes s3://[S3_BUCKET]/",
  "account-id": "a standalone 12-digit account id becomes [AWS_ACCOUNT_ID]",
  ipv4: "an IPv4 address becomes [IP_ADDRESS]",
  "ec2-host": "an ip-…-…-…-….ec2.internal hostname becomes [HOSTNAME]",
  fqdn: "a hostname with ≥2 dots becomes [HOSTNAME]"
};

const TEST_BOOTSTRAP =
  "Using ip-10-0-1-45.ec2.internal, role arn:aws:iam::123456789012:role/Data and s3://etl-prod/jobs …";

/** The working copy (unsaved edits) of the rule set the panel edits. */
export function RedactionPanel() {
  const source = useRedactConfig();
  const saveRule = useSaveRedactConfig();
  const reset = useResetRedactConfig();
  const test = useTestRedactRules();

  // Seeds from the backend on first answer; edits live here until Save / Reset /
  // Discard replace the slice with the authoritative one.
  const [rules, setRules] = useState<RedactRule[]>([]);
  const [loadedOnce, setLoadedOnce] = useState(false);

  useEffect(() => {
    if (source.data && !loadedOnce) {
      setRules(source.data.rules.map(clone));
      setLoadedOnce(true);
    }
  }, [source.data, loadedOnce]);

  const adopt = (from: RedactRule[]) => {
    setRules(from.map(clone));
  };

  const setEnabledById = (id: string, enabled: boolean) =>
    setRules((prev) => prev.map((rule) => (rule.id === id ? { ...rule, enabled } : rule)));

  const deleteById = (id: string) => setRules((prev) => prev.filter((rule) => rule.id !== id));

  const replaceOne = (draft: RedactRule) =>
    setRules((prev) => prev.map((rule) => (rule.id === draft.id ? { ...draft } : rule)));

  const addCustom = (draft: RedactRule) =>
    setRules((prev) => [...prev, { ...draft, id: newUuid(), kind: "custom" as const }]);

  const onSave = () => {
    saveRule.mutate(rules, {
      onSuccess: (config) => {
        adopt(config.rules);
        toast.success("Redaction rules saved");
      },
      onError: (error: Error) => toast.error(error.message || "Failed to save redaction rules")
    });
  };

  const onReset = () => {
    reset.mutate(undefined, {
      onSuccess: (config) => {
        adopt(config.rules);
        toast.success("Restored the built-in defaults");
      },
      onError: (error: Error) => toast.error(error.message || "Failed to reset")
    });
  };

  const onDiscard = () => {
    if (source.data) adopt(source.data.rules);
  };

  const [editor, setEditor] = useState<{ draft: RedactRule; isNew: boolean } | null>(null);

  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold leading-tight tracking-tight">Redaction rules</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Which values in MCP tool log output are masked before it reaches an AI model.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setEditor({ draft: blankCustomRule(), isNew: true })}
        >
          <Plus data-icon="inline-start" />
          Add custom rule
        </Button>
      </header>

      {!loadedOnce ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-4">
          {REDACT_CATEGORIES.map((category) => {
            const rows = rules.filter((rule) => rule.category === category);
            if (rows.length === 0) return null;
            return (
              <RuleGroup key={category} label={CATEGORY_LABELS[category]}>
                {rows.map((rule) => (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    onToggle={(enabled) => setEnabledById(rule.id, enabled)}
                    onEdit={
                      rule.kind === "custom"
                        ? () => setEditor({ draft: clone(rule), isNew: false })
                        : undefined
                    }
                    onDelete={
                      rule.kind === "custom"
                        ? () => {
                            deleteById(rule.id);
                            toast.success(`Removed "${rule.name}". Save to apply.`);
                          }
                        : undefined
                    }
                  />
                ))}
              </RuleGroup>
            );
          })}
        </div>
      )}

      <TestRules
        rules={rules}
        isTesting={test.isPending}
        result={test.data ?? null}
        onRun={(text) => test.mutate({ text, rules }, { onError: (e: Error) => toast.error(e.message || "Test failed") })}
      />

      {loadedOnce && (
        <div className="sticky bottom-0 z-10 mt-auto flex items-center gap-2 border-t bg-background py-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onReset}
            disabled={reset.isPending}
            className="text-muted-foreground"
          >
            <RotateCcw data-icon="inline-start" />
            Reset to defaults
          </Button>
          <Button variant="outline" size="sm" onClick={onDiscard} disabled={!hasLocalEdits(rules, source.data?.rules)}>
            Discard
          </Button>
          <div className="flex-1" />
          <Button
            size="sm"
            onClick={onSave}
            disabled={saveRule.isPending || !hasLocalEdits(rules, source.data?.rules)}
          >
            <ShieldCheck data-icon="inline-start" />
            {saveRule.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      )}

      {editor ? (
        <RuleEditorDialog
          draft={editor.draft}
          isNew={editor.isNew}
          onClose={() => setEditor(null)}
          onCommit={(value) => {
            if (editor.isNew) addCustom(value);
            else replaceOne(value);
            setEditor(null);
          }}
        />
      ) : null}
    </div>
  );
}

function newUuid(): string {
  // Match the backend's uuid v4 format for new custom rules.
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Math.floor(Date.now() * Math.random()).toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

function hasLocalEdits(rules: RedactRule[], base: RedactRule[] | undefined): boolean {
  if (!base) return true;
  if (rules.length !== base.length) return true;
  const differs = (at: number) => {
    const a = rules[at];
    const b = base[at];
    return (
      a.enabled !== b.enabled ||
      a.name !== b.name ||
      a.category !== b.category ||
      a.pattern !== b.pattern ||
      a.replacement !== b.replacement ||
      a.sample !== b.sample
    );
  };
  return rules.some((_, at) => differs(at));
}

function clone(rule: RedactRule): RedactRule {
  return { ...rule };
}

function RuleGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="border-b px-4 py-2.5">
        <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="grid px-0">{children}</CardContent>
    </Card>
  );
}

function RuleRow({
  rule,
  onToggle,
  onEdit,
  onDelete
}: {
  rule: RedactRule;
  onToggle: (enabled: boolean) => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const builtin = rule.kind === "builtin";
  const hint = builtin
    ? BUILTIN_HINTS[rule.id]
    : `pattern ${rule.pattern}`;
  return (
    <div className="flex items-center gap-3 border-b border-muted/40 px-4 py-2.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{rule.name}</span>
          {builtin ? (
            <Badge variant="secondary">Built-in</Badge>
          ) : null}
          {!rule.enabled ? (
            <span className="text-xs text-muted-foreground">off</span>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch checked={rule.enabled} onCheckedChange={onToggle} aria-label={`Toggle ${rule.name}`} />
      {onEdit ? (
        <Button variant="ghost" size="icon" className="size-8" aria-label={`Edit ${rule.name}`} onClick={onEdit}>
          <Pencil className="size-4" />
        </Button>
      ) : null}
      {onDelete ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-destructive"
          aria-label={`Delete ${rule.name}`}
          onClick={onDelete}
        >
          <Trash2 className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}

function TestRules({
  rules,
  isTesting,
  result,
  onRun
}: {
  rules: RedactRule[];
  isTesting: boolean;
  result: RedactTestResult | null;
  onRun: (text: string) => void;
}) {
  const [text, setText] = useState(TEST_BOOTSTRAP);
  return (
    <Card>
      <CardHeader className="px-4 py-3">
        <CardTitle className="text-sm font-medium">Test against these rules</CardTitle>
        <CardDescription className="text-xs">
          Runs over the current (unsaved) set — add a token your custom rule matches.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 px-4 pb-4">
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={4}
          className="font-mono text-xs"
          data-testid="redact-test-input"
        />
        <div className="flex justify-end">
          <Button size="sm" variant="outline" disabled={isTesting} onClick={() => onRun(text)} data-testid="redact-test-run">
            {isTesting ? "Running…" : "Preview masking"}
          </Button>
        </div>
        {result ? (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Masked</p>
            <pre
              className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 font-mono text-xs text-foreground"
              data-testid="redact-test-masked"
            >
              {result.masked.trim() === "" ? "(empty)" : result.masked}
            </pre>
            <p className="mt-2 text-xs text-muted-foreground" data-testid="redact-test-meta">
              {result.count > 0 ? (
                <>
                  Replaced <span className="font-medium text-foreground">{result.count}</span> spans
                  {result.hits.length > 0 ? (
                    <>
                      {" · "}
                      {result.hits.map((hit) => (
                        <Badge key={hit} variant="outline" className="mx-0.5 px-1.5 text-[10px] font-normal">
                          {hit}
                        </Badge>
                      ))}
                    </>
                  ) : null}
                </>
              ) : (
                "Nothing matched"
              )}
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Nothing run yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

function RuleEditorDialog({
  draft,
  isNew,
  onClose,
  onCommit
}: {
  draft: RedactRule;
  isNew: boolean;
  onClose: () => void;
  onCommit: (rule: RedactRule) => void;
}) {
  const [name, setName] = useState(draft.name ?? "");
  const [category, setCategory] = useState<RedactCategory>(draft.category ?? "custom");
  const [pattern, setPattern] = useState(draft.pattern ?? "");
  const [replacement, setReplacement] = useState(draft.replacement ?? "__MASK_ALL__");
  const [sample, setSample] = useState(draft.sample ?? "");

  const sampleView = sample.trim() || SAMPLE_BY_CATEGORY[category];
  const patternOk = useMemo(() => {
    if (!pattern.trim()) return false;
    try {
      // eslint-disable-next-line no-new
      new RegExp(pattern);
      return true;
    } catch {
      return false;
    }
  }, [pattern]);

  const preview = useMemo(() => {
    if (!patternOk || !sampleView) return null;
    try {
      const re = new RegExp(pattern, "g");
      const after = sampleView.replace(re, (token) => applyReplacement(token, replacement));
      if (after === sampleView) return null;
      return { before: sampleView, after };
    } catch {
      return null;
    }
  }, [patternOk, pattern, replacement, sampleView]);

  const commit = () => {
    if (!name.trim()) return toast.error("Give the rule a name.");
    if (!pattern.trim()) return toast.error("Pattern is required.");
    if (!patternOk) return toast.error("Pattern is not a valid regular expression.");
    if (!replacement.trim()) return toast.error("Replacement cannot be empty.");
    onCommit({
      id: draft.id,
      kind: "custom",
      enabled: true,
      name: name.trim(),
      category,
      pattern: pattern.trim(),
      replacement: replacement.trim(),
      sample: sample.trim() || undefined
    });
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isNew ? "Add a custom rule" : "Edit rule"}</DialogTitle>
          <DialogDescription>
            Matches a whole value with a regular expression and replaces it. Built-ins can only
            be switched on or off.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-[1fr_auto] items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rule-name">Name</Label>
              <Input
                id="rule-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Internal ticket id"
                data-testid="rule-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={(value) => setCategory(value as RedactCategory)}>
                <SelectTrigger className="w-44" data-testid="rule-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REDACT_CATEGORIES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {CATEGORY_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rule-pattern">Pattern (regular expression)</Label>
            <Input
              id="rule-pattern"
              className="font-mono"
              value={pattern}
              onChange={(event) => setPattern(event.target.value)}
              placeholder="TICKET-\d{6}"
              data-testid="rule-pattern"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rule-replacement">Replacement</Label>
            <Input
              id="rule-replacement"
              className="font-mono"
              value={replacement}
              onChange={(event) => setReplacement(event.target.value)}
              data-testid="rule-replacement"
            />
            <p className="text-xs text-muted-foreground">
              <Code>__MASK_ALL__</Code> equal-length stars · <Code>__KEEP_HEAD_TAIL_3_4__</Code>{" "}
              keep head + tail · or a literal like <Code>[REDACTED]</Code>
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rule-sample">Sample text (optional)</Label>
            <Input
              id="rule-sample"
              className="font-mono"
              value={sample}
              onChange={(event) => setSample(event.target.value)}
              placeholder="A value this rule should redact"
              data-testid="rule-sample"
            />
          </div>

          <div className="space-y-1.5 rounded-lg border bg-muted/40 p-3">
            <p className="text-xs font-medium text-muted-foreground">Preview</p>
            {patternOk ? (
              preview ? (
                <p className="flex flex-wrap items-center gap-2 font-mono text-xs">
                  <span className="break-all text-muted-foreground">{preview.before}</span>
                  <span className="text-muted-foreground">→</span>
                  <span className="break-all text-emerald-600">{preview.after}</span>
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Pattern didn’t match the sample.</p>
              )
            ) : (
              <p className="text-xs text-muted-foreground">Awaiting a pattern to preview.</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={commit}>Save rule</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">{children}</code>;
}

const SAMPLE_BY_CATEGORY: Record<RedactCategory, string> = {
  secret: "Bearer sk-proj-xxxxxxxxxxxxxxxxxxxxx",
  pii: "They called 13812345678",
  network: "Connecting to 192.168.1.100:8080",
  custom: "assigned to TICKET-123456"
};
