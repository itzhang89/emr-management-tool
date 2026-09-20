import { describe, expect, it } from "vitest";
import { getEffectiveLocale, setLanguagePreference } from "@/i18n/store";
import { t } from "@/i18n/translate";
import { localeTag, resolveSystemLocale } from "@/i18n/locale";

describe("t", () => {
  it("renders English by default, so unmigrated call sites are unchanged", () => {
    expect(resolveSystemLocale()).toBe("en");
    expect(t("Submit Job")).toBe("Submit Job");
    expect(t("Save")).toBe("Save");
  });

  it("translates a known key once Chinese is selected", () => {
    setLanguagePreference("zh");
    expect(t("Save")).toBe("保存");
    expect(t("Delete")).toBe("删除");
  });

  it("degrades an untranslated key to its English source rather than a bare key", () => {
    setLanguagePreference("zh");
    expect(t("Virtual Cluster is still provisioning")).toBe("Virtual Cluster is still provisioning");
  });

  it("returns an unknown key as-is in either locale", () => {
    expect(t("No such key")).toBe("No such key");
    setLanguagePreference("zh");
    expect(t("No such key")).toBe("No such key");
  });

  it("interpolates variables into a translated string", () => {
    setLanguagePreference("zh");
    expect(t("Go to {label}", { label: "Logs" })).toBe("Go to Logs");
  });

  it("returns to English when the preference is cleared", () => {
    setLanguagePreference("zh");
    expect(t("Save")).toBe("保存");
    setLanguagePreference("en");
    expect(t("Save")).toBe("Save");
  });
});

describe("localeTag", () => {
  it("reports the tag the native menu should be built with", () => {
    expect(localeTag(getEffectiveLocale())).toBe("en-US");
    setLanguagePreference("zh");
    expect(localeTag(getEffectiveLocale())).toBe("zh-CN");
  });
});
