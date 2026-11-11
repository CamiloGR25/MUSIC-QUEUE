import QRCode from 'qrcode'
import { useEffect, useState } from 'react'

/**
 * Código QR generado en el navegador (sin servicios externos). Oscuro sobre crema para que
 * cualquier cámara lo lea, incluso con el tema oscuro.
 */
export function QrCode({
  value,
  label,
  className = '',
}: {
  value: string
  label: string
  className?: string
}) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void QRCode.toString(value, {
      type: 'svg',
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#1B1612', light: '#F4EADB' },
    }).then((svg) => {
      if (!cancelled) setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)
    })
    return () => {
      cancelled = true
    }
  }, [value])

  if (!src) return <div className={`aspect-square rounded-2xl bg-mesa-alta ${className}`} />
  return <img src={src} alt={label} className={`aspect-square rounded-2xl ${className}`} />
}
