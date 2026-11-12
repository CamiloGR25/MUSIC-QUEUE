import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseEnv } from 'node:util'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Lee el .env de la raíz del monorepo sin pasar por `loadEnv` de Vite: ese archivo trae
 * NODE_ENV=development (para la API) y `loadEnv` lo adopta, con lo que `vite build` saldría con
 * React de desarrollo. Aquí solo se usan API_PORT y GUEST_BASE_URL. Las variables del sistema
 * tienen prioridad sobre el archivo.
 */
function devEnv(): Record<string, string | undefined> {
  const file = resolve(import.meta.dirname, '../../.env')
  const fromFile = existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {}
  return { ...fromFile, ...process.env }
}

export default defineConfig(() => {
  const env = devEnv()
  // API_PORT y no PORT: PORT es del frontend en la vista previa.
  const apiPort = Number(env.API_PORT ?? 3180)

  return {
    plugins: [react(), tailwindcss()],
    server: {
      // 127.0.0.1 y no localhost: Spotify solo acepta esa URL de retorno (docs/DISENO.md §6).
      // Con GUEST_BASE_URL (celulares en el mismo Wi-Fi) escucha también en la red local.
      host: env.GUEST_BASE_URL ? '0.0.0.0' : '127.0.0.1',
      port: 5180,
      strictPort: true,
      proxy: {
        '/api': { target: `http://127.0.0.1:${apiPort}` },
      },
    },
  }
})
