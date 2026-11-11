import type { TrackView } from '@musica/shared'
import { useState } from 'react'

/** Quitar una canción de la cola con confirmación en el mismo renglón (R-CAN-06). */
export function RemoveTrackButton({ track, onRemove }: { track: TrackView; onRemove: () => void }) {
  const [confirming, setConfirming] = useState(false)
  if (!confirming) {
    return (
      <button
        type="button"
        className="min-h-12 shrink-0 rounded-xl border border-arena/40 px-3 text-arena hover:border-alerta hover:text-alerta"
        aria-label={`Quitar ${track.name} de la cola`}
        onClick={() => setConfirming(true)}
      >
        Quitar
      </button>
    )
  }
  return (
    <div className="flex shrink-0 gap-2" role="group" aria-label={`¿Quitar ${track.name}?`}>
      <button
        type="button"
        className="min-h-12 rounded-xl px-3 text-arena hover:text-crema"
        onClick={() => setConfirming(false)}
      >
        No
      </button>
      <button
        type="button"
        className="min-h-12 rounded-xl border border-alerta/60 px-3 font-bold text-alerta"
        onClick={() => {
          setConfirming(false)
          onRemove()
        }}
      >
        Sí, quitar
      </button>
    </div>
  )
}
