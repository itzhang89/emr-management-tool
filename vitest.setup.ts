import "@testing-library/jest-dom/vitest";

/**
 * Node 25+ may expose a non-functional global `localStorage` (requires
 * `--localstorage-file`) that replaces jsdom's Storage. Provide an in-memory
 * implementation for tests.
 */
class MemoryStorage implements Storage {
  #map = new Map<string, string>();

  get length() {
    return this.#map.size;
  }

  clear() {
    this.#map.clear();
  }

  getItem(key: string) {
    return this.#map.has(key) ? this.#map.get(key)! : null;
  }

  key(index: number) {
    return [...this.#map.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.#map.delete(key);
  }

  setItem(key: string, value: string) {
    this.#map.set(String(key), String(value));
  }
}

const memoryStorage = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  enumerable: true,
  value: memoryStorage,
  writable: true
});
if (typeof window !== "undefined") {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    enumerable: true,
    value: memoryStorage,
    writable: true
  });
}

/**
 * jsdom has no ResizeObserver, which several Radix primitives (radio group,
 * select, scroll area) construct on mount. A no-op is enough: tests assert on
 * markup and behaviour, not measured layout.
 */
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

/**
 * jsdom implements no scrolling, so `scrollIntoView` is missing entirely.
 * Components that follow a growing list (the chat transcript) call it in an
 * effect, where the resulting TypeError would unmount the whole tree.
 */
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}
