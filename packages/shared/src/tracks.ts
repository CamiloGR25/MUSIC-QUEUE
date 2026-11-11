import { z } from 'zod'

/** Id de canción de Spotify: 22 caracteres base62. */
export const spotifyTrackIdSchema = z.string().regex(/^[0-9A-Za-z]{22}$/)

export const searchQuerySchema = z.object({
  q: z.string().trim().min(2, 'Escribe al menos 2 letras.').max(100),
  /** Páginas de 10 (máximo de Spotify en modo de desarrollo), hasta 5 páginas. */
  offset: z.coerce.number().int().min(0).max(40).multipleOf(10).default(0),
})

export const addTrackBodySchema = z.object({ spotifyTrackId: spotifyTrackIdSchema })

const catalogFields = {
  spotifyTrackId: z.string(),
  spotifyUrl: z.string(),
  name: z.string(),
  artist: z.string(),
  album: z.string(),
  imageUrl: z.string().nullable(),
  durationMs: z.number().int().positive(),
  explicit: z.boolean(),
}

/** Resultado del buscador (docs/DISENO.md §4.1), con la marca "Ya en la cola". */
export const searchResultSchema = z.object({
  ...catalogFields,
  inQueue: z.object({ trackId: z.string() }).nullable(),
})
export type SearchResult = z.infer<typeof searchResultSchema>

export const searchResponseSchema = z.object({
  items: z.array(searchResultSchema),
  nextOffset: z.number().int().nullable(),
})
export type SearchResponse = z.infer<typeof searchResponseSchema>

/** Canción de la cola (docs/DISENO.md §4.1). */
export const trackViewSchema = z.object({
  id: z.string(),
  ...catalogFields,
  votes: z.number().int().nonnegative(),
  /** Apodo o "Invitado N" de quien la pidió. */
  addedBy: z.string(),
  /** Posición en la cola de pendientes (R-COLA-01). */
  position: z.number().int().positive(),
})
export type TrackView = z.infer<typeof trackViewSchema>

export const addTrackResponseSchema = z.object({ track: trackViewSchema })
