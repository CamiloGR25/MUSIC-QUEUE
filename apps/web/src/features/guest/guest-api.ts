import { addTrackResponseSchema, searchResponseSchema, sessionSnapshotSchema } from '@musica/shared'
import { z } from 'zod'
import { getJson, postJson, sendJson } from '../../lib/api-client.ts'

const nameSchema = z.object({ name: z.string() })
const path = (code: string) => `/sessions/${encodeURIComponent(code)}`

export const guestApi = {
  snapshot: (code: string, signal?: AbortSignal) =>
    getJson(path(code), sessionSnapshotSchema, signal),
  join: (code: string, displayName: string) =>
    postJson(`${path(code)}/participants`, { displayName }, sessionSnapshotSchema),
  rename: (code: string, displayName: string) =>
    sendJson('PATCH', `${path(code)}/participants/me`, { displayName }, nameSchema),
  search: (code: string, q: string, offset: number, signal?: AbortSignal) =>
    getJson(
      `${path(code)}/search?${new URLSearchParams({ q, offset: String(offset) })}`,
      searchResponseSchema,
      signal,
    ),
  addTrack: (code: string, spotifyTrackId: string) =>
    postJson(`${path(code)}/tracks`, { spotifyTrackId }, addTrackResponseSchema),
}
