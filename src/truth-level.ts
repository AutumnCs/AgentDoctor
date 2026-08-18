export type TruthLevel = 'fact' | 'derived' | 'hypothesis' | 'unknown'

/** 估计值：必须显式标注，禁止伪造精度。 */
export interface Estimated {
  value: number
  estimated: true
  level: TruthLevel
}

/** 包装一个估计值。调用方必须知道这是 estimate，不是 fact。 */
export function estimate(value: number, level: TruthLevel = 'derived'): Estimated {
  return { value, estimated: true, level }
}
