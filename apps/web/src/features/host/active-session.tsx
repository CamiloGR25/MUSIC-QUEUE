import {
  type HostParticipant,
  type HostSession,
  hostSnapshotSchema,
  type NowPlaying,
  participantsUpdatedSchema,
  playbackSchema,
  queueUpdatedSchema,
  sessionUpdatedSchema,
  type SyncStatusView,
  syncStatusSchema,
  type TrackView,
  type UpcomingTrack,
} from '@musica/shared'
import { type ReactNode, useEffect, useState } from 'react'
import { APP_NAME } from '../../components/brand.tsx'
import { Button } from '../../components/button.tsx'
import { QrCode } from '../../components/qr-code.tsx'
import { errorMessage } from '../../lib/api-client.ts'
import { useEventStream } from '../../lib/use-event-stream.ts'
import { QueueList } from '../queue/queue-list.tsx'
import { hostApi } from './host-api.ts'
import { ParticipantsList } from './participants-list.tsx'
import { PlaybackPanel } from './playback-panel.tsx'
import { RemoveTrackButton } from './remove-track-button.tsx'

type Live = {
  version: number
  queue: TrackView[]
  participants: HostParticipant[]
  nowPlaying: NowPlaying
  next: UpcomingTrack | null
  sync: SyncStatusView
}

/** Sección del panel con su título (todas iguales en forma, distintas en contenido). */
export function PanelCard({
  title,
  aside,
  children,
}: {
  title: string
  aside?: ReactNode
  children: ReactNode
}) {
  const id = `panel-${title.toLowerCase().replaceAll(' ', '-')}`
  return (
    <section className="flex flex-col gap-4 rounded-3xl bg-mesa p-6" aria-labelledby={id}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={id} className="text-seccion font-bold">
          {title}
        </h2>
        {aside && <span className="text-arena">{aside}</span>}
      </div>
      {children}
    </section>
  )
}

/**
 * Sesión activa en el panel (docs/DISENO.md §9.5), en el orden en que se usa durante la fiesta:
 * música, QR para que entren, cola (quitar canciones, R-CAN-06) e invitados (bloquear, R-PAR-03).
 * Todo se mantiene al día por SSE.
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
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState<Live>({
    version: -1,
    queue: [],
    participants: [],
    nowPlaying: null,
    next: null,
    sync: { status: 'idle', deviceName: null, lastError: null },
  })

  useEventStream(hostApi.eventsUrl(session.id), {
    snapshot: (data) => {
      const snap = hostSnapshotSchema.parse(data)
      setLive({
        version: snap.version,
        queue: snap.queue,
        participants: snap.participants,
        nowPlaying: snap.nowPlaying,
        next: snap.next,
        sync: snap.sync,
      })
    },
    'queue.updated': (data) => {
      const { version, queue } = queueUpdatedSchema.parse(data)
      setLive((current) => (version > current.version ? { ...current, version, queue } : current))
    },
    'playback.updated': (data) => {
      const playback = playbackSchema.parse(data)
      setLive((current) => ({ ...current, ...playback }))
    },
    'sync.status': (data) => {
      const sync = syncStatusSchema.parse(data)
      setLive((current) => ({ ...current, sync }))
    },
    'participants.updated': (data) => {
      const { items } = participantsUpdatedSchema.parse(data)
      setLive((current) => ({ ...current, participants: items }))
    },
    // Rotar o finalizar (también desde otra pestaña): se recarga el panel.
    'session.updated': (data) => {
      const updated = sessionUpdatedSchema.parse(data)
      if (updated.status === 'ended' || updated.code !== session.code) onChange()
    },
  })

  const attempt = async (action: () => Promise<unknown>) => {
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const guests = live.participants.length

  return (
    <>
      <PlaybackPanel
        sessionId={session.id}
        nowPlaying={live.nowPlaying}
        next={live.next}
        sync={live.sync}
      />

      <SessionCard session={session} keepAwakeUntil={keepAwakeUntil} onChange={onChange} />

      {error && (
        <p role="alert" className="text-alerta">
          {error}
        </p>
      )}

      <PanelCard
        title="Cola"
        aside={live.queue.length > 0 ? `${live.queue.length} por sonar` : undefined}
      >
        <QueueList
          queue={live.queue}
          action={(track) => (
            <RemoveTrackButton
              track={track}
              onRemove={() => void attempt(() => hostApi.removeTrack(session.id, track.id))}
            />
          )}
        />
      </PanelCard>

      <PanelCard
        title="Invitados"
        aside={guests === 0 ? undefined : `${guests} ${guests === 1 ? 'invitado' : 'invitados'}`}
      >
        <ParticipantsList
          participants={live.participants}
          onToggle={(participant) =>
            void attempt(() =>
              hostApi.setBlocked(session.id, participant.id, participant.status === 'active'),
            )
          }
        />
      </PanelCard>
    </>
  )
}

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

/** La sesión: QR y enlace para entrar, crear enlace nuevo y finalizar (R-SES-02/03). */
function SessionCard({
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

  useEffect(() => setCopied(false), [session.joinUrl])

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

  return (
    <PanelCard title={session.name}>
      <div className="flex flex-col gap-1">
        <p className="text-bombillo">Sesión activa</p>
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

      {fullscreen && <FullscreenQr session={session} onClose={() => setFullscreen(false)} />}
    </PanelCard>
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
      <p className="text-center text-grande leading-tight font-bold">{APP_NAME}</p>
      <h2 className="text-center text-seccion leading-tight font-bold text-bombillo">
        {session.name}
      </h2>
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
