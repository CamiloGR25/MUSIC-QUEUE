import {
  hostSnapshotSchema,
  type HostSession,
  participantsUpdatedSchema,
  queueUpdatedSchema,
  sessionUpdatedSchema,
  type TrackView,
} from '@musica/shared'
import { useEffect, useState } from 'react'
import { Button } from '../../components/button.tsx'
import { QrCode } from '../../components/qr-code.tsx'
import { errorMessage } from '../../lib/api-client.ts'
import { useEventStream } from '../../lib/use-event-stream.ts'
import { QueueList } from '../queue/queue-list.tsx'
import { hostApi } from './host-api.ts'
import { RemoveTrackButton } from './remove-track-button.tsx'

type Pending = 'end' | 'rotate' | null

const CONFIRM: Record<'end' | 'rotate', { text: string; action: string }> = {
  end: {
    text: '¿Finalizar la sesión? Los invitados ya no podrán pedir canciones ni votar.',
    action: 'Finalizar sesión',
  },
  rotate: {
    text: '¿Crear un enlace nuevo? El QR actual deja de servir para entrar; quienes ya están dentro siguen en la sesión.',
    action: 'Crear enlace nuevo',
  },
}

/**
 * Sesión activa en el panel (docs/DISENO.md §9.5): QR, enlace, rotar y finalizar, y en vivo por
 * SSE el número de invitados y la cola, con la opción de quitar canciones (R-CAN-06).
 */
export function ActiveSession({
  session,
  keepAwakeUntil,
  onChange,
}: {
  session: HostSession
  keepAwakeUntil: string | null
  onChange: () => void
}) {
  const [pending, setPending] = useState<Pending>(null)
  const [copied, setCopied] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState<{ version: number; queue: TrackView[]; guests: number }>({
    version: -1,
    queue: [],
    guests: session.participantsCount,
  })

  useEffect(() => setCopied(false), [session.joinUrl])

  useEventStream(hostApi.eventsUrl(session.id), {
    snapshot: (data) => {
      const snap = hostSnapshotSchema.parse(data)
      setLive({ version: snap.version, queue: snap.queue, guests: snap.session.participantsCount })
    },
    'queue.updated': (data) => {
      const { version, queue } = queueUpdatedSchema.parse(data)
      setLive((current) => (version > current.version ? { ...current, version, queue } : current))
    },
    'participants.updated': (data) => {
      const { count } = participantsUpdatedSchema.parse(data)
      setLive((current) => ({ ...current, guests: count }))
    },
    // Rotar o finalizar (también desde otra pestaña): se recarga el panel.
    'session.updated': (data) => {
      const updated = sessionUpdatedSchema.parse(data)
      if (updated.status === 'ended' || updated.code !== session.code) onChange()
    },
  })

  const remove = async (track: TrackView) => {
    try {
      await hostApi.removeTrack(session.id, track.id)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const copy = async () => {
    await navigator.clipboard.writeText(session.joinUrl)
    setCopied(true)
  }

  const confirm = async () => {
    try {
      if (pending === 'end') await hostApi.endSession(session.id)
      if (pending === 'rotate') await hostApi.rotateCode(session.id)
      setPending(null)
      onChange()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const guests = live.guests

  return (
    <section className="flex flex-col gap-6 rounded-3xl bg-mesa p-6">
      <div className="flex flex-col gap-1">
        <p className="text-bombillo">Sesión activa</p>
        <h2 className="text-seccion font-bold">{session.name}</h2>
        <p className="text-arena">
          {guests === 0
            ? 'Todavía no ha entrado nadie.'
            : `${guests} ${guests === 1 ? 'invitado' : 'invitados'}`}
        </p>
        {keepAwakeUntil && (
          <p className="text-meta text-arena">
            Servidor despierto hasta las{' '}
            {new Date(keepAwakeUntil).toLocaleTimeString('es-CO', {
              hour: 'numeric',
              minute: '2-digit',
            })}
          </p>
        )}
      </div>

      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <QrCode
          value={session.joinUrl}
          label={`Código QR para entrar a ${session.name}`}
          className="w-48"
        />
        <div className="flex w-full flex-col gap-3">
          <p className="break-all text-arena">{session.joinUrl}</p>
          <Button variant="secondary" onClick={() => void copy()}>
            {copied ? 'Enlace copiado' : 'Copiar enlace'}
          </Button>
          <Button variant="secondary" onClick={() => setFullscreen(true)}>
            Mostrar QR en pantalla completa
          </Button>
        </div>
      </div>

      {error && <p className="text-alerta">{error}</p>}
      {pending ? (
        <div
          className="flex flex-col gap-3 rounded-2xl border border-alerta/40 p-4"
          role="alertdialog"
        >
          <p>{CONFIRM[pending].text}</p>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => setPending(null)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={() => void confirm()}>
              {CONFIRM[pending].action}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => setPending('rotate')}>
            Crear enlace nuevo
          </Button>
          <Button variant="danger" onClick={() => setPending('end')}>
            Finalizar sesión
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-titulo font-bold">
          Cola{live.queue.length > 0 ? ` (${live.queue.length})` : ''}
        </h3>
        <QueueList
          queue={live.queue}
          action={(track) => (
            <RemoveTrackButton track={track} onRemove={() => void remove(track)} />
          )}
        />
      </div>

      {fullscreen && <FullscreenQr session={session} onClose={() => setFullscreen(false)} />}
    </section>
  )
}

/** QR grande para dejarlo en un televisor o una tablet. */
function FullscreenQr({ session, onClose }: { session: HostSession; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-noche p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Código QR en pantalla completa"
    >
      <h2 className="text-center text-grande leading-tight font-bold">{session.name}</h2>
      <p className="text-titulo text-arena">Escanea para pedir canciones y votar</p>
      <QrCode
        value={session.joinUrl}
        label={`Código QR para entrar a ${session.name}`}
        className="w-[min(70vh,85vw)]"
      />
      <Button variant="secondary" onClick={onClose} autoFocus>
        Cerrar
      </Button>
    </div>
  )
}
