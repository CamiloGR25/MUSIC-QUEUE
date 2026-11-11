import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  // El .env vive en la raíz del monorepo; se lee API_PORT (no PORT, que es del frontend).
  const env = loadEnv(mode, '../..', '')
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
