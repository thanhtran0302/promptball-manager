// Coach automatique : remplacements d'un côté non piloté par un humain.
//
// Sans lui, l'IA ne remplaçait jamais personne — zéro changement sur vingt
// matchs de sim-bench — et finissait à ~60 de fraîcheur pendant que le joueur
// humain faisait tourner. Le déséquilibre fausse autant le match que la
// calibration : distance parcourue et taux de sprint sont des métriques
// contraintes du bench.

import type { MatchEngine } from './sim'
import { TICK_SEC, isBreak, type Side } from './types'

/**
 * Usure minimale, en points de fraîcheur perdus, pour qu'une sortie vaille le
 * coup. Séparer ce seuil de la sélection est le point clé : la sélection est un
 * rang (les plus émoussés du onze), le déclenchement une usure absolue. Un seuil
 * exprimé en écart avec le plus frais dépendrait de la dispersion de l'effectif
 * — mesuré, 5,2 points chez une équipe technique contre 3,3 chez une équipe
 * homogène, qui ne remplacerait alors jamais personne.
 * Repères mesurés : ~14 points perdus à la mi-temps, ~21 à la 60e, ~26 à la 75e.
 */
const WORN_DROP = 18
/**
 * Pauses (mi-temps et les deux coupures de la prolongation) : exigence
 * volontairement plus dure. À 25, le rendez-vous ne mord qu'après une période
 * réellement coûteuse (pressing haut, intensité élevée), et reste sans effet
 * dans un match ordinaire.
 */
const HALFTIME_WORN_DROP = 25
/** Changements par fenêtre : au-delà, un coach désorganise plus qu'il ne soulage. */
const MAX_PER_WINDOW = 2
/**
 * Minutes où le coach ouvre une fenêtre. Les pauses s'y ajoutent, gratuitement.
 * 105 est le rendez-vous de la prolongation : la boucle ne retient que le
 * dernier seuil franchi, et m60/m75 sont déjà consommés quand on y arrive.
 */
const TRIGGER_MINUTES = [60, 75, 105]

/**
 * Déclenche au plus une fenêtre par point de rendez-vous. `done` porte les
 * déclencheurs déjà consommés (`home:halftime`, `away:m60`…) et vit dans le moteur :
 * la fonction est appelée à chaque tick et doit être sans effet le reste du temps.
 */
export function runAutoSub(engine: MatchEngine, side: Side, done: Set<string>): void {
  const st = engine.state

  let trigger: string | null = null
  // la phase EST la clé : une constante commune aux trois pauses ferait
  // consommer par la mi-temps le rendez-vous des deux coupures de prolongation
  if (isBreak(st.phase)) trigger = st.phase
  else if (st.phase !== 'finished') {
    const minute = Math.floor((st.tick * TICK_SEC) / 60)
    for (const m of TRIGGER_MINUTES) if (minute >= m) trigger = `m${m}`
  }
  if (!trigger) return

  const key = `${side}:${trigger}`
  if (done.has(key)) return
  done.add(key)

  if (!engine.canSub(side)) return

  const tms = st[side]
  const byId = new Map(tms.team.players.map((p) => [p.id, p]))

  // test sur la phase et non sur `trigger` : la clé porte désormais le nom de
  // la pause, un `trigger === 'ht'` basculerait silencieusement sur WORN_DROP
  const drop = isBreak(st.phase) ? HALFTIME_WORN_DROP : WORN_DROP
  const tired = tms.lineup
    .filter((id) => {
      const lp = st.players[id]
      return lp?.onPitch && byId.get(id)?.role !== 'GK' && lp.stamina <= 100 - drop
    })
    .sort((a, b) => st.players[a].stamina - st.players[b].stamina)

  let made = 0
  for (const outId of tired) {
    if (made >= MAX_PER_WINDOW || !engine.canSub(side)) break
    const inId = pickReplacement(engine, side, outId)
    if (!inId) break
    if (!engine.makeSub(side, outId, inId).ok) break
    made++
  }
}

/**
 * Remplaçant retenu pour un sortant donné : doublure au poste si elle existe,
 * sinon le meilleur restant. Laisser un poste vacant coûte plus cher qu'un
 * poste approximatif.
 */
export function pickReplacement(engine: MatchEngine, side: Side, outId: string): string | null {
  const st = engine.state
  const tms = st[side]
  const outRole = tms.team.players.find((p) => p.id === outId)?.role
  const outIsGK = outRole === 'GK'
  // ponytail: le banc est pris dans l'ordre de l'effectif, qui est déjà trié
  // par niveau dans les données. Un vrai choix (note × fraîcheur × poste)
  // demanderait un modèle d'évaluation ; à ajouter si le bench montre des
  // entrées absurdes.
  const pool = tms.team.players.filter((p) => {
    const lp = st.players[p.id]
    // un gardien sortant ne peut être remplacé que par un gardien ; sinon, le
    // gardien du banc est hors-pool comme avant — jamais un joueur de champ
    // entre en but faute de doublure au bon poste.
    return (
      lp &&
      !lp.onPitch &&
      !lp.sentOff &&
      !lp.subbedOff &&
      lp.injury === 'none' &&
      (outIsGK ? p.role === 'GK' : p.role !== 'GK')
    )
  })
  if (pool.length === 0) return null
  return (pool.find((p) => p.role === outRole) ?? pool[0]).id
}
