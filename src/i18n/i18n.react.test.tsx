import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import { PageHeader } from "@/components/layout/PageHeader";
import { setLanguagePreference } from "@/i18n/store";
import { useT } from "@/i18n/useT";

let mountCount = 0;

/**
 * Stands in for the 8 suites that render components with no wrapper at all
 * (AboutDialog, PageHeader, DashboardPage, Markdown, SqlEditor, …). If the
 * translator needed a React context, this would throw.
 */
function Probe({ label }: { label: string }) {
  const t = useT();
  useEffect(() => {
    mountCount += 1;
  }, []);
  return <span data-testid={label}>{t("Save")}</span>;
}

describe("useT without a provider", () => {
  it("renders English by default", () => {
    render(<Probe label="a" />);
    expect(screen.getByTestId("a")).toHaveTextContent("Save");
  });

  it("re-renders in place when the language changes, without remounting", () => {
    mountCount = 0;
    render(<Probe label="a" />);
    expect(mountCount).toBe(1);

    act(() => {
      setLanguagePreference("zh");
    });

    expect(screen.getByTestId("a")).toHaveTextContent("保存");
    expect(mountCount).toBe(1);
  });

  it("updates every subscriber, not just one at the tree root", () => {
    render(
      <>
        <Probe label="a" />
        <Probe label="b" />
      </>
    );

    act(() => {
      setLanguagePreference("zh");
    });

    expect(screen.getByTestId("a")).toHaveTextContent("保存");
    expect(screen.getByTestId("b")).toHaveTextContent("保存");
  });

  it("reverts to English when the preference goes back to a system locale of English", () => {
    render(<Probe label="a" />);

    act(() => {
      setLanguagePreference("zh");
    });
    expect(screen.getByTestId("a")).toHaveTextContent("保存");

    act(() => {
      setLanguagePreference("system");
    });
    expect(screen.getByTestId("a")).toHaveTextContent("Save");
  });
});

describe("PageHeader without a provider", () => {
  it("flips a real page header between languages in place", () => {
    render(<PageHeader pageId="history" />);
    expect(screen.getByRole("heading")).toHaveTextContent("Job History");
    expect(screen.getByText("Track and clone jobs")).toBeInTheDocument();

    act(() => {
      setLanguagePreference("zh");
    });

    expect(screen.getByRole("heading")).toHaveTextContent("作业历史");
    expect(screen.getByText("跟踪与克隆作业")).toBeInTheDocument();
  });
});
