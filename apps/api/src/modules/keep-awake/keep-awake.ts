import { nextLocalTime } from '../../lib/time.ts'

export type KeepAwakeOptions = {
  enabled: boolean
  intervalMs: number
  /** Hora local de parada, "HH:MM". */
  until: string
  timeZone: string
  ping: () => Promise<void>
  now: () => number
  onError?: (error: unknown) => void
}

/**
 * Mantiene despierto el servicio gratuito de Render (D-19, R-AWAKE-01…05): al crear una sesión,
 * el servidor consulta su propia URL pública cada 10 min hasta la próxima 4:00 a. m. local.
 * A esa hora deja de hacerlo, pero la sesión sigue abierta (D-20).
 */
export class KeepAwake {
  private timer: NodeJS.Timeout | null = null
  private stopAt: number | null = null
  private readonly options: KeepAwakeOptions

  constructor(options: KeepAwakeOptions) {
    this.options = options
  }

  /** Hora (ms) hasta la que se mantendrá despierto, o null si no está activo. */
  get until(): number | null {
    return this.stopAt
  }

  /** R-AWAKE-01/04: arranca o extiende hasta la próxima hora de parada. */
  start(): void {
    const { enabled, intervalMs, until, timeZone, now } = this.options
    if (!enabled) return
    this.stopAt = nextLocalTime(now(), until, timeZone)
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), intervalMs)
    this.timer.unref()
  }

  /** R-AWAKE-02: se detiene al finalizar la sesión. */
  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.stopAt = null
  }

  private async tick(): Promise<void> {
    if (this.stopAt !== null && this.options.now() >= this.stopAt) {
      this.stop()
      return
    }
    try {
      await this.options.ping()
    } catch (error) {
      this.options.onError?.(error)
    }
  }
}
