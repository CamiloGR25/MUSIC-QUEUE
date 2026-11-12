import { fixedEntrySchema } from '@musica/shared'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Brand } from '../../components/brand.tsx'
import { Button } from '../../components/button.tsx'
import { ApiRequestError, errorMessage, getJson } from '../../lib/api-client.ts'

type State =
  { kind: 'loading' } | { kind: 'no-party' } | { kind: 'error'; title: string; text: string }

/**
 * Entrada por el QR impreso (D-21): busca la sesión activa del anfitrión y entra a ella.
 * Si todavía no hay fiesta, lo dice y permite volver a intentar.
 */
export function FixedEntryPage() {
  const { code = '' } = useParams()
  const navigate = useNavigate()
  const [state, setState] = useState<State>({ kind: 'loading' })

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState({ kind: 'loading' })
      try {
        const { sessionCode } = await getJson(
          `/fixed/${encodeURIComponent(code)}`,
          fixedEntrySchema,
          signal,
        )
        void navigate(`/s/${sessionCode}`, { replace: true })
      } catch (error) {
        if (signal?.aborted) return
        if (error instanceof ApiRequestError && error.code === 'NO_ACTIVE_SESSION') {
          setState({ kind: 'no-party' })
        } else if (error instanceof ApiRequestError && error.code === 'SESSION_NOT_FOUND') {
          setState({
            kind: 'error',
            title: 'Este código no existe',
            text: 'Revisa que estés escaneando el QR del anfitrión.',
          })
        } else {
          setState({ kind: 'error', title: 'No pudimos entrar', text: errorMessage(error) })
        }
      }
    },
    [code, navigate],
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4 py-10">
      <Brand as="p" />
      {state.kind === 'loading' && <p className="text-arena">Buscando la fiesta…</p>}
      {state.kind === 'no-party' && (
        <>
          <h1 className="text-sesion leading-tight font-bold">Todavía no hay una fiesta activa</h1>
          <p className="text-titulo text-arena">
            Cuando el anfitrión la inicie, vuelve a escanear el QR o toca el botón.
          </p>
          <Button onClick={() => void load()}>Volver a intentar</Button>
        </>
      )}
      {state.kind === 'error' && (
        <>
          <h1 className="text-sesion leading-tight font-bold">{state.title}</h1>
          <p className="text-titulo text-arena">{state.text}</p>
        </>
      )}
    </main>
  )
}
