const MINUTE_MS = 60_000

/** Desfase (minutos) de una zona horaria en un instante, p. ej. -300 para America/Bogota. */
export function timeZoneOffsetMinutes(at: number, timeZone: string): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(at)
    .find((part) => part.type === 'timeZoneName')?.value
  const match = name?.match(/GMT([+-])(\d{2}):(\d{2})/)
  if (!match) return 0 // "GMT" a secas: UTC
  const minutes = Number(match[2]) * 60 + Number(match[3])
  return match[1] === '-' ? -minutes : minutes
}

/**
 * Próximo instante (ms) en que el reloj local de `timeZone` marca `hhmm` ("04:00"),
 * estrictamente después de `now` (R-AWAKE-02).
 */
export function nextLocalTime(now: number, hhmm: string, timeZone: string): number {
  const [hours, minutes] = hhmm.split(':').map(Number) as [number, number]
  const local = new Date(now + timeZoneOffsetMinutes(now, timeZone) * MINUTE_MS)
  for (let addDays = 0; addDays <= 2; addDays++) {
    const wallClock = Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate() + addDays,
      hours,
      minutes,
    )
    const candidate = wallClock - timeZoneOffsetMinutes(wallClock, timeZone) * MINUTE_MS
    if (candidate > now) return candidate
  }
  throw new Error(`No se pudo calcular la próxima ${hhmm} en ${timeZone}`)
}
