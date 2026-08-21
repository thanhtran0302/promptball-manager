// Traducteur simulé (sans appel réseau) : parse des mots-clés français
// courants. Sert au mode démo et de fallback si l'API est indisponible.

import { defaultInstructions } from '../engine/instructions'
import { assignSlots } from '../engine/formations'
import type {
  Formation,
  MatchInstructions,
  PlayerInstruction,
  PlayerInstructionType,
  Team,
} from '../engine/types'

const FORMATIONS: Formation[] = ['4-4-2', '4-3-3', '4-2-3-1', '3-5-2', '5-3-2']

function findByName(team: Team, fragment: string): Team['players'][number] | undefined {
  return team.players.find((p) => {
    const n = normalize(p.name)
    return n.includes(fragment) || fragment.includes(n.split(' ').slice(-1)[0])
  })
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

export function mockTranslate(
  prompt: string,
  team: Team,
  opponent: Team,
  current: MatchInstructions,
): MatchInstructions {
  const text = normalize(prompt)
  const instr: MatchInstructions = structuredClone(current)

  const formation = FORMATIONS.find((f) => text.replace(/\s/g, '').includes(f))
  if (formation) instr.team.formation = formation

  if (/(tres|très|ultra)?\s*defensi|prudent|ferme|verrou|bus|muraille/.test(text)) {
    instr.team.mentality = text.includes('tres') || text.includes('ultra') ? 'tres_defensif' : 'defensif'
  }
  if (/offensi|attaqu|audac|tout pour (la )?gagn|allons-y|propuls/.test(text)) {
    instr.team.mentality = /tres|ultra|folie|tout/.test(text) ? 'tres_offensif' : 'offensif'
  }
  if (/equilibre|neutre|equilibre/.test(text)) instr.team.mentality = 'equilibre'

  if (/pressing (haut|tout)|haut et intense|etrangle|harcele/.test(text)) instr.team.pressing = 'haut'
  if (/pressing (bas|replie)|bloc bas|repli defensif|laisser venir/.test(text)) instr.team.pressing = 'bas'
  if (/pressing (moyen|normal)/.test(text)) instr.team.pressing = 'moyen'

  if (/tempo (rapide|eleve)|jeu rapide|direct|vertica|transitions rapides|contre-?attaque/.test(text)) instr.team.tempo = 'rapide'
  if (/tempo (lent)|possession|patience|construire|tiki|jeu court/.test(text)) instr.team.tempo = 'lent'

  if (/tres large|calez sur les ailes|large|occupez les cotes|etirez/.test(text)) instr.team.width = 'large'
  if (/etroit|serr(e|é)|axe|dans l'axe|centre du terrain/.test(text)) instr.team.width = 'etroit'

  if (/ligne (tres )?haute|defense avancee|hors-?jeu/.test(text)) instr.team.defensiveLine = 'haute'
  if (/ligne (tres )?basse|bloc recule|defense reculee/.test(text)) instr.team.defensiveLine = 'basse'

  // instructions individuelles par nom de joueur, analysées sur la phrase
  // qui mentionne le joueur (et non tout le prompt)
  const players: PlayerInstruction[] = []
  const segments = text.split(/[.,;!?]/)
  for (const p of team.players) {
    const name = normalize(p.name)
    const first = name.split(' ')[0]
    const last = name.split(' ').slice(-1)[0]
    const seg = segments.find(
      (s) => s.includes(last) || (s.includes(first) && first.length > 3),
    )
    if (!seg) continue
    let instruction: PlayerInstructionType | null = null
    let intensity: PlayerInstruction['intensity']
    if (/couloir|monte|montee|depasse|overflow|overlap|cote|aile|piston/.test(seg)) {
      instruction = 'overlap'
      intensity = /chaque|toujours|eleve|sans arret|foncez/.test(seg) ? 'elevee' : 'normale'
    } else if (/reste en (position|defense)|ne monte|restez derriere|couverture|securite/.test(seg)) {
      instruction = 'stay_back'
    } else if (/rentre|interieur|inverse|vers l'axe|dans l'axe|dribble/.test(seg)) {
      instruction = 'cut_inside'
    } else if (/liberte|libre|nomade|roaming/.test(seg)) {
      instruction = 'free_role'
    } else if (/tire|frappe|finis|conclusion|shot/.test(seg)) {
      instruction = 'shoot_more'
    } else if (/passes? (courtes?|jeu court)/.test(seg)) {
      instruction = 'short_passes'
    } else if (/passes? longues?|degage|longs ballons|balloons/.test(seg)) {
      instruction = 'long_passes'
    } else if (/marqu|serre|colle|prends .+ (pour|contre)|arrete/.test(seg)) {
      instruction = 'man_mark'
    }

    if (instruction) {
      const pi: PlayerInstruction = { playerId: p.id, instruction }
      if (intensity) pi.intensity = intensity
      if (instruction === 'man_mark') {
        // cherche un nom adverse dans le prompt
        for (const opp of opponent.players) {
          const olast = normalize(opp.name).split(' ').slice(-1)[0]
          if (text.includes(olast)) {
            pi.targetPlayerId = opp.id
            break
          }
        }
        if (!pi.targetPlayerId) {
          // cible par défaut : le meilleur attaquant adverse
          const best = [...opponent.players]
            .filter((o) => o.role === 'AT')
            .sort((a, b) => b.attributes.shooting - a.attributes.shooting)[0]
          pi.targetPlayerId = best?.id
        }
      }
      players.push(pi)
    }
  }
  if (players.length) instr.players = players

  // remplacements : « remplace X par Y »
  const subs: MatchInstructions['substitutions'] = []
  const subRe = /remplace\s+([a-z-]+)\s+par\s+([a-z-]+)/g
  let m: RegExpExecArray | null
  while ((m = subRe.exec(text))) {
    const out = team.players.find((p) => normalize(p.name).includes(m![1]) || m![1].includes(normalize(p.name).split(' ').slice(-1)[0]))
    const inc = team.players.find((p) => normalize(p.name).includes(m![2]) || m![2].includes(normalize(p.name).split(' ').slice(-1)[0]))
    if (out && inc) subs.push({ outPlayerId: out.id, inPlayerId: inc.id })
  }
  instr.substitutions = subs

  // composition : « fais jouer X à la place de Y » / « X titulaire à la place de Y »
  const swapRe = /(?:fais jouer|aligne|titularise|mets)\s+([a-z-]+)\s+(?:a|à) la place (?:de|du|d')\s+([a-z-]+)/g
  let changedLineup = false
  while ((m = swapRe.exec(text))) {
    const inc = findByName(team, m[1])
    const out = findByName(team, m[2])
    if (inc && out) {
      if (!instr.lineup) instr.lineup = assignSlots(team.players, instr.team.formation)
      const idx = instr.lineup.indexOf(out.id)
      if (idx >= 0) {
        instr.lineup[idx] = inc.id
        changedLineup = true
      }
    }
  }
  // si la formation change sans compo explicite, on reconvertit les titulaires actuels
  if (formation && !changedLineup && instr.lineup) {
    const current = instr.lineup
      .map((id) => team.players.find((p) => p.id === id))
      .filter((p): p is Team['players'][number] => Boolean(p))
    if (current.length === 11) instr.lineup = assignSlots(current, instr.team.formation)
  }

  return instr
}

export function mockDefault(): MatchInstructions {
  return defaultInstructions()
}
