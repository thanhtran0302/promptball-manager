// Schéma zod des instructions + tables d'effets tactiques.
// C'est LE contrat unique : la couche LLM, l'éditeur manuel et le moteur
// produisent/consomment exactement ce JSON.

import { z } from 'zod'
import {
  DEF_LINES,
  FORMATIONS,
  MENTALITIES,
  PLAYER_INSTRUCTIONS,
  PRESSINGS,
  TEMPOS,
  WIDTHS,
  type MatchInstructions,
  type Team,
} from './types'

export { DEF_LINES, FORMATIONS, MENTALITIES, PLAYER_INSTRUCTIONS, PRESSINGS, TEMPOS, WIDTHS }

export const teamInstructionsSchema = z.object({
  formation: z.enum(FORMATIONS),
  mentality: z.enum(MENTALITIES),
  pressing: z.enum(PRESSINGS),
  tempo: z.enum(TEMPOS),
  width: z.enum(WIDTHS),
  defensiveLine: z.enum(DEF_LINES),
})

export const playerInstructionSchema = z.object({
  playerId: z.string(),
  instruction: z.enum(PLAYER_INSTRUCTIONS),
  targetPlayerId: z.string().optional(),
  intensity: z.enum(['normale', 'elevee']).optional(),
})

export const substitutionSchema = z.object({
  outPlayerId: z.string(),
  inPlayerId: z.string(),
})

export const matchInstructionsSchema = z.object({
  team: teamInstructionsSchema,
  players: z.array(playerInstructionSchema).max(11),
  substitutions: z.array(substitutionSchema).max(3),
  lineup: z.array(z.string()).length(11).optional(),
})

export function defaultInstructions(): MatchInstructions {
  return {
    team: {
      formation: '4-4-2',
      mentality: 'equilibre',
      pressing: 'moyen',
      tempo: 'moyen',
      width: 'normal',
      defensiveLine: 'moyenne',
    },
    players: [],
    substitutions: [],
  }
}

/** Valide sémantiquement (ids existants, cibles cohérentes, banc, etc.). */
export function validateInstructions(
  instr: MatchInstructions,
  team: Team,
  opponent: Team,
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const ids = new Set(team.players.map((p) => p.id))
  const oppIds = new Set(opponent.players.map((p) => p.id))
  const seen = new Set<string>()

  for (const pi of instr.players) {
    if (!ids.has(pi.playerId)) errors.push(`Joueur inconnu : ${pi.playerId}`)
    if (seen.has(pi.playerId)) errors.push(`Instructions multiples pour ${pi.playerId} (une seule par joueur)`)
    seen.add(pi.playerId)
    if (pi.instruction === 'man_mark') {
      if (!pi.targetPlayerId || !oppIds.has(pi.targetPlayerId))
        errors.push(`Marquage individuel : cible invalide (${pi.targetPlayerId ?? 'absente'})`)
    }
    const p = team.players.find((pl) => pl.id === pi.playerId)
    if (p && p.role === 'GK' && pi.instruction !== 'stay_back')
      errors.push(`Le gardien ne peut pas recevoir l'instruction ${pi.instruction}`)
  }

  if (instr.substitutions.length > 3) errors.push('Maximum 3 remplacements')
  for (const sub of instr.substitutions) {
    if (!ids.has(sub.outPlayerId) || !ids.has(sub.inPlayerId))
      errors.push(`Remplacement invalide : ids inconnus (${sub.outPlayerId} → ${sub.inPlayerId})`)
    if (sub.outPlayerId === sub.inPlayerId) errors.push('Remplacement : même joueur entrant/sortant')
  }

  if (instr.lineup) {
    if (instr.lineup.length !== 11) errors.push('La composition doit contenir exactement 11 joueurs.')
    if (new Set(instr.lineup).size !== instr.lineup.length) errors.push('Composition : un joueur apparaît deux fois.')
    for (const id of instr.lineup) {
      if (!ids.has(id)) errors.push(`Composition : joueur inconnu (${id})`)
    }
    const gk = team.players.find((p) => p.id === instr.lineup![0])
    if (instr.lineup.length > 0 && gk && gk.role !== 'GK')
      errors.push(`Le premier poste de la composition doit être le gardien (${gk.name} n'en est pas un).`)
  }
  return errors.length ? { ok: false, errors } : { ok: true }
}

// ---------------------------------------------------------------------------
// Tables d'effets consommées par la simulation
// ---------------------------------------------------------------------------

/** Décalage du bloc en attaque (espace équipe) */
export const MENTALITY_PUSH: Record<string, number> = {
  tres_defensif: -0.1,
  defensif: -0.05,
  equilibre: 0,
  offensif: 0.05,
  tres_offensif: 0.1,
}

/** Hauteur du bloc en défense (espace équipe) */
export const LINE_X: Record<string, number> = {
  basse: -0.07,
  moyenne: 0,
  haute: 0.07,
}

export const WIDTH_FACTOR: Record<string, number> = {
  etroit: 0.85,
  normal: 1,
  large: 1.15,
}

/** Multiplicateur de fréquence/agressivité des tacles et du pressing sur le porteur */
export const PRESS_FACTOR: Record<string, number> = {
  bas: 0.75,
  moyen: 1,
  haut: 1.5,
}

/** Multiplicateur de l'intervalle entre deux décisions du porteur */
export const TEMPO_DECISION: Record<string, number> = {
  lent: 1.35,
  moyen: 1,
  rapide: 0.72,
}

export const MENTALITY_LEVEL: Record<string, number> = {
  tres_defensif: 0,
  defensif: 1,
  equilibre: 2,
  offensif: 3,
  tres_offensif: 4,
}
