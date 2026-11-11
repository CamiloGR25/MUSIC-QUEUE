import type { ComponentProps } from 'react'

type Variant = 'primary' | 'secondary' | 'danger'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-hoja text-hoja-tinta hover:brightness-110',
  secondary: 'border border-arena/40 text-crema hover:bg-mesa-alta',
  danger: 'border border-alerta/60 text-alerta hover:bg-alerta/10',
}

/** Píldora de 48 px de alto (objetivo táctil, docs/DISENO.md §9.4). */
export const buttonClass = (variant: Variant = 'primary') =>
  `inline-flex min-h-12 items-center justify-center rounded-full px-6 font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]}`

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ComponentProps<'button'> & { variant?: Variant }) {
  return <button type="button" className={`${buttonClass(variant)} ${className}`} {...props} />
}
