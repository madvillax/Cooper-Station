import type { Tier } from "./quality";

export type Settings = {
  quality: Tier | "auto";
  sound: boolean;
  guides: boolean;
};

export const defaultSettings: Settings = {
  quality: "auto",
  sound: true,
  guides: true,
};

const KEY = "cooper-station:settings:v1";
const qualities: Settings["quality"][] = ["auto", "low", "balanced", "high"];

function browserStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    // Reading the property itself throws when site data is blocked.
    return undefined;
  }
}

/**
 * Reads saved settings. Storage can be blocked, empty or hold anything, so
 * every field is checked on its own and falls back to its default.
 */
export function loadSettings(
  storage: Pick<Storage, "getItem"> | undefined = browserStorage(),
): Settings {
  let stored: unknown;
  try {
    stored = JSON.parse(storage?.getItem(KEY) ?? "null");
  } catch {
    stored = null;
  }
  if (typeof stored !== "object" || stored === null) return { ...defaultSettings };
  const fields = stored as Record<string, unknown>;
  const quality = qualities.find((option) => option === fields.quality);
  return {
    quality: quality ?? defaultSettings.quality,
    sound: typeof fields.sound === "boolean" ? fields.sound : defaultSettings.sound,
    guides:
      typeof fields.guides === "boolean" ? fields.guides : defaultSettings.guides,
  };
}

export function saveSettings(
  settings: Settings,
  storage: Pick<Storage, "setItem"> | undefined = browserStorage(),
) {
  try {
    storage?.setItem(KEY, JSON.stringify(settings));
  } catch {
    // A full or blocked store only means the choice is not remembered.
  }
}
