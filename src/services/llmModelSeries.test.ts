import { describe, expect, it } from "vitest";
import { groupBySeries, modelSeries } from "./llmModelSeries";

// These cases mirror src-tauri/src/chat/model_series.rs — the Rust copy runs
// during a sync import, this one previews the series in the UI, and they must
// not disagree.
describe("modelSeries", () => {
  it("strips trailing version segments", () => {
    expect(modelSeries("claude-opus-4-8")).toBe("claude-opus");
    expect(modelSeries("claude-opus-5")).toBe("claude-opus");
    expect(modelSeries("claude-sonnet-4-5-20250929")).toBe("claude-sonnet");
    expect(modelSeries("claude-3-7-sonnet-latest")).toBe("claude-3-7-sonnet");
  });

  it("keeps non-version suffixes", () => {
    expect(modelSeries("gpt-5.6-sol")).toBe("gpt-5.6-sol");
    expect(modelSeries("gpt-4o-mini")).toBe("gpt-4o-mini");
  });

  it("never returns an empty series", () => {
    expect(modelSeries("gpt-4")).toBe("gpt");
    expect(modelSeries("4")).toBe("4");
    expect(modelSeries("o3")).toBe("o3");
  });

  it("drops gateway path prefixes", () => {
    expect(modelSeries("anthropic/claude-opus-4-8")).toBe("claude-opus");
    expect(modelSeries("openai/gpt-4o-mini")).toBe("gpt-4o-mini");
  });

  it("tolerates surrounding whitespace and repeated separators", () => {
    expect(modelSeries("  claude-opus-4-8  ")).toBe("claude-opus");
    expect(modelSeries("claude--opus--4")).toBe("claude-opus");
  });
});

describe("groupBySeries", () => {
  it("groups models keeping first-appearance order", () => {
    const grouped = groupBySeries([
      { series: "claude-opus", modelId: "claude-opus-5" },
      { series: "gpt-5.6", modelId: "gpt-5.6-sol" },
      { series: "claude-opus", modelId: "claude-opus-4-8" }
    ]);

    expect(grouped.map(([series]) => series)).toEqual(["claude-opus", "gpt-5.6"]);
    expect(grouped[0]![1].map((model) => model.modelId)).toEqual(["claude-opus-5", "claude-opus-4-8"]);
  });

  it("returns nothing for an empty list", () => {
    expect(groupBySeries([])).toEqual([]);
  });
});
