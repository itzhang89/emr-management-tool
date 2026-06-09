import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { AppShell } from "./AppShell";

describe("AppShell", () => {
  it("prioritizes Submit Job and switches pages from the sidebar", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <AppShell />
      </QueryClientProvider>
    );

    expect(screen.getByRole("heading", { name: "Submit Job" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Job History/i }));

    expect(screen.getByRole("heading", { name: "Job History" })).toBeInTheDocument();
  });
});
