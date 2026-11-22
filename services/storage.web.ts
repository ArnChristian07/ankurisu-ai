/** Web fallback: localStorage (expo-sqlite on web needs extra WASM setup). */
export async function loadJSON<T>(key: string): Promise<T | null> {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function saveJSON(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota / private-mode errors
  }
}
