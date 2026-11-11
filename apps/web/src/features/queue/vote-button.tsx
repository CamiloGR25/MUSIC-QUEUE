import type { TrackView } from '@musica/shared'
import { ThumbsUp } from 'lucide-react'
import { motion } from 'motion/react'

/**
 * Botón de voto de 48 px de alto (docs/DISENO.md §9.5): pulgar arriba y número de votos.
 * El pulgar va siempre en contorno (relleno pierde el dibujo de la mano); si ya votaste, todo el
 * botón pasa a verde hoja sobre un fondo verde suave. Un toque vota y otro quita el voto
 * (R-VOT-03). El número rebota una vez al cambiar.
 */
export function VoteButton({
  track,
  voted,
  busy,
  onToggle,
}: {
  track: TrackView
  voted: boolean
  busy: boolean
  onToggle: () => void
}) {
  const votes = `${track.votes} ${track.votes === 1 ? 'voto' : 'votos'}`
  return (
    <button
      type="button"
      aria-pressed={voted}
      aria-label={
        voted ? `Quitar tu voto de ${track.name}, ${votes}` : `Votar por ${track.name}, ${votes}`
      }
      disabled={busy}
      onClick={onToggle}
      className={`flex min-h-12 min-w-16 shrink-0 items-center justify-center gap-1.5 rounded-xl px-2.5 font-bold tabular transition-colors ${
        voted
          ? 'border-2 border-hoja bg-hoja/15 text-hoja'
          : 'border border-arena/40 text-crema hover:border-hoja hover:text-hoja'
      }`}
    >
      <ThumbsUp aria-hidden="true" className="size-5" strokeWidth={voted ? 2.5 : 2} />
      <motion.span
        key={track.votes}
        initial={{ scale: 1.35 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 18 }}
      >
        {track.votes}
      </motion.span>
    </button>
  )
}
