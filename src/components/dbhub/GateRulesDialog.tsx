import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import type { GateLadderEntry, GateOverrides, GateRefusal, StatementTier } from "@/types/domain";

const TIERS: StatementTier[] = ["free", "confirm", "refuse"];

/** `CALL`/`EXECUTE`/`DO` and the name after it, qualified or not. */
const CALLED_ROUTINE =
  /^\s*(?:CALL|EXECUTE|DO)\s+((?:`[^`]+`|"[^"]+"|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:`[^`]+`|"[^"]+"|[A-Za-z_][\w$]*))?)/i;

/** One part of a possibly-qualified name: quoted, or bare. */
const NAME_SEGMENT = /`[^`]+`|"[^"]+"|[A-Za-z_][\w$]*/g;

/** The rule that names this verb exactly, if the reader has one. */
function exactRuleKey(verb: string, overrides: GateOverrides): string | undefined {
  return Object.keys(overrides).find(
    (key) => !key.includes("*") && !key.includes("?") && key.toUpperCase() === verb
  );
}

/**
 * The tier a verb ends up at once the rules have had their say.
 *
 * Only exact keys are consulted. A glob is matched by the gate, not here, and
 * this deliberately does not re-implement that matching: two answers to "does
 * etl_* cover etl_load" is one answer too many, and the one that matters is the
 * gate's. So a glob rule leaves the chips where the defaults put them.
 */
function effectiveTier(verb: string, overrides: GateOverrides): StatementTier | undefined {
  const key = exactRuleKey(verb, overrides);
  return key ? overrides[key] : undefined;
}

function hasExactRule(verb: string, overrides: GateOverrides): boolean {
  return exactRuleKey(verb, overrides) !== undefined;
}

/**
 * A key to propose for a refused statement.
 *
 * A routine call can be keyed on the routine, which is the narrow and useful
 * answer; for anything else the verb is all the log knows, and the verb is the
 * broad answer — proposing `CALL` for a statement that names a procedure would
 * re-tier every procedure in the database, which is not what the reader was
 * looking at.
 *
 * A quoted name is the same name: MySQL writes `` `etl load` `` and Postgres
 * writes `"etl load"`, and both name one routine, so the quotes come off rather
 * than disqualifying the match.
 *
 * Proposing rather than deciding: the person can widen `etl_load` to `etl_*` or
 * narrow the other way before saving.
 */
export function suggestKeyFor(refusal: GateRefusal): string {
  const called = CALLED_ROUTINE.exec(refusal.sql);
  if (called) {
    // A call is often qualified — `CALL bigdata_etl.sp_get_job_count_info()`,
    // and MySQL writes it with backticks around each part. The rule keys on the
    // *routine*, so the last segment is the one that can match. Taking the first
    // would propose the schema, and a name key is only ever matched against a
    // routine — so that rule would silently never fire, which is worse than no
    // rule because the reader would believe it was working.
    // Matched as segments rather than split on dots, so a quoted name that
    // contains one — `` `etl.load` `` is a single routine — is not cut in half.
    const segments = called[1].match(NAME_SEGMENT) ?? [];
    const last = segments[segments.length - 1] ?? "";
    return last.replace(/[`"]/g, "").trim();
  }
  // `matched` is the verb, or "VERB without WHERE" — the verb is what a rule
  // can key on either way.
  return refusal.matched.split(/\s+/)[0] ?? "";
}

/**
 * The statement ladder, editable.
 *
 * Grouped by tier rather than listed flat: the groups show the whole
 * configuration — the defaults and the reader's own rules together — so there is
 * no separate "what are the defaults" reference to consult, and "where did I
 * move TRUNCATE" is answered by which group it appears in.
 *
 * The default verbs come from the classifier itself (`get_gate_ladder`), so this
 * cannot describe a gate that no longer exists. The same dialog serves the
 * account's rules and one connection's, because a rule is a rule; only the
 * refusals beside it are per-connection, since that is how they are recorded.
 */
