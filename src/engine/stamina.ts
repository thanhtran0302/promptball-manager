// Modèle d'endurance : un réservoir 0-100 par joueur, vidé par l'activité.
// Calibration visée (match complet) :
//   - instructions neutres      → fin de match vers 65-75 %
//   - pressing haut + tempo rap → vers 40-55 %
//   - + overlap intensif sur un latéral → ce joueur vers 20-35 % (avec malus)

import type { LivePlayer, Pressing, Tempo } from './types'

/** Malus d'efficacité selon la fraîcheur : 1.0 au-dessus de 40 %, 0.6 à vide. */
export function staminaFactor(stamina: number): number {
  if (stamina >= 40) return 1
  if (stamina >= 20) return 1 - ((40 - stamina) / 20) * 0.22 // 1.0 → 0.78
  return 0.78 - (Math.max(stamina, 0) / 20) * 0.18 // 0.78 → 0.6
}

/** Vitesse max en m/s dérivée de la carte vitesse + fraîcheur. */
export function maxSpeed(pace: number, stamina: number): number {
  const base = 4.8 + (pace / 99) * 3.8
  return base * staminaFactor(stamina)
}

interface DrainInput {
  /** vitesse réelle / vitesse max ce tick (0..1+) */
  speedRatio: number
  pressing: Pressing
  tempo: Tempo
  /** instruction overlap active en phase d'attaque (ou man_mark en défense) */
  extraWork: boolean
  intensityElevee: boolean
  isGK: boolean
}

const PRESS_DRAIN: Record<Pressing, number> = { bas: 0, moyen: 0.0012, haut: 0.0026 }
const TEMPO_DRAIN: Record<Tempo, number> = { lent: -0.0008, moyen: 0, rapide: 0.0018 }

/** Drain par seconde de jeu. */
export function drainPerSecond(inp: DrainInput, endurance: number): number {
  // joueur endurant (99) → ×0.80 ; fragile (20) → ×1.4
  const enduranceMul = 1.55 - (endurance / 99) * 0.75
  let drain = 0.0026 // base
  drain += Math.min(inp.speedRatio * inp.speedRatio, 1) * 0.014 // déplacement
  drain += PRESS_DRAIN[inp.pressing]
  drain += TEMPO_DRAIN[inp.tempo]
  if (inp.extraWork) drain += 0.009
  if (inp.extraWork && inp.intensityElevee) drain += 0.004
  drain *= enduranceMul
  if (inp.isGK) drain *= 0.35
  return Math.max(drain, 0)
}

export function updateStamina(
  lp: LivePlayer,
  dtSec: number,
  inp: Omit<DrainInput, 'isGK'>,
  endurance: number,
  isGK: boolean,
): number {
  const drain = drainPerSecond({ ...inp, isGK }, endurance) * dtSec
  lp.stamina = Math.max(0, lp.stamina - drain)
  return lp.stamina
}
