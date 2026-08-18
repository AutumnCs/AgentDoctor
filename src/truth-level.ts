export type TruthLevel = 'fact' | 'derived' | 'hypothesis' | 'unknown'

/** An estimated value: must be labeled explicitly, never presented with fake precision. */
export interface Estimated {
  value: number
  estimated: true
  level: TruthLevel
}

/** Wrap an estimated value. Callers must know this is an estimate, not a fact. */
export function estimate(value: number, level: TruthLevel = 'derived'): Estimated {
  return { value, estimated: true, level }
}