export function GateRulesDialog({
  open,
  onOpenChange,
  scopeLabel,
  overrides,
  ladder,
  onSave,
  pending = false,
  refusals,
  onIgnoreRefusal
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What these rules apply to, named in the title. */
  scopeLabel: string;
  overrides: GateOverrides;
  ladder: GateLadderEntry[];
  onSave: (overrides: GateOverrides) => void;
  pending?: boolean;
  /** Present only where refusals are known — a connection, not the account. */
  refusals?: GateRefusal[];
  onIgnoreRefusal?: (statementKey: string) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<GateOverrides>(overrides);
  const [newKey, setNewKey] = useState("");
  const [newTier, setNewTier] = useState<StatementTier>("refuse");
  const [error, setError] = useState<string>();

  // Re-seed when the dialog opens, so a cancelled edit does not come back.
  const [seeded, setSeeded] = useState(overrides);
  if (open && seeded !== overrides) {
    setSeeded(overrides);
    setDraft(overrides);
    setError(undefined);
  }

  const tierLabel = (tier: StatementTier) =>
    t(tier === "free" ? "Free" : tier === "confirm" ? "Confirm" : "Refuse");
  const tierHint = (tier: StatementTier) =>
    t(
      tier === "free"
        ? "runs without asking"
        : tier === "confirm"
          ? "a person is asked first"
          : "never runs"
    );

  const setRule = (key: string, tier: StatementTier) =>
    setDraft((current) => ({ ...current, [key]: tier }));

  const removeRule = (key: string) =>
    setDraft((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });

  const addRule = () => {
    const key = newKey.trim();
    if (!key) return;
    // A bare `*` is not a decision, and the Rust side refuses it too — saying so
    // here is what saves the round trip.
    if (key === "*") {
      setError(t("A rule of * on its own is not a rule. Give it a prefix, like etl_*."));
      return;
    }
    setError(undefined);
    setRule(key, newTier);
    setNewKey("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("Command rules — {scope}", { scope: scopeLabel })}</DialogTitle>
          <DialogDescription>
            {t(
              "Commands you do not list run at the tier shown. A rule key is a verb, a routine name, or a glob like etl_*."
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {TIERS.map((tier) => {
            const rules = Object.entries(draft).filter(([, value]) => value === tier);
            const defaults = ladder.filter(
              (entry) =>
                // A verb the reader has ruled on is drawn as that rule's row,
                // which names it and offers its tier back. Showing it here as
                // well would put one command in one group twice, and a reader
                // counting what a tier holds would count it twice.
                !hasExactRule(entry.verb, draft) &&
                (effectiveTier(entry.verb, draft) ?? entry.tier) === tier
            );
            return (
              <section key={tier} className="space-y-1.5">
                <h3 className="flex items-baseline gap-2 text-xs font-medium">
                  {tierLabel(tier)}
                  <span className="font-normal text-muted-foreground">{tierHint(tier)}</span>
                </h3>

                {rules.length ? (
                  <ul className="space-y-1">
                    {rules.map(([key]) => (
                      <li key={key} className="flex items-center gap-2">
                        <code className="min-w-0 flex-1 truncate rounded bg-muted px-1.5 py-0.5 text-[11px]">
                          {key}
                        </code>
                        <Select
                          value={tier}
                          onValueChange={(next) => setRule(key, next as StatementTier)}
                        >
                          <SelectTrigger className="h-7 w-28 text-xs" aria-label={t("Tier for {key}", { key })}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {TIERS.map((option) => (
                              <SelectItem key={option} value={option} className="text-xs">
                                {tierLabel(option)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={t("Remove the rule for {key}", { key })}
                          onClick={() => removeRule(key)}
                        >
                          <X className="size-3.5" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {/* The defaults this tier still holds: a verb the reader has
                    ruled on has moved to that rule's group instead. */}
                {defaults.length ? (
                  <p className="flex flex-wrap gap-1">
                    {defaults.map((entry) => (
                      <span
                        key={entry.verb}
                        className={cn(
                          "rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground"
                        )}
                      >
                        {entry.verb}
                      </span>
                    ))}
                  </p>
                ) : null}
              </section>
            );
          })}

          <div className="flex items-center gap-2 border-t pt-3">
            <Input
              value={newKey}
              onChange={(event) => {
                setNewKey(event.target.value);
                // The message is about the value that was rejected, so the
                // moment the value changes it is describing something the
                // reader is no longer looking at.
                setError(undefined);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") addRule();
              }}
              placeholder={t("TRUNCATE, sp_rebuild, etl_*…")}
              aria-label={t("Rule key")}
              className="h-8 text-xs"
            />
            <Select value={newTier} onValueChange={(next) => setNewTier(next as StatementTier)}>
              <SelectTrigger className="h-8 w-32 text-xs" aria-label={t("Tier")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIERS.map((tier) => (
                  <SelectItem key={tier} value={tier} className="text-xs">
                    {tierLabel(tier)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" size="sm" onClick={addRule}>
              <Plus className="mr-1 size-3.5" />
              {t("Add rule")}
            </Button>
          </div>

          {error ? (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          {refusals?.length ? (
            <section className="space-y-1.5 border-t pt-3">
              <h3 className="text-xs font-medium">{t("Recently refused")}</h3>
              <p className="text-xs text-muted-foreground">
                {t("What the gate turned away here — the quickest way to write the rule it needs.")}
              </p>
              <ul className="space-y-1">
                {refusals.map((refusal) => (
                  <li key={refusal.statementKey} className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded bg-muted px-1.5 py-0.5 text-[11px]">
                      {refusal.sql}
                    </code>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      ×{refusal.hits}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 shrink-0 text-xs"
                      onClick={() => {
                        // Commits rather than filling the field: this is the
                        // "I do not want to think about keys" path, and making
                        // it take a second click would defeat it. It lands on
                        // Free so the statement actually runs — which is why
                        // the reader was here — and the row it creates is right
                        // there to re-tier or remove before saving.
                        setRule(suggestKeyFor(refusal), "free");
                        setError(undefined);
                      }}
                    >
                      {t("Make a rule")}
                    </Button>
                    {onIgnoreRefusal ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0"
                        aria-label={t("Ignore {sql}", { sql: refusal.sql })}
                        onClick={() => onIgnoreRefusal(refusal.statementKey)}
                      >
                        <X className="size-3.5" />
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setDraft({});
              setError(undefined);
            }}
          >
            {t("Reset to defaults")}
          </Button>
          <Button type="button" disabled={pending} onClick={() => onSave(draft)}>
            {pending ? t("Saving…") : t("Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
