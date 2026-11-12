import { useEffect, useState } from 'react'
import { APP_NAME } from '../../components/brand.tsx'
import { Button } from '../../components/button.tsx'
import { QrCode } from '../../components/qr-code.tsx'

/**
 * QR fijo para imprimir (D-21): siempre lleva a la sesión activa, así que se imprime una vez.
 * La hoja impresa solo contiene la tarjeta (clase `print-area`, ver styles/index.css).
 */
export function PrintableQr({ url }: { url: string }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <section className="flex flex-col gap-3 rounded-3xl border border-mesa-alta p-6">
      <h2 className="text-titulo font-bold">QR para imprimir</h2>
      <p className="text-arena">
        Sirve para todas tus fiestas: siempre lleva a la sesión que tengas activa. Imprímelo una vez
        y déjalo a la vista.
      </p>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Ver e imprimir el QR
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-noche p-6"
          role="dialog"
          aria-modal="true"
          aria-label="QR para imprimir"
        >
          <div className="print-area flex flex-col items-center gap-4 rounded-3xl bg-crema p-8 text-center text-noche">
            <p className="text-grande leading-none font-bold">{APP_NAME}</p>
            <p className="text-seccion font-bold">Pide tu canción</p>
            <QrCode value={url} label="QR fijo para entrar a la fiesta" className="w-72" />
            <p>Escanea con la cámara del celular para pedir canciones y votar.</p>
          </div>
          <div className="flex gap-3 print:hidden">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cerrar
            </Button>
            <Button onClick={() => window.print()}>Imprimir</Button>
          </div>
        </div>
      )}
    </section>
  )
}
