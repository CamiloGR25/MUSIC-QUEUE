import { healthResponseSchema } from '@musica/shared'
import { useEffect, useState } from 'react'
import { getJson } from '../lib/api-client.ts'

type ServerState = 'checking' | 'online' | 'offline'

/**
 * Pantalla de inicio de la etapa E0: confirma que frontend y API funcionan juntos.
 * Las pantallas de invitado y anfitrión llegan en E1 y E2.
 */
export function App() {
  const [server, setServer] = useState<ServerState>('checking')

  useEffect(() => {
    const controller = new AbortController()
    getJson('/health', healthResponseSchema, controller.signal)
      .then(() => setServer('online'))
      .catch(() => {
        if (!controller.signal.aborted) setServer('offline')
      })
    return () => controller.abort()
  }, [])

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-10">
      <h1 className="text-sesion leading-tight font-bold">Cola musical</h1>
      <p className="text-titulo text-arena">
        Escanea el código QR del anfitrión para pedir canciones y votar las que quieres oír.
      </p>
      <p className="text-meta text-arena" role="status">
        {server === 'checking' && 'Conectando con el servidor…'}
        {server === 'online' && 'Servidor listo.'}
        {server === 'offline' && (
          <span className="text-alerta">
            El servidor no responde. Intenta de nuevo en un minuto.
          </span>
        )}
      </p>
    </main>
  )
}
