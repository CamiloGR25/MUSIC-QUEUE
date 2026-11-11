# Cola musical

Aplicación web para eventos privados: los invitados escanean un QR, piden canciones de Spotify y votan las que quieren oír. La canción con más votos es la siguiente en sonar en la cuenta Spotify Premium del anfitrión. Los invitados no necesitan cuenta ni instalar nada.

> Uso personal y no comercial. Spotify no permite reproducir su música en público desde un negocio.

## Estado

En desarrollo, etapa E0 (base del proyecto). Aún no hay conexión con Spotify.

## Stack

- **Monorepo npm**: `apps/api` (Fastify + TypeScript), `apps/web` (React + Vite + Tailwind), `packages/shared` (esquemas Zod compartidos).
- **Sin base de datos**: las sesiones viven en memoria y se borran al finalizar.
- **Tiempo real** con Server-Sent Events.
- Un solo servicio sirve la API y el frontend en el mismo dominio.

## Requisitos

- Node.js 24 o superior.

## Desarrollo

```bash
npm install
cp .env.example .env
npm run dev
```

Abre **http://127.0.0.1:5180** (no `localhost`: Spotify no acepta `localhost` como URL de retorno). La API corre en el puerto `API_PORT` (3180) y Vite le redirige `/api`.

| Comando         | Qué hace                                                      |
| --------------- | ------------------------------------------------------------- |
| `npm run dev`   | API y frontend con recarga automática                         |
| `npm run check` | Tipos, lint (oxlint), formato (Prettier) y pruebas (Vitest)   |
| `npm run build` | Compila el frontend y la API                                  |
| `npm start`     | Servidor de producción (sirve la API y el frontend compilado) |

## Variables de entorno

Ver `.env.example`. **Nunca subas el archivo `.env`**: el repositorio es público y los secretos van solo en `.env` local y en el panel de Render.

## Licencia

MIT
