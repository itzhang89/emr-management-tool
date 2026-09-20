import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isTauriRuntime: vi.fn(() => false),
  setAppLanguage: vi.fn(() => Promise.resolve())
}));

vi.mock("@/lib/tauriRuntime", () => ({ isTauriRuntime: mocks.isTauriRuntime }));
vi.mock("@/services/tauriClient", () => ({ tauriClient: { setAppLanguage: mocks.setAppLanguage } }));

import { setLanguagePreference } from "@/i18n/store";
import { bindNativeMenuLanguage, pushNativeMenuLanguage } from "./nativeMenuLanguage";

describe("nativeMenuLanguage", () => {
  beforeEach(() => {
    mocks.isTauriRuntime.mockReset();
    mocks.isTauriRuntime.mockReturnValue(false);
    mocks.setAppLanguage.mockClear();
  });

  it("does nothing outside the Tauri runtime", async () => {
    await pushNativeMenuLanguage();
    expect(mocks.setAppLanguage).not.toHaveBeenCalled();
  });

  it("pushes the resolved locale on bind", async () => {
    mocks.isTauriRuntime.mockReturnValue(true);
    const unsubscribe = bindNativeMenuLanguage();

    await vi.waitFor(() => expect(mocks.setAppLanguage).toHaveBeenCalledWith({ language: "en-US" }));

    unsubscribe();
  });

  it("pushes again when the language changes", async () => {
    mocks.isTauriRuntime.mockReturnValue(true);
    const unsubscribe = bindNativeMenuLanguage();
    await vi.waitFor(() => expect(mocks.setAppLanguage).toHaveBeenCalledWith({ language: "en-US" }));

    setLanguagePreference("zh");

    await vi.waitFor(() => expect(mocks.setAppLanguage).toHaveBeenCalledWith({ language: "zh-CN" }));

    unsubscribe();
  });

  it("stops pushing once unsubscribed", async () => {
    mocks.isTauriRuntime.mockReturnValue(true);
    const unsubscribe = bindNativeMenuLanguage();
    await vi.waitFor(() => expect(mocks.setAppLanguage).toHaveBeenCalledTimes(1));

    unsubscribe();
    setLanguagePreference("zh");
    await Promise.resolve();

    expect(mocks.setAppLanguage).toHaveBeenCalledTimes(1);
  });
});
