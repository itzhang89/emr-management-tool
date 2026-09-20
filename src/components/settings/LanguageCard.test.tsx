import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { LanguageCard } from "./LanguageCard";

const storageKey = "emr-eks:language";

describe("LanguageCard", () => {
  it("offers the three choices in English by default", () => {
    render(<LanguageCard />);

    expect(screen.getByText("Language")).toBeInTheDocument();
    expect(screen.getByText("Follow system language")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "中文" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "English" })).toBeInTheDocument();
  });

  it("switches the interface to Chinese and persists the choice", async () => {
    const user = userEvent.setup();
    render(<LanguageCard />);

    await user.click(screen.getByRole("radio", { name: "中文" }));

    expect(window.localStorage.getItem(storageKey)).toBe("zh");
    expect(screen.getByText("语言")).toBeInTheDocument();
    expect(screen.getByText("跟随系统语言")).toBeInTheDocument();
  });

  it("keeps the language endonyms untranslated so they stay findable", async () => {
    const user = userEvent.setup();
    render(<LanguageCard />);

    await user.click(screen.getByRole("radio", { name: "中文" }));

    expect(screen.getByRole("radio", { name: "中文" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "English" })).toBeInTheDocument();
  });

  it("goes back to following the system after an explicit choice", async () => {
    const user = userEvent.setup();
    render(<LanguageCard />);

    await user.click(screen.getByRole("radio", { name: "中文" }));
    expect(window.localStorage.getItem(storageKey)).toBe("zh");

    // The label is Chinese now; the endonyms around it stayed put.
    await user.click(screen.getByRole("radio", { name: /^跟随系统语言/ }));

    expect(window.localStorage.getItem(storageKey)).toBe("system");
    // jsdom reports en-US, so following the system lands back on English.
    expect(screen.getByText("Language")).toBeInTheDocument();
  });

  it("returns to English when English is chosen after Chinese", async () => {
    const user = userEvent.setup();
    render(<LanguageCard />);

    await user.click(screen.getByRole("radio", { name: "中文" }));
    expect(screen.getByText("语言")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "English" }));

    expect(window.localStorage.getItem(storageKey)).toBe("en");
    expect(screen.getByText("Language")).toBeInTheDocument();
  });
});
