import Storage from 'expo-sqlite/kv-store';

/** Small JSON key-value persistence backed by expo-sqlite (on-device). */
export async function loadJSON<T>(key: string): Promise<T | null> {
  try {
    const raw = await Storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function saveJSON(key: string, value: unknown): void {
  Storage.setItem(key, JSON.stringify(value)).catch(() => {});
}
