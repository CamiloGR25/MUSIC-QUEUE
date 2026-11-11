import { useEffect, useRef, useState } from 'react'

export type StreamStatus = 'connecting' | 'open' | 'reconnecting'

type Handlers = Record<string, (data: unknown) => void>

/** El servidor envía `ping` cada 25 s (apps/api lib/sse.ts); 60 s sin nada = conexión muerta. */
export const STALE_AFTER_MS = 60_000
const WATCHDOG_EVERY_MS = 10_000
/** Esperas entre reintentos cuando el navegador ya no reintenta solo (respuesta de error). */
const RETRY_DELAYS_MS = [3_000, 6_000, 12_000, 30_000]

/**
 * Se suscribe a un canal SSE (docs/DISENO.md §5). Al conectar o reconectar el servidor envía
 * una instantánea completa, así que no hace falta reconstruir nada a mano.
 *
 * El navegador reconecta solo si la conexión se corta, pero no en dos casos que aquí se cubren:
 * - la conexión queda abierta sin datos (proxy que no la cierra): se detecta por falta de latidos;
 * - el servidor responde con error (p. ej. 502 o 404): se reintenta con espera creciente y se
 *   avisa con `onFailedAttempt` para que la pantalla compruebe si la sesión sigue existiendo.
 * Con `url` null no se conecta.
 */
export function useEventStream(
  url: string | null,
  handlers: Handlers,
  onFailedAttempt?: () => void,
): StreamStatus {
  const [status, setStatus] = useState<StreamStatus>('connecting')
  // Los manejadores cambian en cada render; se leen siempre los últimos sin reconectar.
  const latest = useRef({ handlers, onFailedAttempt })
  latest.current = { handlers, onFailedAttempt }
  const events = Object.keys(handlers).sort().join(',')

  useEffect(() => {
    if (!url) return
    let source: EventSource | null = null
    let lastMessageAt = Date.now()
    let failures = 0
    let retryTimer: ReturnType<typeof setTimeout> | undefined

    const seen = () => {
      lastMessageAt = Date.now()
      failures = 0
    }

    const connect = () => {
      clearTimeout(retryTimer)
      source?.close()
      lastMessageAt = Date.now()
      source = new EventSource(url)
      source.onopen = () => {
        seen()
        setStatus('open')
      }
      source.onerror = () => {
        setStatus('reconnecting')
        if (source?.readyState === EventSource.CLOSED) scheduleRetry()
      }
      source.addEventListener('ping', seen)
      for (const name of events.split(',')) {
        source.addEventListener(name, (event) => {
          seen()
          latest.current.handlers[name]?.(JSON.parse((event as MessageEvent<string>).data))
        })
      }
    }

    const scheduleRetry = () => {
      latest.current.onFailedAttempt?.()
      const delay = RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length - 1)]
      failures += 1
      retryTimer = setTimeout(connect, delay)
    }

    const watchdog = setInterval(() => {
      if (Date.now() - lastMessageAt > STALE_AFTER_MS) {
        setStatus('reconnecting')
        connect()
      }
    }, WATCHDOG_EVERY_MS)

    const onVisible = () => {
      if (document.visibilityState === 'visible' && source?.readyState === EventSource.CLOSED) {
        connect()
      }
    }

    setStatus('connecting')
    connect()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)
    return () => {
      clearInterval(watchdog)
      clearTimeout(retryTimer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onVisible)
      source?.close()
    }
  }, [url, events])

  return status
}
