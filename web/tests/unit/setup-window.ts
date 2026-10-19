// Environnement minimal des modules de l'ancienne interface (window.localStorage,
// window.setTimeout), sans jsdom.
export class MemoryStorage {
  private readonly items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, String(value));
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  clear() {
    this.items.clear();
  }
}

export function installWindow(storage: unknown = new MemoryStorage()) {
  const target = globalThis as unknown as { window: Record<string, unknown> };
  target.window = {
    localStorage: storage,
    setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms),
  };
  return storage;
}
