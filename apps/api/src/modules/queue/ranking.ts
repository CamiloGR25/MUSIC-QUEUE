/** Lo mínimo que necesita el orden de la cola. */
export type Rankable = { votes: number; createdAt: number; seq: number }

/**
 * R-COLA-01: más votos primero; en empate, la agregada antes (antigüedad); y si llegaron en el
 * mismo milisegundo, el orden de llegada (`seq`). Determinista: todos ven el mismo orden.
 */
export function compareQueue(a: Rankable, b: Rankable): number {
  return b.votes - a.votes || a.createdAt - b.createdAt || a.seq - b.seq
}

export function rankQueue<T extends Rankable>(items: Iterable<T>): T[] {
  return [...items].sort(compareQueue)
}
