/**
 * Piezas comunes de una canción. La política de Spotify exige mostrar la portada sin recortarla
 * ni alterarla y enlazar a la canción en Spotify (docs/ANALISIS.md §2.2).
 */
export function TrackCover({
  src,
  alt,
  size = 'sm',
}: {
  src: string | null
  alt: string
  size?: 'sm' | 'lg'
}) {
  const box = size === 'lg' ? 'size-40' : 'size-12'
  if (!src) return <div className={`${box} shrink-0 rounded-md bg-mesa-alta`} aria-hidden="true" />
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={`${box} shrink-0 rounded-md bg-mesa-alta object-contain`}
    />
  )
}

/** Marca de contenido explícito, como la de Spotify (D-11: siempre permitido). */
export function ExplicitBadge() {
  return (
    <span
      className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm bg-arena text-[10px] leading-none font-bold text-noche"
      title="Explícita"
      aria-label="Explícita"
    >
      E
    </span>
  )
}
