import type { HostMe } from '@musica/shared'
import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Button, buttonClass } from '../../components/button.tsx'
import { TextField } from '../../components/text-field.tsx'
import { ApiRequestError, errorMessage } from '../../lib/api-client.ts'
import { ActiveSession } from './active-session.tsx'
import { PrintableQr } from './printable-qr.tsx'
import { hostApi, LOGIN_ERRORS, reconnectWarning, SPOTIFY_LOGIN_URL } from './host-api.ts'

type State =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; me: HostMe }

/**
 * Panel del anfitrión, etapa E1: conectar Spotify, crear y finalizar la sesión.
 * El QR, los participantes y la reproducción llegan en E2, E5 y E6.
 */
export function HostPage() {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [params, setParams] = useSearchParams()
  const loginError = params.get('error')

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setState({ kind: 'ready', me: await hostApi.me(signal) })
    } catch (error) {
      if (signal?.aborted) return
      if (error instanceof ApiRequestError && error.code === 'HOST_UNAUTHENTICATED') {
        setState({ kind: 'signed-out' })
      } else {
        setState({ kind: 'error', message: errorMessage(error) })
      }
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-8 px-4 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-sesion leading-tight font-bold">Panel del anfitrión</h1>
        {state.kind === 'ready' && <p className="text-arena">Hola, {state.me.name}.</p>}
      </header>

      {loginError && (
        <Notice tone="alerta" onClose={() => setParams({}, { replace: true })}>
          {LOGIN_ERRORS[loginError] ?? LOGIN_ERRORS.spotify}
        </Notice>
      )}

      {state.kind === 'loading' && <p className="text-arena">Cargando…</p>}
      {state.kind === 'error' && <Notice tone="alerta">{state.message}</Notice>}
      {state.kind === 'signed-out' && <SignedOut />}
      {state.kind === 'ready' && <Ready me={state.me} reload={() => void load()} />}
    </main>
  )
}

function SignedOut() {
  return (
    <section className="flex flex-col gap-4">
      <p className="text-titulo text-arena">
        Conecta tu cuenta de Spotify Premium para crear la sesión del evento y controlar la música.
      </p>
      <a className={buttonClass()} href={SPOTIFY_LOGIN_URL}>
        Conectar Spotify
      </a>
    </section>
  )
}

function Ready({ me, reload }: { me: HostMe; reload: () => void }) {
  const warning = me.spotifyConnected
    ? reconnectWarning(me.reconnectBy)
    : 'Spotify ya no tiene el permiso de esta app. Vuelve a conectar.'

  const signOut = async (action: 'logout' | 'disconnect') => {
    await hostApi[action]()
    reload()
  }

  return (
    <>
      {warning && (
        <Notice tone="bombillo">
          {warning}{' '}
          <a className="font-bold underline" href={SPOTIFY_LOGIN_URL}>
            Volver a conectar
          </a>
        </Notice>
      )}

      {me.activeSession ? (
        <ActiveSession
          session={me.activeSession}
          keepAwakeUntil={me.keepAwakeUntil}
          onChange={reload}
        />
      ) : (
        <CreateSession disabled={!me.spotifyConnected} onCreated={reload} />
      )}

      <PrintableQr url={me.fixedJoinUrl} />

      <footer className="mt-auto flex flex-wrap gap-3 border-t border-mesa-alta pt-6">
        <Button variant="secondary" onClick={() => void signOut('logout')}>
          Cerrar sesión
        </Button>
        <Button variant="secondary" onClick={() => void signOut('disconnect')}>
          Desconectar Spotify
        </Button>
      </footer>
    </>
  )
}

function CreateSession({ disabled, onCreated }: { disabled: boolean; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await hostApi.createSession(name)
      onCreated()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
      <TextField
        label="Nombre del evento"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Cumpleaños de la abuela"
        maxLength={60}
        required
      />
      {error && <p className="text-alerta">{error}</p>}
      <Button type="submit" disabled={disabled || busy || name.trim() === ''}>
        {busy ? 'Creando…' : 'Crear sesión'}
      </Button>
    </form>
  )
}

function Notice({
  tone,
  children,
  onClose,
}: {
  tone: 'alerta' | 'bombillo'
  children: ReactNode
  onClose?: () => void
}) {
  const color =
    tone === 'alerta' ? 'border-alerta/50 text-alerta' : 'border-bombillo/50 text-bombillo'
  return (
    <div
      className={`flex items-start justify-between gap-4 rounded-2xl border p-4 ${color}`}
      role="status"
    >
      <p>{children}</p>
      {onClose && (
        <button type="button" className="shrink-0 underline" onClick={onClose}>
          Cerrar
        </button>
      )}
    </div>
  )
}
