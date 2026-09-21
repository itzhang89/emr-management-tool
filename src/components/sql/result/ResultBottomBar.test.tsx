import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  ResultBottomBar,
  type ResultExportOption,
  type ResultPaging
} from "./ResultBottomBar";

/**
 * The strip is one component drawn for two engines that page in different ways,
 * so what is checked here is the *union*: that each engine is given its own
 * controls and only its own, and that neither is offered a control it could not
 * honour.
 *
 * The behaviour of each half in its own workspace is covered where it is used —
 * `ConnectionQueryTab.test.tsx` drives the pager against a real JDBC result, and
 * `GlueCatalogTab.test.tsx` drives "load more rows" against a real Athena one.
 */

/** The offset half, as DBHub hands it over. */
function offsetPaging(overrides: Partial<Extract<ResultPaging, { mode: "offset" }>> = {}): ResultPaging {
  return {
    mode: "offset",
    offset: 0,
    fetchSize: 200,
    maxFetchSize: 500,
    onFetchSizeChange: vi.fn(),
    pageable: true,
    hasPrev: false,
    hasNext: true,
    hasLast: false,
    onFirst: vi.fn(),
    onPrev: vi.fn(),
    onNext: vi.fn(),
    onLast: vi.fn(),
    counting: false,
    onCount: vi.fn(),
    ...overrides
  };
}

function cursorPaging(overrides: Partial<Extract<ResultPaging, { mode: "cursor" }>> = {}): ResultPaging {
  return {
    mode: "cursor",
    hasMore: true,
    loading: false,
    onLoadMore: vi.fn(),
    ...overrides
  };
}

const CSV_AND_JSON: ResultExportOption[] = [
  { label: "CSV", hint: "the rows loaded here, not the whole result", onSelect: vi.fn() },
  { label: "JSON", hint: "one object per row, as the driver sent it", onSelect: vi.fn() }
];

function renderBar(paging: ResultPaging, exportOptions: ResultExportOption[] = CSV_AND_JSON) {
  return render(
    <TooltipProvider>
      <ResultBottomBar
        rowCount={2}
        running={false}
        paging={paging}
        exportOptions={exportOptions}
        onRefresh={vi.fn()}
        onStop={vi.fn()}
      />
    </TooltipProvider>
  );
}

describe("ResultBottomBar paging", () => {
  it("gives an offset pager its four buttons, and no load-more", () => {
    renderBar(offsetPaging());

    for (const label of ["First page", "Previous page", "Next page · re-runs the query", "Last page · needs a row count first"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: "Load more rows" })).not.toBeInTheDocument();
    // Rows-per-page and the count belong to the engine that has offsets.
    expect(screen.getByLabelText("Rows per page")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Count" })).toBeInTheDocument();
  });

  it("gives a cursor its one button, and none of the pager's machinery", () => {
    renderBar(cursorPaging());

    expect(screen.getByRole("button", { name: "Load more rows" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next page · re-runs the query" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Rows per page")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Count" })).not.toBeInTheDocument();
  });

  it("hides load-more once the cursor is spent rather than greying it out", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <TooltipProvider>
        <ResultBottomBar
          rowCount={2}
          running={false}
          paging={cursorPaging()}
          exportOptions={CSV_AND_JSON}
          onRefresh={vi.fn()}
          onStop={vi.fn()}
        />
      </TooltipProvider>
    );

    await user.click(screen.getByRole("button", { name: "Load more rows" }));

    rerender(
      <TooltipProvider>
        <ResultBottomBar
          rowCount={2}
          running={false}
          paging={cursorPaging({ hasMore: false })}
          exportOptions={CSV_AND_JSON}
          onRefresh={vi.fn()}
          onStop={vi.fn()}
        />
      </TooltipProvider>
    );

    // Gone, not disabled: a button that can never work again reads as a layout
    // change rather than as "that was all of it".
    expect(screen.queryByRole("button", { name: "Load more rows" })).not.toBeInTheDocument();
  });

  it("clamps the page size to the ceiling the engine gave it", async () => {
    const user = userEvent.setup();
    const onFetchSizeChange = vi.fn();
    renderBar(offsetPaging({ maxFetchSize: 500, onFetchSizeChange }));

    const input = screen.getByLabelText("Rows per page");
    await user.clear(input);
    await user.type(input, "9000");
    await user.tab();

    expect(onFetchSizeChange).toHaveBeenCalledWith(500);
  });
});

describe("ResultBottomBar export", () => {
  it("opens a menu when there is more than one format", async () => {
    const user = userEvent.setup();
    renderBar(offsetPaging());

    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(await screen.findByText("the rows loaded here, not the whole result")).toBeInTheDocument();
  });

  it("makes the button the action when there is only one", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderBar(cursorPaging(), [{ label: "Export CSV", onSelect }]);

    // No menu in between: one format is not a choice.
    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(onSelect).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Export" })).not.toBeInTheDocument();
  });

  it("says nothing about exporting when the engine offers nothing", () => {
    renderBar(cursorPaging(), []);
    expect(screen.queryByRole("button", { name: "Export" })).not.toBeInTheDocument();
  });
});

describe("ResultBottomBar status cluster", () => {
  it("shows where the rows sit only for an engine that knows its offset", () => {
    const { unmount } = renderBar(offsetPaging({ offset: 200 }));
    // "rows 201–202" is only true because the pager said where page two starts.
    expect(screen.getByText(/rows 201–202/)).toBeInTheDocument();
    unmount();

    renderBar(cursorPaging());
    expect(screen.getByText("2 rows")).toBeInTheDocument();
    expect(screen.queryByText(/rows /)).not.toBeInTheDocument();
  });

  it("leads with whatever the engine knows that the count does not say", () => {
    render(
      <TooltipProvider>
        <ResultBottomBar
          rowCount={2}
          running={false}
          paging={cursorPaging()}
          exportOptions={CSV_AND_JSON}
          status={<span>{"Scanned: 2.0 KB"}</span>}
          onRefresh={vi.fn()}
          onStop={vi.fn()}
          durationMs={1500}
          fetchedAt="2026-09-20T10:00:00Z"
        />
      </TooltipProvider>
    );

    expect(screen.getByText("Scanned: 2.0 KB")).toBeInTheDocument();
    expect(screen.getByText("1.500s")).toBeInTheDocument();
    expect(screen.getByText(/updated/)).toBeInTheDocument();
  });
});
