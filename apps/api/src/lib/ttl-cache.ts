/**
 * Caché en memoria con vencimiento y tamaño máximo (descarta lo más antiguo).
 * Sirve para no repetir búsquedas a Spotify mientras alguien escribe.
 */
export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>()
  private readonly ttlMs: number
  private readonly maxEntries: number
  private readonly now: () => number

  constructor(ttlMs: number, maxEntries: number, now = Date.now) {
    this.ttlMs = ttlMs
    this.maxEntries = maxEntries
    this.now = now
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key: string, value: T): void {
    this.entries.delete(key)
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs })
    if (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest !== undefined) this.entries.delete(oldest)
    }
  }
}
