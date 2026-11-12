import {
  playbackSchema,
  queueUpdatedSchema,
  type SessionSnapshot,
  sessionSnapshotSchema,
  sessionUpdatedSchema,
  type TrackView,
} from '@musica/shared'
import { ThumbsUp } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { Button } from '../../components/button.tsx'
import { ApiRequestError, errorMessage } from '../../lib/api-client.ts'
import { useEventStream } from '../../lib/use-event-stream.ts'
import { NowPlaying } from '../playback/now-playing.tsx'
import { QueueList } from '../queue/queue-list.tsx'
import { VoteButton } from '../queue/vote-button.tsx'
import { SearchSheet } from '../search/search-sheet.tsx'
import { guestApi } from './guest-api.ts'

export type Update = (change: (snapshot: SessionSnapshot) => SessionSnapshot) => void

/** Cambia el voto propio en la instantánea (optimista) y ajusta el contador. */
function withVote(snapshot: SessionSnapshot, trackId: string, voted: boolean, votes?: number) {
  const me = snapshot.me!
  const ids = new Set(me.votedTrackIds)
  if (voted) ids.add(trackId)
  else ids.delete(trackId)
  return {
    ...snapshot,
    me: { ...me, votedTrackIds: [...ids] },
    queue: snapshot.queue.map((track) =>
      track.id === trackId
        ? { ...track, votes: votes ?? Math.max(0, track.votes + (voted ? 1 : -1)) }
        : track,
    ),
  }
}

/**
 * La sesión vista por un invitado que ya entró: cola en vivo por SSE (docs/DISENO.md §5),
 * votos con un toque (R-VOT) y el buscador. La música (E5) llega después.
 */
export function GuestSession({
  snapshot,
  update,
  header,
  onLost,
}: {
  snapshot: SessionSnapshot
  update: Update
  header: ReactNode
  /** La sesión ya no existe (p. ej. el servidor se reinició): la pantalla lo explica. */
  onLost: () => void
}) {
  const code = snapshot.session.code
  const [searching, setSearching] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const [highlightId, setHighlightId] = useState<string | null>(null)

  const status = useEventStream(
    guestApi.eventsUrl(code),
    {
      snapshot: (data) => update(() => sessionSnapshotSchema.parse(data)),
      'queue.updated': (data) => {
        const { version, queue } = queueUpdatedSchema.parse(data)
        // R-COLA-03: un aviso viejo que llega tarde no deshace uno más nuevo.
        update((current) => (version > current.version ? { ...current, version, queue } : current))
      },
      'session.updated': (data) => {
        const session = sessionUpdatedSchema.parse(data)
        update((current) => ({ ...current, session }))
      },
      'playback.updated': (data) => {
        const playback = playbackSchema.parse(data)
        update((current) => ({ ...current, ...playback }))
      },
    },
    // El canal respondió con error: si la sesión ya no existe, se dice en vez de reintentar.
    () =>
      void guestApi.snapshot(code).then(
        (fresh) => update((current) => (fresh.version >= current.version ? fresh : current)),
        (error: unknown) => {
          if (error instanceof ApiRequestError && error.code === 'SESSION_NOT_FOUND') onLost()
        },
      ),
  )

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (!highlightId) return
    document.getElementById(`track-${highlightId}`)?.scrollIntoView({ block: 'center' })
    const timer = setTimeout(() => setHighlightId(null), 2500)
    return () => clearTimeout(timer)
  }, [highlightId])

  const voted = new Set(snapshot.me?.votedTrackIds)
  const blocked = snapshot.me?.blocked ?? false

  const toggleVote = async (track: TrackView) => {
    const next = !voted.has(track.id)
    setBusy((ids) => new Set(ids).add(track.id))
    update((current) => withVote(current, track.id, next))
    try {
      const result = await guestApi.vote(code, track.id, next)
      update((current) => withVote(current, track.id, result.voted, result.votes))
    } catch (error) {
      update((current) => withVote(current, track.id, !next))
      setNotice({ text: errorMessage(error), error: true })
      // R-PAR-03: si el anfitrión lo bloqueó, la pantalla lo refleja de inmediato.
      if (error instanceof ApiRequestError && error.code === 'PARTICIPANT_BLOCKED') {
        update((current) => ({ ...current, me: current.me && { ...current.me, blocked: true } }))
      }
    } finally {
      setBusy((ids) => {
        const rest = new Set(ids)
        rest.delete(track.id)
        return rest
      })
    }
  }

  const added = async (track: TrackView) => {
    setSearching(false)
    setNotice({ text: `Agregaste ${track.name}. Tu voto ya cuenta.` })
    setHighlightId(track.id)
    // La cola llega por SSE; se pide también la instantánea por si el canal está caído.
    const fresh = await guestApi.snapshot(code).catch(() => null)
    if (fresh) update((current) => (fresh.version >= current.version ? fresh : current))
  }

  return (
    <>
      {status === 'reconnecting' && (
        <p
          role="status"
          className="fixed inset-x-0 top-0 z-50 bg-bombillo px-4 py-2 text-center font-bold text-noche"
        >
          Sin conexión. Reconectando…
        </p>
      )}

      {header}

      {blocked && (
        <p role="alert" className="rounded-2xl border border-bombillo/50 p-4 text-bombillo">
          El anfitrión desactivó tus pedidos y votos en esta sesión. Puedes seguir viendo la música.
        </p>
      )}

      <NowPlaying nowPlaying={snapshot.nowPlaying} next={snapshot.next} />

      <section className="flex flex-col gap-2" aria-labelledby="cola">
        <h2 id="cola" className="text-titulo font-bold">
          Cola
        </h2>
        {snapshot.queue.length > 0 && (
          <p className="text-arena">
            Vota por tus favoritas con{' '}
            <ThumbsUp aria-hidden="true" className="inline size-4 -translate-y-0.5" /> o con doble
            toque: la que tenga más votos suena primero.
          </p>
        )}
        <QueueList
          queue={snapshot.queue}
          highlightId={highlightId}
          // Doble toque = like (como en redes sociales). Si ya la votó, no quita el voto.
          onDoubleTap={(track) => {
            if (!blocked && !voted.has(track.id) && !busy.has(track.id)) void toggleVote(track)
          }}
          action={(track) => (
            <VoteButton
              track={track}
              voted={voted.has(track.id)}
              busy={blocked || busy.has(track.id)}
              onToggle={() => void toggleVote(track)}
            />
          )}
        />
      </section>

      <p className="pb-24 text-meta text-arena">Canciones y portadas de Spotify.</p>

      <div className="fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-noche via-noche/95 to-transparent px-4 pt-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex w-full max-w-md flex-col gap-3">
          {/* Avisos flotantes sobre el botón: no dejan un hueco en la página cuando no hay. */}
          <div role="status" aria-live="polite">
            {notice && (
              <p
                className={`rounded-2xl bg-mesa-alta px-4 py-3 shadow-lg ${notice.error ? 'text-alerta' : 'text-hoja'}`}
              >
                {notice.text}
              </p>
            )}
          </div>
          {!blocked && (
            <Button className="w-full" onClick={() => setSearching(true)}>
              + Añadir canción
            </Button>
          )}
        </div>
      </div>

      {searching && (
        <SearchSheet
          code={code}
          onAdded={(track) => void added(track)}
          onShowInQueue={(trackId) => {
            setSearching(false)
            setHighlightId(trackId)
          }}
          onClose={() => setSearching(false)}
        />
      )}
    </>
  )
}
