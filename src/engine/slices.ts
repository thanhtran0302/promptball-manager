// Micro-décisions par slice (façon FM) : chaque joueur de champ réévalue son
// comportement toutes les 0,3 s. Ce module calcule les poids de choix — les
// cibles de position restent calculées par le moteur (conversions d'espace),
// et le tirage se fait par la RNG du moteur pour rester déterministe.

import type {
  AttBehavior,
  DefBehavior,
  PlayerAttributes,
  PlayerInstruction,
  Role,
  TeamInstructions,
} from './types'

export interface AttackSliceInput {
  attrs: PlayerAttributes
  role: Role
  ti: TeamInstructions
  pi?: PlayerInstruction
  /** positions en espace équipe de l'ATTAQUANT (0 = propre but) */
  playerTx: number
  playerTy: number
  ballTx: number
  ballTy: number
  /** ligne de hors-jeu, en espace attaquant (plafond légal) */
  offsideLineTx: number
  /**
   * Appel en profondeur mal minuté : le coureur s'engage DEVANT la ligne au
   * lieu de partir de l'épaule du dernier défenseur. Tiré une fois par appel
   * par le moteur (mémoire d'épisode), pas à chaque slice — sinon le coureur
   * est rappelé derrière la ligne avant qu'une passe puisse lui parvenir.
   */
  runGamble: boolean
  /** phase lissée 0..1 : les courses offensives ne partent qu'une fois
   *  l'équipe installée en attaque (sinon contre-transitions dévastateurs) */
  phaseBlend: number
  minute: number
  /** score de cette équipe moins celui de l'adversaire */
  goalDiff: number
  stamina: number
}

export interface DefenseSliceInput {
  attrs: PlayerAttributes
  role: Role
  ti: TeamInstructions
  pi?: PlayerInstruction
  /** positions en espace équipe du DÉFENSEUR (0 = propre but) */
  playerTx: number
  playerTy: number
  ballTx: number
  ballTy: number
  /** 0/1 si ce joueur fait partie des deux plus proches du ballon */
  presserRank: number | undefined
  /** distance au plus proche attaquant adverse (m, Infinity si loin) */
  nearestAttackerDist: number
}

export interface Weighted<T> {
  behavior: T
  weight: number
}

/**
 * Appel bien minuté : on part de l'épaule du dernier défenseur, légèrement en
 * deçà de la ligne. Le moteur siffle au-delà de ligne + 0,03.
 */
const RUN_SHOULDER = 0.01

/**
 * Appel mal minuté : dépassement franc de la ligne, au-delà du seuil de
 * l'arbitre. Calibré au sim-bench sur la cible 1-3 hors-jeu par équipe et par
 * match — voir `runGamble`.
 */
const RUN_OVERRUN = 0.06

/** Qualité de décision : réduit les choix exotiques des joueurs limités. */
function decisionQuality(attrs: PlayerAttributes): number {
  return 0.7 + (attrs.decisions / 99) * 0.55
}

