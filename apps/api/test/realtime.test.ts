import { describe, expect, it } from 'vitest'
import { catalogTrack, loginAsHost, ORIGIN, sessionWithGuests } from './helpers.ts'

type SseEvent = { event: string; data: unknown }

/**
 * Cliente SSE mínimo para pruebas: abre la conexión contra un puerto real (inject no sirve para
 * respuestas que no terminan) y acumula los eventos recibidos.
 */
async function connect(url: string, cookies: Record<string, string> = {}) {
  const controller = new AbortController()
  const response = await fetch(url, {
    headers: {
      cookie: Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; '),
    },
    signal: controller.signal,
  })
  const events: SseEvent[] = []
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) return
        buffer += value
        let cut
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, cut)
          buffer = buffer.slice(cut + 2)
          const event = block.match(/^event: (.+)$/m)?.[1]
          const data = block.match(/^data: (.+)$/m)?.[1]
          if (event && data) events.push({ event, data: JSON.parse(data) })
        }
      }
    } catch {
      // conexión cerrada
    }
  })()
  const waitFor = async (predicate: (e: SseEvent) => boolean, timeoutMs = 2000) => {
    const start = Date.now()
    for (;;) {
      const found = events.find(predicate)
      if (found) return found
      if (Date.now() - start > timeoutMs)
        throw new Error(`Evento no recibido: ${JSON.stringify(events)}`)
      await new Promise((r) => setTimeout(r, 10))
    }
  }
  return { response, events, waitFor, close: () => controller.abort() }
}

async function live() {
  const ctx = await sessionWithGuests()
  const address = await ctx.app.listen({ port: 0, host: '127.0.0.1' })
  return { ...ctx, base: address }
}

describe('tiempo real (SSE, docs/DISENO.md §5)', () => {
  it('al conectar envía la instantánea con los votos de quien se conecta', async () => {
    const { app, base, session, join, add } = await live()
    const guest = await join('Pipe')
    await add(guest, catalogTrack(1).spotifyTrackId)
    const sse = await connect(`${base}/api/sessions/${session.code}/events`, guest)
    expect(sse.response.headers.get('content-type')).toContain('text/event-stream')
    const snap = await sse.waitFor((e) => e.event === 'snapshot')
    expect(snap.data).toMatchObject({ me: { name: 'Pipe' }, version: 1 })
    expect((snap.data as { me: { votedTrackIds: string[] } }).me.votedTrackIds).toHaveLength(1)
    sse.close()
    await app.close()
  })

  it('todos ven al instante la canción agregada y el voto de otro invitado', async () => {
    const { app, base, session, join, add } = await live()
    const [ana, beto] = [await join('Ana'), await join('Beto')]
    const anaSse = await connect(`${base}/api/sessions/${session.code}/events`, ana)
    const betoSse = await connect(`${base}/api/sessions/${session.code}/events`, beto)
    await anaSse.waitFor((e) => e.event === 'snapshot')
    await betoSse.waitFor((e) => e.event === 'snapshot')

    const trackId = (await add(ana, catalogTrack(1).spotifyTrackId)).json().track.id
    const added = await betoSse.waitFor((e) => e.event === 'queue.updated')
    expect(added.data).toMatchObject({
      version: 1,
      queue: [{ id: trackId, addedBy: 'Ana', votes: 1 }],
    })

    await app.inject({
      method: 'PUT',
      url: `/api/sessions/${session.code}/tracks/${trackId}/vote`,
      headers: { origin: ORIGIN },
      cookies: beto,
    })
    const voted = await anaSse.waitFor(
      (e) => e.event === 'queue.updated' && (e.data as { version: number }).version === 2,
    )
    expect(voted.data).toMatchObject({ queue: [{ id: trackId, votes: 2 }] })
    anaSse.close()
    betoSse.close()
    await app.close()
  })

  it('un voto repetido no envía avisos (no cambió nada)', async () => {
    const { app, base, session, join, add } = await live()
    const guest = await join()
    const trackId = (await add(guest, catalogTrack(1).spotifyTrackId)).json().track.id
    const sse = await connect(`${base}/api/sessions/${session.code}/events`, guest)
    await sse.waitFor((e) => e.event === 'snapshot')
    // Ya tiene su voto inicial: votar de nuevo no cambia la cola.
    await app.inject({
      method: 'PUT',
      url: `/api/sessions/${session.code}/tracks/${trackId}/vote`,
      headers: { origin: ORIGIN },
      cookies: guest,
    })
    await new Promise((r) => setTimeout(r, 100))
    expect(sse.events.filter((e) => e.event === 'queue.updated')).toHaveLength(0)
    sse.close()
    await app.close()
  })

  it('el invitado ve al instante que el anfitrión rotó el enlace o finalizó la sesión', async () => {
    const { app, base, session, join } = await live()
    const guest = await join()
    const sse = await connect(`${base}/api/sessions/${session.code}/events`, guest)
    await sse.waitFor((e) => e.event === 'snapshot')
    const { cookies } = await loginAsHost(app)
    const post = (url: string) =>
      app.inject({ method: 'POST', url, payload: {}, headers: { origin: ORIGIN }, cookies })

    const rotated = (await post(`/api/host/sessions/${session.id}/rotate-code`)).json()
    const changed = await sse.waitFor((e) => e.event === 'session.updated')
    expect(changed.data).toMatchObject({ code: rotated.code, status: 'active' })

    await post(`/api/host/sessions/${session.id}/end`)
    await sse.waitFor(
      (e) => e.event === 'session.updated' && (e.data as { status: string }).status === 'ended',
    )
    sse.close()
    await app.close()
  })

  it('el panel recibe la cola y el número de invitados en vivo', async () => {
    const { app, base, session, join } = await live()
    const { cookies } = await loginAsHost(app)
    const panel = await connect(`${base}/api/host/sessions/${session.id}/events`, cookies)
    const snap = await panel.waitFor((e) => e.event === 'snapshot')
    expect(snap.data).toMatchObject({
      session: { id: session.id, participantsCount: 0 },
      queue: [],
    })
    await join()
    const count = await panel.waitFor((e) => e.event === 'participants.updated')
    expect(count.data).toEqual({ count: 1 })
    panel.close()
    await app.close()
  })

  it('los invitados no reciben el conteo de participantes', async () => {
    const { app, base, session, join } = await live()
    const guest = await join()
    const sse = await connect(`${base}/api/sessions/${session.code}/events`, guest)
    await sse.waitFor((e) => e.event === 'snapshot')
    await join()
    await new Promise((r) => setTimeout(r, 100))
    expect(sse.events.some((e) => e.event === 'participants.updated')).toBe(false)
    sse.close()
    await app.close()
  })

  it('al cerrar la conexión se libera la suscripción', async () => {
    const { app, base, session, join } = await live()
    const sse = await connect(`${base}/api/sessions/${session.code}/events`, await join())
    await sse.waitFor((e) => e.event === 'snapshot')
    expect(app.services.bus.count(session.id)).toBe(1)
    sse.close()
    for (let i = 0; i < 50 && app.services.bus.count(session.id) > 0; i++) {
      await new Promise((r) => setTimeout(r, 10))
    }
    expect(app.services.bus.count(session.id)).toBe(0)
    await app.close()
  })

  it('el servidor se apaga aunque haya conexiones abiertas', async () => {
    const { app, base, session, join } = await live()
    const sse = await connect(`${base}/api/sessions/${session.code}/events`, await join())
    await sse.waitFor((e) => e.event === 'snapshot')
    await app.close()
    expect(app.services.sse.size).toBe(0)
  })
})
