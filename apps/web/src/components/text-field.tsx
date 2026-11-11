import type { InputHTMLAttributes } from 'react'

/** Campo de texto de 48 px de alto con su etiqueta (docs/DISENO.md §9.4). */
export function TextField({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-titulo font-bold">{label}</span>
      <input
        className="min-h-12 rounded-xl border border-arena/40 bg-mesa px-4 text-crema placeholder:text-arena/70"
        {...props}
      />
    </label>
  )
}
