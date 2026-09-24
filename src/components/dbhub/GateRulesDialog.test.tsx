import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { GateRulesDialog, suggestKeyFor } from "./GateRulesDialog";
import type { GateLadderEntry, GateRefusal } from "@/types/domain";

const LADDER: GateLadderEntry[] = [
  { verb: "SELECT", tier: "free" },
  { verb: "INSERT", tier: "confirm" },
  { verb: "TRUNCATE", tier: "refuse" },
  { verb: "DROP", tier: "refuse" }
];

function refusal(overrides: Partial<GateRefusal> = {}): GateRefusal {
  return {
    statementKey: "CALL ETL_LOAD(?)",
    sql: "CALL etl_load(?)",
    tier: "refuse",
    matched: "CALL",
    actor: "ai",
    hits: 14,
    lastAt: "2026-09-24T00:00:00Z",
    ...overrides
  };
}

function renderDialog(props: Partial<Parameters<typeof GateRulesDialog>[0]> = {}) {
  return render(
    <TooltipProvider>
      <GateRulesDialog
        open
        onOpenChange={vi.fn()}
        scopeLabel="Sales MySQL"
        overrides={{}}
        ladder={LADDER}
        onSave={vi.fn()}
        {...props}
      />
    </TooltipProvider>
  );
}

describe("suggestKeyFor", () => {
  it("proposes the routine a call names", () => {
    // The narrow answer, and the one a rule should usually be: the log exists
    // to save the reader from knowing this themselves.
    expect(suggestKeyFor(refusal())).toBe("etl_load");
    // A quoted name is the same name — the quotes come off rather than
    // disqualifying the match, which would have proposed the bare verb.
    expect(suggestKeyFor(refusal({ sql: "CALL `etl load`(?)" }))).toBe("etl load");
    expect(suggestKeyFor(refusal({ sql: 'CALL "etl_load"(?)' }))).toBe("etl_load");
    expect(suggestKeyFor(refusal({ sql: "EXECUTE sp_rebuild" }))).toBe("sp_rebuild");
  });

  it("proposes the routine, not the schema, for a qualified call", () => {
    // How MySQL writes it, and how the log stores it: the qualifier is a schema
    // and a name key is only ever matched against a routine, so proposing the
    // first segment would hand the reader a rule that silently never fires.
    expect(
      suggestKeyFor(refusal({ sql: "CALL bigdata_etl.sp_get_job_count_info();" }))
    ).toBe("sp_get_job_count_info");
    expect(
      suggestKeyFor(refusal({ sql: "CALL `bigdata_etl`.`sp_get_job_count_info`();" }))
    ).toBe("sp_get_job_count_info");
    // Unqualified still works, and so does a quoted name holding a dot.
    expect(suggestKeyFor(refusal({ sql: "CALL `etl load`()" }))).toBe("etl load");
  });

  it("falls back to the verb for anything that is not a call", () => {
    // `matched` carries the verb, or "VERB without WHERE" — the verb is what a
    // rule can key on either way.
    expect(
      suggestKeyFor(refusal({ sql: "DROP TABLE staging", matched: "DROP" }))
    ).toBe("DROP");
    expect(
      suggestKeyFor(refusal({ sql: "DELETE FROM t", matched: "DELETE without WHERE" }))
    ).toBe("DELETE");
  });
});

describe("GateRulesDialog", () => {
  it("groups the ladder by tier, so the defaults are visible", async () => {
    renderDialog();
    // Every verb the classifier places is on screen under its own tier, which
    // is what removes the need for a separate "what are the defaults" table.
    for (const entry of LADDER) {
      expect(screen.getByText(entry.verb)).toBeInTheDocument();
    }
    expect(screen.getByText("runs without asking")).toBeInTheDocument();
    expect(screen.getByText("never runs")).toBeInTheDocument();
  });

  it("adds a rule and hands it back on save", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderDialog({ onSave });

    await user.type(screen.getByLabelText("Rule key"), "etl_*");
    await user.click(screen.getByRole("button", { name: /Add rule/i }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith({ "etl_*": "refuse" });
  });

  it("refuses a bare star without a round trip to the backend", async () => {
    // The gate ignores one if it finds it, but saying so here is what saves the
    // trip — and the reader should not have to learn it from a failed save.
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderDialog({ onSave });

    await user.type(screen.getByLabelText("Rule key"), "*");
    await user.click(screen.getByRole("button", { name: /Add rule/i }));

    expect(screen.getByRole("alert")).toHaveTextContent("not a rule");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({});
  });

  it("offers a rule built from a refused statement", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderDialog({ refusals: [refusal()], onSave });

    // The count is the signal that a rule is wanted.
    expect(screen.getByText("×14")).toBeInTheDocument();

    // One click, no key to think about — the whole point of the list.
    await user.click(screen.getByRole("button", { name: /Make a rule/i }));
    // The rule is committed, not just proposed, and it lands on Free so the
    // statement runs; the row is there to re-tier or remove before saving.
    expect(screen.getByText("etl_load")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({ etl_load: "free" });
  });

  it("retires the error as soon as the value changes", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText("Rule key"), "*");
    await user.click(screen.getByRole("button", { name: /Add rule/i }));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // The message is about the value that was rejected. The moment the value
    // changes it describes something the reader is no longer looking at, and
    // leaving it up accuses the text they just typed.
    await user.clear(screen.getByLabelText("Rule key"));
    await user.type(screen.getByLabelText("Rule key"), "etl_*");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("draws a ruled-on verb once, as the rule that moved it", () => {
    // TRUNCATE is a Refuse-tier verb by default. A rule moving it to Confirm
    // should show it under Confirm once — as the rule — and not also as a
    // default chip in the same group, or a reader counting what that tier holds
    // counts it twice.
    renderDialog({ overrides: { TRUNCATE: "confirm" } });
    expect(screen.getAllByText("TRUNCATE")).toHaveLength(1);
  });

  it("shows no refusals for a scope that has none", () => {
    // The account's rules have no refusal list: refusals are recorded per
    // connection, and inventing one for the account would be a lie.
    renderDialog();
    expect(screen.queryByText("Recently refused")).not.toBeInTheDocument();
  });
});
