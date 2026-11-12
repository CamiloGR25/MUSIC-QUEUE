/** Cantidad de bombillos de la guirnalda. */
export const BULBS = 14

/**
 * Barra de progreso de la canción como una guirnalda de bombillos que se van encendiendo
 * (docs/DISENO.md §9.1, el detalle memorable de la identidad). El cable cuelga en curva.
 * Es solo visual: el progreso se anuncia en texto al lado.
 */
export function Garland({ progress }: { progress: number }) {
  const lit = Math.round(Math.min(1, Math.max(0, progress)) * BULBS)
  return (
    <div className="relative h-8 w-full" aria-hidden="true">
      <svg
        className="absolute inset-0 h-full w-full overflow-visible"
        viewBox="0 0 100 32"
        preserveAspectRatio="none"
      >
        <path
          d="M 0 8 Q 50 26 100 8"
          fill="none"
          stroke="var(--color-arena)"
          strokeOpacity="0.45"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {Array.from({ length: BULBS }, (_, index) => {
        const x = (index + 0.5) / BULBS
        // Misma curva que el cable: y = 8 + 18·4x(1−x) en una caja de 32.
        const y = 8 + 18 * 4 * x * (1 - x)
        const on = index < lit
        return (
          <span
            key={index}
            data-on={on}
            className={`absolute size-2.5 -translate-x-1/2 rounded-full transition-colors duration-500 motion-reduce:transition-none ${
              on ? 'bg-bombillo shadow-[0_0_8px_2px_rgba(245,184,61,0.55)]' : 'bg-mesa-alta'
            }`}
            style={{ left: `${x * 100}%`, top: `${(y / 32) * 100}%` }}
          />
        )
      })}
    </div>
  )
}
