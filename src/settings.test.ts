import { describe, expect, it } from "vitest";
import { defaultSettings, loadSettings, saveSettings } from "./settings";

describe("loadSettings", () => {
  it("returns defaults when storage is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadSettings(blocked)).toEqual(defaultSettings);
  });

  it("returns defaults when nothing is stored", () => {
    expect(loadSettings({ getItem: () => null })).toEqual(defaultSettings);
  });

  it("returns defaults when the stored value is not JSON", () => {
    expect(loadSettings({ getItem: () => "{not json" })).toEqual(defaultSettings);
  });

  it("returns defaults when the stored value is not an object", () => {
    expect(loadSettings({ getItem: () => "[1,2]" })).toEqual(defaultSettings);
    expect(loadSettings({ getItem: () => "null" })).toEqual(defaultSettings);
  });

  it("keeps valid fields and replaces invalid ones", () => {
    const stored = '{"quality":"ultra","sound":"yes","guides":false}';
    expect(loadSettings({ getItem: () => stored })).toEqual({
      quality: "auto",
      sound: true,
      guides: false,
    });
  });

  it("reads back what was saved", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => void memory.set(key, value),
    };
    const chosen = { quality: "low", sound: false, guides: false } as const;
    saveSettings(chosen, storage);
    expect(loadSettings(storage)).toEqual(chosen);
  });
});

describe("saveSettings", () => {
  it("does not throw when storage is full or blocked", () => {
    const full = {
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(() => saveSettings(defaultSettings, full)).not.toThrow();
  });
});
