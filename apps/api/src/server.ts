import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildApp } from './app.ts'
import { loadConfig } from './config/env.ts'

// En desarrollo las variables vienen de musica-app/.env; en Render, de su panel.
const envFile = resolve(import.meta.dirname, '../../../.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)

const webDist = resolve(import.meta.dirname, '../../web/dist')
const config = loadConfig(process.env, existsSync(webDist) ? webDist : null)
const app = await buildApp(config)

const shutdown = async (signal: string) => {
  app.log.info(`Recibido ${signal}, cerrando`)
  await app.close()
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

try {
  await app.listen({ port: config.port, host: config.host })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