export function attackWeights(inp: AttackSliceInput): Weighted<AttBehavior>[] {
  const { attrs, role, ti, pi } = inp
  const out: Weighted<AttBehavior>[] = []
  const push = (behavior: AttBehavior, weight: number) => {
    if (weight > 0.05) out.push({ behavior, weight })
  }

  const widthRole = inp.playerTy < 0.35 || inp.playerTy > 0.65
  const ballInFinalThird = inp.ballTx > 0.7
  const ballInAttackHalf = inp.ballTx > 0.55
  const chasing = inp.goalDiff < 0 && inp.minute > 75
  const managing = inp.goalDiff > 0 && inp.minute > 80
  const tired = inp.stamina < 35
  const cautious =
    ti.mentality === 'tres_defensif' || ti.mentality === 'defensif'
  const bold = ti.mentality === 'offensif' || ti.mentality === 'tres_offensif'
  // les courses offensives urgentes montent en puissance avec la phase
  const runRamp = Math.max(0, Math.min(1, (inp.phaseBlend - 0.3) / 0.4))

  // défaut : la formule de positionnement (comportement neutre dominant)
  let holdW = 10
  if (pi?.instruction === 'free_role') holdW *= 0.45
  if (chasing) holdW *= 0.8
  if (managing) holdW *= 1.3 // on gère l'avantage : moins de courses
  push('hold_position', holdW)

  // appel dans le dos : attaquants surtout, ballon déjà dans le camp adverse
  let ribW = 0
  if (ballInAttackHalf && role !== 'DF') {
    ribW = role === 'AT' ? 2.2 : 0.7
    ribW *= 0.55 + (attrs.vision / 99) * 0.7
    if (ti.tempo === 'rapide') ribW *= 1.6
    if (bold) ribW *= 1.3
    if (cautious) ribW *= 0.55
    if (chasing) ribW *= 1.5
    if (tired) ribW *= 0.5
    if (pi?.instruction === 'free_role') ribW *= 1.4
    ribW *= runRamp
  }
  push('run_in_behind', ribW)

  // offering une solution proche
  let csW = role === 'MD' ? 2.4 : role === 'AT' ? 1.6 : 0.9
  csW *= 0.6 + (attrs.vision / 99) * 0.6
  if (ti.tempo === 'lent') csW *= 1.5
  if (ti.tempo === 'rapide') csW *= 0.7
  if (tired) csW *= 1.4 // on garde le ballon quand les jambes suivent moins
  push('come_short', csW)

  // conserver la largeur (ailiers / latéraux dans le couloir)
  if (widthRole && role !== 'DF') {
    let hwW = 1.6
    if (ti.width === 'large') hwW *= 1.8
    if (ti.width === 'etroit') hwW *= 0.4
    if (pi?.instruction === 'cut_inside') hwW *= 0.2
    push('hold_width', hwW)
  }

  // piston : latéraux quand le ballon est haut
  if (role === 'DF' && ballInFinalThird) {
    let ovW = 1.2
    if (pi?.instruction === 'overlap') ovW *= 5
    if (bold) ovW *= 1.5
    if (cautious) ovW *= 0.4
    if (tired) ovW *= 0.4
    push('overlap_run', ovW * runRamp)
  }

  // entrée dans la surface quand le porteur est large et haut
  if (ballInFinalThird && (role === 'AT' || role === 'MD')) {
    let abW = 1.2
    if (chasing) abW *= 1.8
    if (ti.mentality === 'tres_offensif') abW *= 1.4
    if (cautious) abW *= 0.5
    if (tired) abW *= 0.6
    push('attack_box', abW * runRamp)
  }

  if (pi?.instruction === 'stay_back') {
    // consigne défensive : interdit les comportements offensifs
    return out
      .filter((w) => w.behavior === 'hold_position' || w.behavior === 'come_short')
      .map((w) => (w.behavior === 'come_short' ? { ...w, weight: w.weight * 0.5 } : w))
  }

  // la qualité de décision module les choix exotiques
  const q = decisionQuality(attrs)
  return out.map((w) => (w.behavior === 'hold_position' ? w : { ...w, weight: w.weight * q }))
}

export function defenseWeights(inp: DefenseSliceInput): Weighted<DefBehavior>[] {
  const { attrs, role, ti, pi } = inp
  const out: Weighted<DefBehavior>[] = []
  const push = (behavior: DefBehavior, weight: number) => {
    if (weight > 0.05) out.push({ behavior, weight })
  }

  push('hold_shape', 10)

  // près de son but, tout le monde défense : les comportements s'urgent
  const nearOwnGoal = inp.ballTx < 0.25

  // fermer sur le porteur : surtout les deux (ou trois) plus proches du ballon
  let cdW = 0.35
  if (inp.presserRank === 0) cdW = 3.2
  else if (inp.presserRank === 1) cdW = 1.2
  else if (inp.presserRank === 2) cdW = 0.6
  cdW *= 0.7 + (attrs.aggression / 99) * 0.6
  if (ti.pressing === 'haut') cdW *= 1.7
  if (ti.pressing === 'bas') cdW *= 0.55
  if (nearOwnGoal) cdW *= 1.5 // on saute sur le porteur dans sa surface
  if (pi?.instruction === 'man_mark') cdW *= 0.8 // il a déjà un marquage
  push('close_down', cdW)

  // couper une ligne de passe : les milieux lisents
  let ilW = role === 'MD' ? 1.3 : 0.7
  ilW *= 0.55 + (attrs.vision / 99) * 0.7
  ilW *= 0.6 + (attrs.decisions / 99) * 0.6
  if (ti.pressing === 'haut') ilW *= 1.3
  push('intercept_lane', ilW)

  // couvrir derrière le presseur
  let covW = 0.8
  if (inp.presserRank === 1 && role === 'DF') covW = 1.8
  if (role === 'DF') covW *= 1.3
  push('cover', covW)

  // marquage de l'attaquant proche
  if (inp.nearestAttackerDist < (nearOwnGoal ? 16 : 12)) {
    let mmW = role === 'DF' ? 2.2 : 1
    if (pi?.instruction === 'man_mark') mmW *= 3.5
    mmW *= 0.6 + (attrs.decisions / 99) * 0.6
    if (nearOwnGoal) mmW *= 1.8 // dans la surface, on colle son attaquant
    push('mark_man', mmW)
  }

  return out
}

