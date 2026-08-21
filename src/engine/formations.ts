// Positions de base par formation, en espace "équipe" :
// x : 0 = propre but, 1 = but adverse ; y : 0 = couloir gauche, 1 = couloir droit.

import type { Formation, Player, Role, Team } from './types'

export interface Slot {
  x: number
  y: number
  role: Role
  label: string
}

export const FORMATION_SLOTS: Record<Formation, Slot[]> = {
  '4-4-2': [
    { x: 0.04, y: 0.5, role: 'GK', label: 'G' },
    { x: 0.18, y: 0.16, role: 'DF', label: 'DG' },
    { x: 0.15, y: 0.38, role: 'DF', label: 'DC' },
    { x: 0.15, y: 0.62, role: 'DF', label: 'DC' },
    { x: 0.18, y: 0.84, role: 'DF', label: 'DD' },
    { x: 0.45, y: 0.14, role: 'MD', label: 'MG' },
    { x: 0.40, y: 0.38, role: 'MD', label: 'MC' },
    { x: 0.40, y: 0.62, role: 'MD', label: 'MC' },
    { x: 0.45, y: 0.86, role: 'MD', label: 'MD' },
    { x: 0.68, y: 0.40, role: 'AT', label: 'BU' },
    { x: 0.68, y: 0.60, role: 'AT', label: 'BU' },
  ],
  '4-3-3': [
    { x: 0.04, y: 0.5, role: 'GK', label: 'G' },
    { x: 0.18, y: 0.16, role: 'DF', label: 'DG' },
    { x: 0.15, y: 0.38, role: 'DF', label: 'DC' },
    { x: 0.15, y: 0.62, role: 'DF', label: 'DC' },
    { x: 0.18, y: 0.84, role: 'DF', label: 'DD' },
    { x: 0.40, y: 0.3, role: 'MD', label: 'MC' },
    { x: 0.36, y: 0.5, role: 'MD', label: 'MDC' },
    { x: 0.40, y: 0.7, role: 'MD', label: 'MC' },
    { x: 0.62, y: 0.15, role: 'AT', label: 'AG' },
    { x: 0.66, y: 0.5, role: 'AT', label: 'BU' },
    { x: 0.62, y: 0.85, role: 'AT', label: 'AD' },
  ],
  '4-2-3-1': [
    { x: 0.04, y: 0.5, role: 'GK', label: 'G' },
    { x: 0.18, y: 0.16, role: 'DF', label: 'DG' },
    { x: 0.15, y: 0.38, role: 'DF', label: 'DC' },
    { x: 0.15, y: 0.62, role: 'DF', label: 'DC' },
    { x: 0.18, y: 0.84, role: 'DF', label: 'DD' },
    { x: 0.36, y: 0.38, role: 'MD', label: 'MDC' },
    { x: 0.36, y: 0.62, role: 'MD', label: 'MDC' },
    { x: 0.55, y: 0.18, role: 'MD', label: 'MG' },
    { x: 0.55, y: 0.5, role: 'MD', label: 'MC' },
    { x: 0.55, y: 0.82, role: 'MD', label: 'MD' },
    { x: 0.68, y: 0.5, role: 'AT', label: 'BU' },
  ],
  '3-5-2': [
    { x: 0.04, y: 0.5, role: 'GK', label: 'G' },
    { x: 0.16, y: 0.3, role: 'DF', label: 'DC' },
    { x: 0.14, y: 0.5, role: 'DF', label: 'DC' },
    { x: 0.16, y: 0.7, role: 'DF', label: 'DC' },
    { x: 0.42, y: 0.08, role: 'MD', label: 'MG' },
    { x: 0.38, y: 0.32, role: 'MD', label: 'MC' },
    { x: 0.36, y: 0.5, role: 'MD', label: 'MDC' },
    { x: 0.38, y: 0.68, role: 'MD', label: 'MC' },
    { x: 0.42, y: 0.92, role: 'MD', label: 'MD' },
    { x: 0.66, y: 0.42, role: 'AT', label: 'BU' },
    { x: 0.66, y: 0.58, role: 'AT', label: 'BU' },
  ],
  '5-3-2': [
    { x: 0.04, y: 0.5, role: 'GK', label: 'G' },
    { x: 0.20, y: 0.08, role: 'DF', label: 'DG' },
    { x: 0.16, y: 0.3, role: 'DF', label: 'DC' },
    { x: 0.14, y: 0.5, role: 'DF', label: 'DC' },
    { x: 0.16, y: 0.7, role: 'DF', label: 'DC' },
    { x: 0.20, y: 0.92, role: 'DF', label: 'DD' },
    { x: 0.40, y: 0.3, role: 'MD', label: 'MC' },
    { x: 0.36, y: 0.5, role: 'MD', label: 'MDC' },
    { x: 0.40, y: 0.7, role: 'MD', label: 'MC' },
    { x: 0.64, y: 0.42, role: 'AT', label: 'BU' },
    { x: 0.64, y: 0.58, role: 'AT', label: 'BU' },
  ],
}

const ROLE_AFFINITY: Record<Role, Partial<Record<Role, number>>> = {
  GK: { GK: 1, DF: 0.01, MD: 0.01, AT: 0.01 },
  DF: { DF: 1, MD: 0.55, AT: 0.1, GK: 0 },
  MD: { MD: 1, AT: 0.55, DF: 0.55, GK: 0 },
  AT: { AT: 1, MD: 0.55, DF: 0.1, GK: 0 },
}

/**
 * Assigne les 11 joueurs aux slots de la formation, en respectant au mieux
 * les rôles naturels. Déterministe (ordre de la liste en cas d'égalité).
 */
export function assignSlots(available: Player[], formation: Formation): string[] {
  const slots = FORMATION_SLOTS[formation]
  const pool = [...available]
  const result: string[] = []
  for (const slot of slots) {
    let bestIdx = 0
    let bestScore = -Infinity
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i]
      const affinity = ROLE_AFFINITY[slot.role][p.role] ?? 0
      // léger bonus d'attribut pour départager
      const attr =
        p.role === 'GK' ? p.attributes.goalkeeper : p.attributes.technique + p.attributes.pace
      const score = affinity * 1000 + attr
      if (score > bestScore) {
        bestScore = score
        bestIdx = i
      }
    }
    const [chosen] = pool.splice(bestIdx, 1)
    result.push(chosen.id)
  }
  return result
}

/**
 * Recompose la ligne de titulaires pour une nouvelle formation en conservant
 * les 11 joueurs (réassignation des postes au plus proche de leur rôle).
 */
export function relineupForFormation(lineupIds: string[], team: Team, formation: Formation): string[] {
  const players = lineupIds
    .map((id) => team.players.find((p) => p.id === id))
    .filter((p): p is Player => Boolean(p))
  if (players.length !== 11) return assignSlots(team.players, formation)
  return assignSlots(players, formation)
}
