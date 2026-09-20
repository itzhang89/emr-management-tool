import { afterEach, describe, expect, it, vi } from "vitest";
import { localeTag, normalizeLocaleTag, resolveEffectiveLocale, resolveSystemLocale } from "./locale";

describe("normalizeLocaleTag", () => {
  it.each([
    ["zh"],
    ["zh-CN"],
    ["zh_CN"],
    ["zh-Hans"],
    ["zh-Hans-CN"],
    ["zh-TW"],
    ["zh-Hant-HK"],
    ["ZH-cn"],
    ["  zh-CN  "]
  ])("recognizes %s as Chinese", (tag) => {
    expect(normalizeLocaleTag(tag)).toBe("zh");
  });

  it.each([["en"], ["en-US"], ["en-GB"], ["fr-FR"], ["ja-JP"], [""], [null], [undefined]])(
    "treats %s as English",
    (tag) => {
      expect(normalizeLocaleTag(tag)).toBe("en");
    }
  );
});

describe("resolveSystemLocale", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("honours only the top preference", () => {
    vi.stubGlobal("navigator", { languages: ["en-US", "zh-CN"], language: "en-US" });
    expect(resolveSystemLocale()).toBe("en");
  });

  it("resolves a Chinese top preference to Chinese", () => {
    vi.stubGlobal("navigator", { languages: ["zh-Hans-CN", "en-US"], language: "zh-Hans-CN" });
    expect(resolveSystemLocale()).toBe("zh");
  });

  it("falls back to navigator.language when languages is absent", () => {
    vi.stubGlobal("navigator", { language: "zh-CN" });
    expect(resolveSystemLocale()).toBe("zh");
  });
});

describe("resolveEffectiveLocale", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("passes an explicit preference through without consulting the system", () => {
    vi.stubGlobal("navigator", { languages: ["en-US"], language: "en-US" });
    expect(resolveEffectiveLocale("zh")).toBe("zh");
  });

  it("resolves system to the detected locale", () => {
    vi.stubGlobal("navigator", { languages: ["zh-CN"], language: "zh-CN" });
    expect(resolveEffectiveLocale("system")).toBe("zh");
  });
});

describe("localeTag", () => {
  it("maps each locale to its BCP-47 tag", () => {
    expect(localeTag("zh")).toBe("zh-CN");
    expect(localeTag("en")).toBe("en-US");
  });
});
