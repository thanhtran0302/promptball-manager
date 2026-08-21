// Libellés français des énumérations (affichage uniquement).

import type { MatchInstructions, PlayerInstructionType, TeamInstructions } from '../engine/types'

export const MENTALITY_LABELS: Record<string, string> = {
  tres_defensif: 'Très défensive',
  defensif: 'Défensive',
  equilibre: 'Équilibrée',
  offensif: 'Offensive',
  tres_offensif: 'Très offensive',
}

export const PRESSING_LABELS: Record<string, string> = { bas: 'Bas', moyen: 'Moyen', haut: 'Haut' }
export const TEMPO_LABELS: Record<string, string> = { lent: 'Lent', moyen: 'Moyen', rapide: 'Rapide' }
export const WIDTH_LABELS: Record<string, string> = { etroit: 'Étroit', normal: 'Normal', large: 'Large' }
export const LINE_LABELS: Record<string, string> = { basse: 'Basse', moyenne: 'Moyenne', haute: 'Haute' }

export const INSTRUCTION_LABELS: Record<PlayerInstructionType, string> = {
  overlap: 'Prendre le couloir',
  stay_back: 'Rester en position',
  cut_inside: 'Rentrer dans l’axe',
  man_mark: 'Marquage individuel',
  free_role: 'Liberté de mouvement',
  shoot_more: 'Tirer plus',
  short_passes: 'Jeu court',
  long_passes: 'Jeu long',
}

export const INSTRUCTION_HINTS: Record<PlayerInstructionType, string> = {
  overlap: 'Montées répétées dans le couloir — coûteux en endurance',
  stay_back: 'Ne participe pas aux attaques',
  cut_inside: 'Décale dans l’axe avec le ballon',
  man_mark: 'Colle à un adversaire précis',
  free_role: 'Se déplace librement vers le ballon',
  shoot_more: 'Tente davantage sa chance',
  short_passes: 'Privilégie les passes courtes',
  long_passes: 'Privilégie les longs ballons',
}

export function teamInstructionChips(ti: TeamInstructions): { label: string; value: string }[] {
  return [
    { label: 'Formation', value: ti.formation },
    { label: 'Mentalité', value: MENTALITY_LABELS[ti.mentality] },
    { label: 'Pressing', value: PRESSING_LABELS[ti.pressing] },
    { label: 'Tempo', value: TEMPO_LABELS[ti.tempo] },
    { label: 'Largeur', value: WIDTH_LABELS[ti.width] },
    { label: 'Ligne', value: LINE_LABELS[ti.defensiveLine] },
  ]
}

export function describeInstructions(instr: MatchInstructions, team: { players: { id: string; name: string }[] }, opponent?: { players: { id: string; name: string }[] }): string[] {
  const lines: string[] = []
  const nameOf = (id: string) => team.players.find((p) => p.id === id)?.name ?? id
  const oppNameOf = (id: string) => opponent?.players.find((p) => p.id === id)?.name ?? id
  for (const pi of instr.players) {
    let line = `${nameOf(pi.playerId)} : ${INSTRUCTION_LABELS[pi.instruction]}`
    if (pi.intensity === 'elevee') line += ' (intensité élevée)'
    if (pi.instruction === 'man_mark' && pi.targetPlayerId) line += ` sur ${oppNameOf(pi.targetPlayerId)}`
    lines.push(line)
  }
  for (const sub of instr.substitutions) {
    lines.push(`Remplacement : ${nameOf(sub.inPlayerId)} à la place de ${nameOf(sub.outPlayerId)}`)
  }
  return lines
}
