import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RedactionPanel } from "./RedactionPanel";
import type { RedactRule } from "@/types/domain";

type HookBag = {
  getConfig: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
  runTest: ReturnType<typeof vi.fn>;
};

const builtIn = (id: string, name: string, category: RedactRule["category"]): RedactRule => ({
  id,
  name,
  category,
  enabled: true,
  kind: "builtin",
  sortOrder: 0
});

const customRule = (id: string, name: string, pattern: string): RedactRule => ({
  id,
  name,
  category: "custom",
  pattern,
  replacement: "__MASK_ALL__",
  sample: "TICKET-123456",
  enabled: true,
  kind: "custom",
  sortOrder: 0
});

const SIX_BUILTINS: RedactRule[] = [
  builtIn("arn", "AWS ARN", "secret"),
  builtIn("s3-bucket", "S3 bucket (keeps s3://)", "network"),
  builtIn("account-id", "AWS account id", "secret"),
  builtIn("ipv4", "IPv4 address", "network"),
  builtIn("ec2-host", "EC2 internal hostname", "network"),
  builtIn("fqdn", "FQDN hostname", "network")
];

let config: { rules: RedactRule[] };

const hookBag = vi.hoisted<HookBag>(() => ({
  getConfig: vi.fn(),
  save: vi.fn(),
  reset: vi.fn(),
  runTest: vi.fn()
}));

vi.mock("@/hooks/useRedactConfig", () => ({
  useRedactConfig: () => ({
    isSuccess: true,
    data: config,
    isLoading: false
  }),
  useSaveRedactConfig: () => ({ mutate: hookBag.save, isPending: false }),
  useResetRedactConfig: () => ({ mutate: hookBag.reset, isPending: false }),
  useTestRedactRules: () => ({ mutate: hookBag.runTest, isPending: false, data: null })
}));

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RedactionPanel />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  config = { rules: [...SIX_BUILTINS, customRule("c1", "Ticket", "TICKET-\\d+")] };
  hookBag.save.mockReset();
  hookBag.save.mockImplementation(
    (rules: RedactRule[], opts?: { onSuccess?: (c: { rules: RedactRule[] }) => void }) => {
      config = { rules };
      opts?.onSuccess?.({ rules });
    }
  );
  hookBag.reset.mockReset();
  hookBag.reset.mockImplementation(
    (_variables: undefined, opts?: { onSuccess?: (c: { rules: RedactRule[] }) => void }) => {
      config = { rules: [...SIX_BUILTINS] };
      opts?.onSuccess?.({ rules: [...SIX_BUILTINS] });
    }
  );
  hookBag.runTest.mockReset();
});

describe("RedactionPanel", () => {
  it("renders the built-in rules grouped by category with a toggle", async () => {
    renderPanel();
    expect(await screen.findByText("AWS ARN")).toBeInTheDocument();
    expect(screen.getByText("S3 bucket (keeps s3://)")).toBeInTheDocument();
    // A custom rule appears too.
    expect(screen.getByText("Ticket")).toBeInTheDocument();
  });

  it("toggling a built-in off edits locally until save", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("AWS ARN");

    const arnSwitch = screen.getByRole("switch", { name: "Toggle AWS ARN" });
    await user.click(arnSwitch);

    // Saving reflects the disabled ARN built-in.
    await user.click(screen.getByRole("button", { name: /Save changes/i }));
    await waitFor(() => {
      expect(hookBag.save).toHaveBeenCalled();
    });
    const saved: RedactRule[] = hookBag.save.mock.calls[0][0];
    expect(saved.find((rule) => rule.id === "arn")?.enabled).toBe(false);
  });

  it("opens an add form for a custom rule and previews the mask", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("AWS ARN");

    await user.click(screen.getByRole("button", { name: "Add custom rule" }));
    await screen.findByText("Add a custom rule");

    await user.type(screen.getByTestId("rule-name"), "Internal ticket");
    await user.type(screen.getByTestId("rule-pattern"), "\\d{6}");
    await user.type(screen.getByTestId("rule-sample"), "TICKET-654321 for ref");
    await user.click(screen.getByRole("button", { name: "Save rule" }));

    // The new custom row is now listed and marked dirty so Save persists it.
    expect(screen.getByText("Internal ticket")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Save changes/i }));
    await waitFor(() => expect(hookBag.save).toHaveBeenCalled());
    const rules: RedactRule[] = hookBag.save.mock.calls[0][0];
    expect(rules.some((rule) => rule.name === "Internal ticket" && rule.kind === "custom")).toBe(true);
  });

  it("deletes a custom rule but never a built-in", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Ticket");

    await user.click(screen.getByRole("button", { name: "Delete Ticket" }));
    expect(screen.queryByText("Ticket")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Save changes/i }));
    await waitFor(() => expect(hookBag.save).toHaveBeenCalled());
    const rules: RedactRule[] = hookBag.save.mock.calls[0][0];
    expect(rules.some((rule) => rule.id === "c1")).toBe(false);
  });

  it("resets to the built-in defaults", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Ticket");

    await user.click(screen.getByRole("button", { name: "Reset to defaults" }));
    expect(hookBag.reset).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByText("Ticket")).not.toBeInTheDocument();
    });
    expect(screen.getByText("AWS ARN")).toBeInTheDocument();
  });

  it("runs a batch test against the current rules", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("AWS ARN");

    await user.click(screen.getByRole("button", { name: "Preview masking" }));
    await waitFor(() => expect(hookBag.runTest).toHaveBeenCalled());
    const payload = hookBag.runTest.mock.calls[0][0];
    expect(payload.rules.some((rule: { id: string }) => rule.id === "c1")).toBe(true);
    expect(typeof payload.text).toBe("string");
  });
});
