import type { SearchResult, TrackView } from '@musica/shared'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/button.tsx'
import { ExplicitBadge, TrackCover } from '../../components/track-bits.tsx'
import { ApiRequestError, errorMessage } from '../../lib/api-client.ts'
import { formatDuration } from '../../lib/format.ts'
import { guestApi } from '../guest/guest-api.ts'

/** Espera entre teclas antes de buscar (docs/DISENO.md §7.2). */
export const SEARCH_DEBOUNCE_MS = 300
const MIN_QUERY = 2

type Results =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; query: string; items: SearchResult[]; nextOffset: number | null }

/**
 * Buscador en hoja inferior (docs/DISENO.md §9.5): busca mientras escribes, muestra si la
 * canción ya está en la cola y pide confirmación antes de agregarla.
 */
export function SearchSheet({
  code,
  onAdded,
  onClose,
}: {
  code: string
  onAdded: (track: TrackView) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Results>({ kind: 'idle' })
  const [selected, setSelected] = useState<SearchResult | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const q = query.trim()
    if (q.length < MIN_QUERY) {
      setResults({ kind: 'idle' })
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setResults({ kind: 'loading' })
      guestApi
        .search(code, q, 0, controller.signal)
        .then((page) => setResults({ kind: 'ready', query: q, ...page }))
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            setResults({ kind: 'error', message: errorMessage(error) })
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [code, query, attempt])

  const loadMore = async () => {
    if (results.kind !== 'ready' || results.nextOffset === null) return
    setLoadingMore(true)
    try {
      const page = await guestApi.search(code, results.query, results.nextOffset)
      setResults({
        ...results,
        items: [...results.items, ...page.items],
        nextOffset: page.nextOffset,
      })
    } catch (error) {
      setResults({ kind: 'error', message: errorMessage(error) })
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    // En celular es una hoja que sube desde abajo; en pantallas grandes, una ventana centrada.
    <div
      className="fixed inset-0 z-40 flex flex-col justify-end bg-noche/70 sm:items-center sm:justify-center sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Añadir canción"
        className="mx-auto flex h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-[20px] bg-mesa sm:h-[min(85dvh,44rem)] sm:rounded-[20px]"
        onClick={(event) => event.stopPropagation()}
      >
        {selected ? (
          <Confirm
            code={code}
            track={selected}
            onCancel={() => setSelected(null)}
            onAdded={onAdded}
          />
        ) : (
          <>
            <div className="flex items-center gap-2 p-4">
              <input
                type="search"
                className="min-h-12 flex-1 rounded-xl border border-arena/40 bg-noche px-4 text-crema placeholder:text-arena/70"
                placeholder="Canción, artista o álbum"
                aria-label="Buscar canción, artista o álbum"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
                enterKeyHint="search"
              />
              <button
                type="button"
                className="min-h-12 min-w-12 rounded-full text-titulo text-arena hover:text-crema"
                aria-label="Cerrar buscador"
                onClick={onClose}
              >
                ✕
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
              <ResultsView
                results={results}
                onSelect={setSelected}
                onRetry={() => setAttempt((n) => n + 1)}
              />
              {results.kind === 'ready' && results.nextOffset !== null && (
                <Button
                  variant="secondary"
                  className="mt-4 w-full"
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                >
                  {loadingMore ? 'Cargando…' : 'Ver más resultados'}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function ResultsView({
  results,
  onSelect,
  onRetry,
}: {
  results: Results
  onSelect: (track: SearchResult) => void
  onRetry: () => void
}) {
  if (results.kind === 'idle') {
    return <p className="text-arena">Escribe el nombre de una canción, un artista o un álbum.</p>
  }
  if (results.kind === 'loading') {
    return (
      <div className="flex flex-col gap-3" aria-label="Buscando">
        {[0, 1, 2, 3].map((n) => (
          <div key={n} className="flex animate-pulse items-center gap-3 py-1">
            <div className="size-12 rounded-md bg-mesa-alta" />
            <div className="h-4 flex-1 rounded bg-mesa-alta" />
          </div>
        ))}
      </div>
    )
  }
  if (results.kind === 'error') {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-alerta">{results.message}</p>
        <Button variant="secondary" onClick={onRetry}>
          Reintentar
        </Button>
      </div>
    )
  }
  if (results.items.length === 0) {
    return (
      <p className="text-arena">
        No encontramos «{results.query}». Prueba con el nombre del artista.
      </p>
    )
  }
  return (
    <ul className="flex flex-col divide-y divide-mesa-alta">
      {results.items.map((track) => (
        <li key={track.spotifyTrackId}>
          <button
            type="button"
            className="flex w-full items-center gap-3 py-3 text-left disabled:cursor-default"
            disabled={track.inQueue !== null}
            onClick={() => onSelect(track)}
          >
            <TrackCover src={track.imageUrl} alt={`Portada de ${track.album}`} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-bold">{track.name}</span>
              <span className="flex items-center gap-1.5 text-meta text-arena">
                {track.explicit && <ExplicitBadge />}
                <span className="truncate">{track.artist}</span>
              </span>
              <span className="truncate text-meta text-arena">{track.album}</span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1 text-meta">
              <span className="text-arena tabular">{formatDuration(track.durationMs)}</span>
              {track.inQueue && <span className="text-hoja">Ya en la cola</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function Confirm({
  code,
  track,
  onCancel,
  onAdded,
}: {
  code: string
  track: SearchResult
  onCancel: () => void
  onAdded: (track: TrackView) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => confirmRef.current?.focus(), [])

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      onAdded((await guestApi.addTrack(code, track.spotifyTrackId)).track)
    } catch (err) {
      setError(
        err instanceof ApiRequestError && err.code === 'DUPLICATE_TRACK'
          ? 'Alguien ya la pidió: está en la cola. Puedes votarla.'
          : errorMessage(err),
      )
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <TrackCover src={track.imageUrl} alt={`Portada de ${track.album}`} size="lg" />
      <div className="flex flex-col items-center gap-1">
        <p className="text-titulo font-bold">{track.name}</p>
        <p className="flex items-center gap-1.5 text-arena">
          {track.explicit && <ExplicitBadge />}
          {track.artist}
        </p>
        <p className="text-meta text-arena">{track.album}</p>
        <p className="text-arena tabular">{formatDuration(track.durationMs)}</p>
      </div>
      {error && <p className="text-alerta">{error}</p>}
      <div className="flex w-full gap-3">
        <Button variant="secondary" className="flex-1" onClick={onCancel}>
          Cancelar
        </Button>
        <Button ref={confirmRef} className="flex-1" disabled={busy} onClick={() => void confirm()}>
          {busy ? 'Agregando…' : 'Confirmar'}
        </Button>
      </div>
    </div>
  )
}
