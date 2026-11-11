import type { SessionSnapshot, TrackView } from '@musica/shared'
import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Button } from '../../components/button.tsx'
import { TextField } from '../../components/text-field.tsx'
import { ApiRequestError, errorMessage } from '../../lib/api-client.ts'
import { QueueList } from '../queue/queue-list.tsx'
import { SearchSheet } from '../search/search-sheet.tsx'
import { guestApi } from './guest-api.ts'

type State =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; snapshot: SessionSnapshot }

/**
 * Pantalla del invitado (docs/DISENO.md §9.5): entra sin cuenta, con apodo opcional, busca y
 * agrega canciones y ve la cola. Votar y el tiempo real llegan en E4; la música, en E5.
 */
export function GuestPage() {
  const { code = '' } = useParams()
  const navigate = useNavigate()
  const [state, setState] = useState<State>({ kind: 'loading' })

  const show = useCallback(
    (snapshot: SessionSnapshot) => {
      // R-SES-03: si el anfitrión rotó el enlace, quien ya estaba dentro pasa al código nuevo.
      if (snapshot.session.code !== code) {
        void navigate(`/s/${snapshot.session.code}`, { replace: true })
      }
      setState({ kind: 'ready', snapshot })
    },
    [code, navigate],
  )

  useEffect(() => {
    const controller = new AbortController()
    guestApi
      .snapshot(code, controller.signal)
      .then(show)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        if (error instanceof ApiRequestError && error.code === 'SESSION_NOT_FOUND') {
          setState({ kind: 'not-found' })
        } else {
          setState({ kind: 'error', message: errorMessage(error) })
        }
      })
    return () => controller.abort()
  }, [code, show])

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
      {state.kind === 'ready' && <Ready snapshot={state.snapshot} code={code} onChange={show} />}
    </main>
  )
}

function Ready({
  snapshot,
  code,
  onChange,
}: {
  snapshot: SessionSnapshot
  code: string
  onChange: (snapshot: SessionSnapshot) => void
}) {
  const [searching, setSearching] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(timer)
  }, [notice])

  if (snapshot.session.status === 'ended') {
    return <Message title="La sesión terminó">Gracias por la música.</Message>
  }
  if (!snapshot.me) return <Join snapshot={snapshot} code={code} onJoined={onChange} />

  const added = async (track: TrackView) => {
    setSearching(false)
    setNotice(`Agregaste ${track.name}. Tu voto ya cuenta.`)
    // Hasta E4 (tiempo real) la cola se actualiza al agregar o al recargar.
    onChange(await guestApi.snapshot(snapshot.session.code))
  }

  return (
    <>
      <header className="flex flex-col gap-3">
        <h1 className="text-sesion leading-tight font-bold">{snapshot.session.name}</h1>
        <MyName
          code={snapshot.session.code}
          name={snapshot.me.name}
          onRenamed={(name) => onChange({ ...snapshot, me: { ...snapshot.me!, name } })}
        />
      </header>

      <p role="status" className="min-h-6 text-hoja">
        {notice}
      </p>

      <section className="flex flex-col gap-2" aria-labelledby="cola">
        <h2 id="cola" className="text-titulo font-bold">
          Cola
        </h2>
        <QueueList queue={snapshot.queue} />
      </section>

      <p className="pb-24 text-meta text-arena">Canciones y portadas de Spotify.</p>

      <div className="fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-noche via-noche/95 to-transparent px-4 pt-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto w-full max-w-md">
          <Button className="w-full" onClick={() => setSearching(true)}>
            + Añadir canción
          </Button>
        </div>
      </div>

      {searching && (
        <SearchSheet
          code={snapshot.session.code}
          onAdded={(track) => void added(track)}
          onClose={() => setSearching(false)}
        />
      )}
    </>
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
      <div className="flex flex-col gap-2">
        <h1 className="text-sesion leading-tight font-bold">{snapshot.session.name}</h1>
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
      <h1 className="text-sesion leading-tight font-bold">{title}</h1>
      <p className="text-titulo text-arena">{children}</p>
    </section>
  )
}
