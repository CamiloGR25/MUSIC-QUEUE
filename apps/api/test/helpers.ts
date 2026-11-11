import { buildApp } from '../src/app.ts'
import { type AppConfig, loadConfig } from '../src/config/env.ts'

export function testConfig(webDistDir: string | null = null): AppConfig {
  return loadConfig({ NODE_ENV: 'test', PUBLIC_BASE_URL: 'http://127.0.0.1:5180' }, webDistDir)
}

export function testApp(webDistDir: string | null = null) {
  return buildApp(testConfig(webDistDir), { logger: false })
}
