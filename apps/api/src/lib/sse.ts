import type { FastifyReply, FastifyRequest } from 'fastify'

/** Latido para que proxies (Render) no corten la conexión por inactividad (docs/DISENO.md §5). */
export const HEARTBEAT_MS = 25_000
/** Espera sugerida al navegador antes de reconectar. */
const RETRY_MS = 3_000

export type SseStream = {
  send(event: string, data: unknown): void
  /** Se llama una vez cuando la conexión se cierra (cliente, servidor o error). */
  onClose(callback: () => void): void
  close(): void
}

/**
 * Canales Server-Sent Events abiertos por la aplicación. Fastify deja de manejar la respuesta
 * (`hijack`) y aquí se escriben los eventos a mano: `event: nombre` + `data: JSON`.
 */
export class SseConnections {
  private readonly open = new Set<SseStream>()

  get size(): number {
    return this.open.size
  }

  /** Cierra todas las conexiones (al apagar el servidor, para que no quede colgado). */
  closeAll(): void {
    for (const stream of [...this.open]) stream.close()
  }

  start(request: FastifyRequest, reply: FastifyReply): SseStream {
    reply.hijack()
    const raw = reply.raw
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Evita que un proxy acumule los eventos antes de enviarlos.
      'X-Accel-Buffering': 'no',
    })
    raw.write(`retry: ${RETRY_MS}\n\n`)

    const callbacks: Array<() => void> = []
    let closed = false
    // Latido como evento con nombre (no comentario): el navegador lo ve y, si deja de llegar,
    // sabe que la conexión murió aunque el proxy no la haya cerrado.
    const heartbeat = setInterval(() => raw.write('event: ping\ndata: {}\n\n'), HEARTBEAT_MS)
    heartbeat.unref()

    const finish = () => {
      if (closed) return
      closed = true
      clearInterval(heartbeat)
      this.open.delete(stream)
      for (const callback of callbacks) callback()
    }

    const stream: SseStream = {
      send(event, data) {
        if (!closed) raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      },
      onClose(callback) {
        callbacks.push(callback)
      },
      close() {
        raw.end()
        finish()
      },
    }

    this.open.add(stream)
    request.raw.on('close', finish)
    raw.on('error', finish)
    return stream
  }
}
