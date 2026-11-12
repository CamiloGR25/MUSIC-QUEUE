import type {
  DeviceView,
  NowPlaying as NowPlayingData,
  SyncStatusView,
  UpcomingTrack,
} from '@musica/shared'
import { useState } from 'react'
import { Button } from '../../components/button.tsx'
import { errorMessage } from '../../lib/api-client.ts'
import { NowPlaying } from '../playback/now-playing.tsx'
import { hostApi } from './host-api.ts'

/** Estado de la conexión con Spotify en palabras para el anfitrión (docs/DISENO.md §7). */
export function syncMessage({ status, deviceName, lastError }: SyncStatusView): {
  text: string
  tone: 'ok' | 'warn'
} {
  switch (status) {
    case 'ok':
      return { text: `Spotify conectado en ${deviceName ?? 'tu dispositivo'}.`, tone: 'ok' }
    case 'paused':
      return { text: `En pausa en ${deviceName ?? 'tu dispositivo'}.`, tone: 'ok' }
    case 'idle':
      return { text: 'Conectando con Spotify…', tone: 'ok' }
    case 'no_device':
      return {
        text: 'Abre Spotify en el dispositivo donde quieres la música (PC, celular o parlante) y elígelo abajo.',
        tone: 'warn',
      }
    case 'auth_error':
      return {
        text: 'Spotify ya no tiene el permiso de esta app. Vuelve a conectar.',
        tone: 'warn',
      }
    case 'premium_required':
      return { text: 'El control de la música requiere Spotify Premium.', tone: 'warn' }
    case 'rate_limited':
      return { text: 'Spotify pidió esperar un momento. La cola sigue guardada.', tone: 'warn' }
    default:
      return { text: lastError ?? 'Spotify no responde. La cola sigue guardada.', tone: 'warn' }
  }
}

/** Música en el panel: lo que suena, controles, dispositivo y estado de la conexión. */
export function PlaybackPanel({
  sessionId,
  nowPlaying,
  next,
  sync,
}: {
  sessionId: string
  nowPlaying: NowPlayingData
  next: UpcomingTrack | null
  sync: SyncStatusView
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [devices, setDevices] = useState<{ list: DeviceView[]; selectedId: string | null } | null>(
    null,
  )
  const message = syncMessage(sync)

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const loadDevices = () =>
    run(async () => {
      const result = await hostApi.devices(sessionId)
      setDevices({ list: result.devices, selectedId: result.selectedId })
    })

  const choose = (deviceId: string) =>
    run(async () => {
      await hostApi.selectDevice(sessionId, deviceId)
      setDevices(null)
    })

  const playing = nowPlaying?.isPlaying ?? false

  return (
    <section className="flex flex-col gap-4 rounded-3xl bg-mesa p-6" aria-label="Música">
      <NowPlaying nowPlaying={nowPlaying} next={next} />

      <div className="flex flex-wrap gap-3">
        {playing ? (
          <Button disabled={busy} onClick={() => void run(() => hostApi.pause(sessionId))}>
            Pausar
          </Button>
        ) : (
          <Button disabled={busy} onClick={() => void run(() => hostApi.play(sessionId))}>
            Reproducir
          </Button>
        )}
        <Button
          variant="secondary"
          disabled={busy || !nowPlaying}
          onClick={() => void run(() => hostApi.next(sessionId))}
        >
          Siguiente
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => void loadDevices()}>
          Elegir dispositivo
        </Button>
      </div>

      <p role="status" className={message.tone === 'ok' ? 'text-arena' : 'text-bombillo'}>
        {message.text}
      </p>
      {error && <p className="text-alerta">{error}</p>}

      {devices && (
        <div className="flex flex-col gap-2" role="group" aria-label="Dispositivos de Spotify">
          {devices.list.length === 0 ? (
            <p className="text-arena">
              Spotify no ve ningún dispositivo. Abre la app de Spotify en el PC, el celular o el
              parlante y vuelve a intentar.
            </p>
          ) : (
            devices.list.map((device) => (
              <button
                key={device.id}
                type="button"
                disabled={busy || device.isRestricted}
                onClick={() => void choose(device.id)}
                className="flex min-h-12 items-center justify-between rounded-xl border border-arena/40 px-4 text-left hover:border-hoja disabled:opacity-50"
              >
                <span>
                  {device.name} <span className="text-meta text-arena">({device.type})</span>
                </span>
                {(device.id === devices.selectedId || device.isActive) && (
                  <span className="text-meta text-hoja">
                    {device.id === devices.selectedId ? 'Elegido' : 'Activo'}
                  </span>
                )}
              </button>
            ))
          )}
          <button
            type="button"
            className="self-start text-arena underline"
            onClick={() => setDevices(null)}
          >
            Cerrar
          </button>
        </div>
      )}
    </section>
  )
}
