// Coach local (sans LLM) : analyse déterministe des instructions et
// avertissements sur l'adéquation joueurs/instructions. Sert de filet de
// sécurité quand le LLM ne répond pas, et de note de coach en mode démo.

import type { MatchInstructions, Team } from '../engine/types'

export function analyzeInstructions(team: Team, opponent: Team, instr: MatchInstructions): string[] {
  const warnings: string[] = []
  const byId = new Map(team.players.map((p) => [p.id, p]))
  const oppById = new Map(opponent.players.map((p) => [p.id, p]))

  for (const pi of instr.players) {
    const p = byId.get(pi.playerId)
    if (!p) continue
    const a = p.attributes
    if (pi.instruction === 'overlap' && a.stamina < 65) {
      warnings.push(
        `${p.name} a une endurance de ${a.stamina} : sur des montées répétées, il ne tiendra pas 90 minutes. Prévois un remplacement ou une intensité normale.`,
      )
    }
    if (pi.instruction === 'overlap' && a.pace < 65) {
      warnings.push(`${p.name} (${a.pace} de vitesse) est un peu lent pour un rôle de piston — il laissera des espaces dans son dos.`)
    }
    if (pi.instruction === 'shoot_more' && a.shooting < 60) {
      warnings.push(`${p.name} n'a que ${a.shooting} en tir : lui demander de tirer davantage risque de gâcher des ballons.`)
    }
    if (pi.instruction === 'cut_inside' && a.technique < 60) {
      warnings.push(`${p.name} manque de technique (${a.technique}) pour rentrer dans l'axe avec le ballon.`)
    }
    if (pi.instruction === 'man_mark' && pi.targetPlayerId) {
      const t = oppById.get(pi.targetPlayerId)
      if (t && t.attributes.pace > a.pace + 10) {
        warnings.push(`${p.name} devra marquer ${t.name}, plus rapide que lui (${t.attributes.pace} vs ${a.pace}) — attention dans les transitions.`)
      }
    }
  }

  const starters = team.players.slice(0, 11).filter((p) => p.role !== 'GK')
  const avgStamina = Math.round(starters.reduce((s, p) => s + p.attributes.stamina, 0) / starters.length)
  if (instr.team.pressing === 'haut' && avgStamina < 70) {
    warnings.push(`Pressing haut avec une équipe à ${avgStamina} d'endurance moyenne : attendez-vous à une équipe morte après l'heure de jeu.`)
  }
  if (instr.team.tempo === 'rapide' && instr.team.pressing === 'haut') {
    warnings.push('Tempo rapide + pressing haut : très exigeant physiquement — surveillez les barres d\'endurance et pensez aux remplacements à la mi-temps.')
  }
  return warnings.slice(0, 4)
}

export function coachNoteFromWarnings(warnings: string[]): string {
  if (!warnings.length) return 'Instructions enregistrées. Rien à signaler côté physique — bon plan de départ.'
  return warnings.join(' ')
}
