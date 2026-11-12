import type { SessionSnapshot } from '@musica/shared'
import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Button } from '../../components/button.tsx'
import { Brand } from '../../components/brand.tsx'
import { TextField } from '../../components/text-field.tsx'
import { ApiRequestError, errorMessage } from '../../lib/api-client.ts'
import { guestApi } from './guest-api.ts'
import { GuestSession, type Update } from './guest-session.tsx'

type State =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; snapshot: SessionSnapshot }

/**
 * Pantalla del invitado (docs/DISENO.md §9.5): entra sin cuenta, con apodo opcional, busca,
 * agrega y vota canciones, y ve la cola en vivo. La música llega en E5.
 */
export function GuestPage() {
  const { code = '' } = useParams()
  const navigate = useNavigate()
  const [state, setState] = useState<State>({ kind: 'loading' })

  const update: Update = useCallback(
    (change) =>
      setState((current) =>
        current.kind === 'ready' ? { kind: 'ready', snapshot: change(current.snapshot) } : current,
      ),
    [],
  )

  useEffect(() => {
    const controller = new AbortController()
    guestApi
      .snapshot(code, controller.signal)
      .then((snapshot) => setState({ kind: 'ready', snapshot }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        if (error instanceof ApiRequestError && error.code === 'SESSION_NOT_FOUND') {
          setState({ kind: 'not-found' })
        } else {
          setState({ kind: 'error', message: errorMessage(error) })
        }
      })
    return () => controller.abort()
  }, [code])

  // R-SES-03: si el anfitrión rotó el enlace, quien ya estaba dentro pasa al código nuevo.
  const currentCode = state.kind === 'ready' ? state.snapshot.session.code : code
  useEffect(() => {
    if (currentCode !== code) void navigate(`/s/${currentCode}`, { replace: true })
  }, [currentCode, code, navigate])

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-8 px-4 py-10">
      {state.kind === 'loading' && <p className="text-arena">Cargando la sesión…</p>}
      {state.kind === 'not-found' && (
        <Message title="Este enlace ya no funciona">
          Pide al anfitrión que te muestre el QR de nuevo.
        </Message>
      )}
      {state.kind === 'error' && (
        <Message title="No pudimos cargar la sesión">{state.message}</Message>
      )}
      {state.kind === 'ready' && (
        <Ready
          snapshot={state.snapshot}
          code={code}
          update={update}
          onLost={() => setState({ kind: 'not-found' })}
        />
      )}
    </main>
  )
}

function Ready({
  snapshot,
  code,
  update,
  onLost,
}: {
  snapshot: SessionSnapshot
  code: string
  update: Update
  onLost: () => void
}) {
  if (snapshot.session.status === 'ended') {
    return <Message title="La sesión terminó">Gracias por la música.</Message>
  }
  const me = snapshot.me
  if (!me) return <Join snapshot={snapshot} code={code} onJoined={(next) => update(() => next)} />
  return (
    <GuestSession
      snapshot={snapshot}
      update={update}
      onLost={onLost}
      header={
        <header className="flex flex-col gap-3">
          <Brand />
          <h2 className="text-titulo font-bold text-bombillo">{snapshot.session.name}</h2>
          <MyName
            code={snapshot.session.code}
            name={me.name}
            onRenamed={(name) =>
              update((current) => ({ ...current, me: current.me && { ...current.me, name } }))
            }
          />
        </header>
      }
    />
  )
}

function Join({
  snapshot,
  code,
  onJoined,
}: {
  snapshot: SessionSnapshot
  code: string
  onJoined: (snapshot: SessionSnapshot) => void
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onJoined(await guestApi.join(code, name))
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <form className="flex flex-1 flex-col justify-center gap-6" onSubmit={(e) => void submit(e)}>
      <div className="flex flex-col gap-3">
        <Brand />
        <h2 className="text-titulo font-bold text-bombillo">{snapshot.session.name}</h2>
        <p className="text-titulo text-arena">Pide canciones y vota las que quieres oír.</p>
      </div>
      <TextField
        label="¿Cómo te llamamos?"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Tu nombre (opcional)"
        maxLength={24}
        autoComplete="nickname"
      />
      {error && <p className="text-alerta">{error}</p>}
      <Button type="submit" disabled={busy}>
        {busy ? 'Entrando…' : 'Entrar'}
      </Button>
    </form>
  )
}

function MyName({
  code,
  name,
  onRenamed,
}: {
  code: string
  name: string
  onRenamed: (name: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  const [error, setError] = useState<string | null>(null)

  const save = async (event: FormEvent) => {
    event.preventDefault()
    try {
      onRenamed((await guestApi.rename(code, value)).name)
      setEditing(false)
      setError(null)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  if (!editing) {
    return (
      <p className="text-arena">
        Estás como <span className="font-bold text-crema">{name}</span>.{' '}
        <button
          type="button"
          className="underline"
          onClick={() => {
            setValue(name.startsWith('Invitado ') ? '' : name)
            setEditing(true)
          }}
        >
          Cambiar nombre
        </button>
      </p>
    )
  }
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => void save(e)}>
      <TextField
        label="Tu nombre"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Déjalo vacío para quedar como Invitado"
        maxLength={24}
        autoFocus
      />
      {error && <p className="text-alerta">{error}</p>}
      <div className="flex gap-3">
        <Button variant="secondary" onClick={() => setEditing(false)}>
          Cancelar
        </Button>
        <Button type="submit">Guardar</Button>
      </div>
    </form>
  )
}

function Message({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-1 flex-col justify-center gap-3">
      <Brand as="p" />
      <h1 className="mt-4 text-sesion leading-tight font-bold">{title}</h1>
      <p className="text-titulo text-arena">{children}</p>
    </section>
  )
}
