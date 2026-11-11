/** Evento listo para enviar por SSE: nombre y datos ya serializables. */
export type BusEvent = {
  name: 'queue.updated' | 'session.updated' | 'participants.updated'
  data: unknown
}

type Listener = (event: BusEvent) => void

/**
 * Bus de eventos en memoria por sesión (docs/DISENO.md §5). Una sola instancia del servidor
 * basta para eventos familiares; si algún día hubiera varias, esta interfaz se puede respaldar
 * con LISTEN/NOTIFY o Redis sin tocar las rutas.
 */
export class EventBus {
  private readonly listeners = new Map<string, Set<Listener>>()

  subscribe(sessionId: string, listener: Listener): () => void {
    let set = this.listeners.get(sessionId)
    if (!set) {
      set = new Set()
      this.listeners.set(sessionId, set)
    }
    set.add(listener)
    return () => {
      set.delete(listener)
      if (set.size === 0) this.listeners.delete(sessionId)
    }
  }

  publish(sessionId: string, event: BusEvent): void {
    for (const listener of this.listeners.get(sessionId) ?? []) listener(event)
  }

  /** Conexiones abiertas de una sesión (para pruebas y registros). */
  count(sessionId: string): number {
    return this.listeners.get(sessionId)?.size ?? 0
  }
}
