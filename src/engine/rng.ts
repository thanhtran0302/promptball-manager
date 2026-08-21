// RNG déterministe (mulberry32) : même seed + mêmes instructions = même match.

export class Rng {
  private s: number

  constructor(seed: number) {
    this.s = seed >>> 0
  }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0
    let t = this.s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Vrai avec probabilité p */
  chance(p: number): boolean {
    return this.next() < p
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive)
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)]
  }

  /** Tirage pondéré — renvoie l'index. */
  weighted(weights: number[]): number {
    let total = 0
    for (const w of weights) total += w
    let r = this.next() * total
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i]
      if (r <= 0) return i
    }
    return weights.length - 1
  }
}