/**
 * Cible (espace équipe) du comportement offensif choisi.
 * `baseTx/baseTy` = cible de la formule de positionnement (hold_position).
 */
export function attackTarget(
  behavior: AttBehavior,
  inp: AttackSliceInput,
  baseTx: number,
  baseTy: number,
): { tx: number; ty: number } {
  // Timing de l'appel en profondeur : l'appel bien minuté part de l'épaule du
  // dernier défenseur, l'appel manqué s'engage au-delà de la ligne. Le
  // dépassement est ADDITIF — un facteur multiplicatif < 1 (ancienne version)
  // ramenait tout appel en deçà de la ligne, rendant le hors-jeu
  // géométriquement inatteignable.
  const runTx = inp.runGamble
    ? inp.offsideLineTx + RUN_OVERRUN
    : inp.offsideLineTx - RUN_SHOULDER
  switch (behavior) {
    case 'hold_position':
      return { tx: baseTx, ty: baseTy }
    case 'run_in_behind':
      return {
        tx: Math.min(runTx, 0.93),
        ty: 0.5 + (inp.playerTy - 0.5) * 0.75,
      }
    case 'come_short':
      return {
        tx: Math.max(baseTx - 0.09, 0.18),
        ty: inp.playerTy * 0.6 + inp.ballTy * 0.4,
      }
    case 'hold_width':
      return {
        tx: baseTx,
        ty: inp.playerTy < 0.5 ? 0.06 : 0.94,
      }
    case 'overlap_run':
      return {
        tx: Math.min(inp.ballTx + 0.14, 0.9),
        ty: inp.playerTy < 0.5 ? 0.1 : 0.9,
      }
    case 'attack_box':
      return {
        tx: 0.86,
        ty: inp.playerTy < 0.5 ? 0.42 : 0.58,
      }
  }
}

/** Cible (espace équipe) du comportement défensif choisi. */
export function defenseTarget(
  behavior: DefBehavior,
  inp: DefenseSliceInput,
  baseTx: number,
  baseTy: number,
  /** position du plus proche attaquant adverse (espace défenseur) */
  nearestAttacker: { tx: number; ty: number } | null,
): { tx: number; ty: number } {
  switch (behavior) {
    case 'hold_shape':
      return { tx: baseTx, ty: baseTy }
    case 'close_down':
      // goal-side du ballon, à 1,5 m
      return {
        tx: inp.ballTx * 0.92,
        ty: inp.ballTy * 0.9 + 0.05 * (0.5 - inp.ballTy),
      }
    case 'intercept_lane': {
      if (!nearestAttacker) return { tx: baseTx, ty: baseTy }
      return {
        tx: (inp.ballTx + nearestAttacker.tx) / 2,
        ty: (inp.ballTy + nearestAttacker.ty) / 2,
      }
    }
    case 'cover':
      return {
        tx: Math.max(baseTx - 0.05, 0.05),
        ty: baseTy * 0.7 + inp.ballTy * 0.3,
      }
    case 'mark_man': {
      if (!nearestAttacker) return { tx: baseTx, ty: baseTy }
      // goal-side de l'attaquant marqué
      return {
        tx: nearestAttacker.tx - 0.012,
        ty: nearestAttacker.ty,
      }
    }
  }
}
