/** Nombre de la reunión familiar: título de la app en todas las pantallas del invitado. */
export const APP_NAME = 'El Imperio Bar'

/**
 * Título "El Imperio Bar" con una tirita de bombillos encima (el motivo de la guirnalda,
 * docs/DISENO.md §9.1). `as="p"` cuando la pantalla ya tiene su propio título principal.
 */
export function Brand({ as: Tag = 'h1' }: { as?: 'h1' | 'p' }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="flex gap-1.5" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((bulb) => (
          <span
            key={bulb}
            className="size-1.5 rounded-full bg-bombillo shadow-[0_0_6px_1px_rgba(245,184,61,0.55)]"
          />
        ))}
      </span>
      <Tag className="text-grande leading-none font-bold tracking-tight">{APP_NAME}</Tag>
    </div>
  )
}
