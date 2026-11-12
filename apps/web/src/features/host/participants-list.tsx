import type { HostParticipant } from '@musica/shared'
import { useState } from 'react'

/**
 * Invitados de la sesión en orden de llegada (R-PAR-03): cuántas canciones pidió cada uno y la
 * opción de bloquearlo (no puede agregar ni votar) o desbloquearlo, con confirmación al bloquear.
 */
export function ParticipantsList({
  participants,
  onToggle,
}: {
  participants: HostParticipant[]
  onToggle: (participant: HostParticipant) => void
}) {
  const [confirming, setConfirming] = useState<string | null>(null)

  if (participants.length === 0) {
    return <p className="text-arena">Todavía no ha entrado nadie. Muestra el QR para empezar.</p>
  }

  return (
    <ul className="flex flex-col divide-y divide-mesa-alta" aria-label="Invitados">
      {participants.map((participant) => {
        const blocked = participant.status === 'blocked'
        const songs = participant.tracksAdded
        return (
          <li key={participant.id} className="flex min-h-14 items-center gap-3 py-2">
            <div className="flex min-w-0 flex-1 flex-col">
              <p className={`truncate font-bold ${blocked ? 'text-arena line-through' : ''}`}>
                {participant.name}
              </p>
              <p className="text-meta text-arena">
                {blocked
                  ? 'Bloqueado: no puede pedir ni votar'
                  : songs === 0
                    ? 'Todavía no ha pedido canciones'
                    : `${songs} ${songs === 1 ? 'canción pedida' : 'canciones pedidas'}`}
              </p>
            </div>
            {confirming === participant.id ? (
              <div
                className="flex shrink-0 gap-2"
                role="group"
                aria-label={`¿Bloquear a ${participant.name}?`}
              >
                <button
                  type="button"
                  className="min-h-12 rounded-xl px-3 text-arena hover:text-crema"
                  onClick={() => setConfirming(null)}
                >
                  No
                </button>
                <button
                  type="button"
                  className="min-h-12 rounded-xl border border-alerta/60 px-3 font-bold text-alerta"
                  onClick={() => {
                    setConfirming(null)
                    onToggle(participant)
                  }}
                >
                  Sí, bloquear
                </button>
              </div>
            ) : (
              <button
                type="button"
                className={`min-h-12 shrink-0 rounded-xl border px-3 ${
                  blocked
                    ? 'border-hoja/60 text-hoja'
                    : 'border-arena/40 text-arena hover:border-alerta hover:text-alerta'
                }`}
                aria-label={`${blocked ? 'Desbloquear' : 'Bloquear'} a ${participant.name}`}
                onClick={() => (blocked ? onToggle(participant) : setConfirming(participant.id))}
              >
                {blocked ? 'Desbloquear' : 'Bloquear'}
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
