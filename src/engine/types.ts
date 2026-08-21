// Types de base du moteur — aucun import DOM, moteur 100% déterministe.

export type Side = 'home' | 'away'
export type Role = 'GK' | 'DF' | 'MD' | 'AT'

/** Attributs 1-99, façon carte FIFA. */
export interface PlayerAttributes {
  /** Vitesse de pointe (m/s dérivés : 4.8 + pace/99*3.8) */
  pace: number
  /** Endurance : taille du "réservoir" et vitesse de drainage */
  stamina: number
  /** Contrôle de balle, dribble, précision des gestes */
  technique: number
  /** Précision des passes */
  passing: number
  /** Finition */
  shooting: number
  /** Capacité défensive (tacles, interceptions) */
  tackling: number
  /** Vivacité : réactions, agilité sous pression */
  agility: number
  /** Gardien : arrêts (seulement pertinent pour le GK) */
  goalkeeper: number
}

export interface Player {
  id: string
  name: string
  role: Role
  /** Poste naturel : G, DC, DG, DD, MDC, MC, MG, MD, AG, AD, BU */
  position: string
  attributes: PlayerAttributes
}

export interface Team {
  id: string
  name: string
  short: string
  color: string
  colorAlt: string
  /** 16 joueurs : ordre = ordre de priorité pour la compo (GK d'abord) */
  players: Player[]
}

// ---------------------------------------------------------------------------
// Instructions (le contrat unique entre LLM, éditeur manuel et moteur)
// ---------------------------------------------------------------------------

export const FORMATIONS = ['4-4-2', '4-3-3', '4-2-3-1', '3-5-2', '5-3-2'] as const
export type Formation = (typeof FORMATIONS)[number]

export const MENTALITIES = ['tres_defensif', 'defensif', 'equilibre', 'offensif', 'tres_offensif'] as const
export type Mentality = (typeof MENTALITIES)[number]

export const PRESSINGS = ['bas', 'moyen', 'haut'] as const
export type Pressing = (typeof PRESSINGS)[number]

export const TEMPOS = ['lent', 'moyen', 'rapide'] as const
export type Tempo = (typeof TEMPOS)[number]

export const WIDTHS = ['etroit', 'normal', 'large'] as const
export type Width = (typeof WIDTHS)[number]

export const DEF_LINES = ['basse', 'moyenne', 'haute'] as const
export type DefLine = (typeof DEF_LINES)[number]

export const PLAYER_INSTRUCTIONS = [
  'overlap',
  'stay_back',
  'cut_inside',
  'man_mark',
  'free_role',
  'shoot_more',
  'short_passes',
  'long_passes',
] as const
export type PlayerInstructionType = (typeof PLAYER_INSTRUCTIONS)[number]

export interface TeamInstructions {
  formation: Formation
  mentality: Mentality
  pressing: Pressing
  tempo: Tempo
  width: Width
  defensiveLine: DefLine
}

export interface PlayerInstruction {
  playerId: string
  instruction: PlayerInstructionType
  /** Cible du marquage individuel (id d'un joueur ADVERSE) */
  targetPlayerId?: string
  /** Élevée = engagement physique plus fort, drain d'endurance accru */
  intensity?: 'normale' | 'elevee'
}

export interface Substitution {
  outPlayerId: string
  inPlayerId: string
}

export interface MatchInstructions {
  team: TeamInstructions
  players: PlayerInstruction[]
  substitutions: Substitution[]
  /**
   * Composition titulaire : 11 ids dans l'ordre des postes de la formation
   * (gardien d'abord, puis défenseurs de gauche à droite, milieux, attaquants).
   * Optionnel : sans ce champ, le moteur choisit automatiquement.
   */
  lineup?: string[]
}

// ---------------------------------------------------------------------------
// État live du match
// ---------------------------------------------------------------------------

export interface PlayerStats {
  touches: number
  passes: number
  passesOk: number
  shots: number
  goals: number
  assists: number
  tackles: number
  interceptions: number
  fouls: number
  saves: number
  /** Distance parcourue en mètres */
  distance: number
  rating: number
}

export interface LivePlayer {
  id: string
  side: Side
  onPitch: boolean
  /** Position en mètres, repère terrain : home attaque vers x=105 */
  x: number
  y: number
  /** Position au tick précédent, pour l'interpolation du rendu */
  prevX: number
  prevY: number
  /** 100 → fraîcheur maximale */
  stamina: number
  stats: PlayerStats
  warned40: boolean
  warned20: boolean
}

export interface BallTransit {
  fromX: number
  fromY: number
  toX: number
  toY: number
  startTick: number
  endTick: number
  kind: 'pass' | 'shot' | 'clearance'
  intendedReceiverId?: string
  /** Résolu au moment de la frappe, révélé à l'arrivée */
  success: boolean
  shotOutcome?: 'goal' | 'save' | 'off_target' | 'blocked'
  shooterId?: string
  assistCandidateId?: string
  /** Passe vers un récepteur hors-jeu : coup franc à la défense à l'arrivée */
  offside?: boolean
}

export interface BallState {
  x: number
  y: number
  prevX: number
  prevY: number
  carrierId: string | null
  transit: BallTransit | null
}

export type MatchEventType =
  | 'kickoff'
  | 'goal'
  | 'shot'
  | 'save'
  | 'off_target'
  | 'tackle'
  | 'interception'
  | 'foul'
  | 'yellow_card'
  | 'corner'
  | 'goal_kick'
  | 'offside'
  | 'stamina_low'
  | 'sub'
  | 'halftime'
  | 'fulltime'
  | 'info'

export interface MatchEvent {
  tick: number
  minute: number
  type: MatchEventType
  side?: Side
  playerId?: string
  message: string
  /** position de l'action, pour l'annotation visuelle sur le terrain */
  x?: number
  y?: number
}

export interface TeamMatchStats {
  shots: number
  shotsOnTarget: number
  possessionTicks: number
  corners: number
  fouls: number
  yellowCards: number
  offsides: number
  passes: number
  passesOk: number
}

export interface TeamMatchState {
  side: Side
  team: Team
  instructions: MatchInstructions
  /** 11 ids sur le terrain, index = slot de formation */
  lineup: string[]
  subsUsed: number
  stats: TeamMatchStats
}

export type MatchPhase = 'first_half' | 'halftime' | 'second_half' | 'finished'

export interface MatchState {
  tick: number
  phase: MatchPhase
  /** Temps additionnel 2e mi-temps en secondes de jeu */
  addedTimeSec: number
  score: Record<Side, number>
  ball: BallState
  players: Record<string, LivePlayer>
  home: TeamMatchState
  away: TeamMatchState
  /** Dernier camp en possession (pour les stats quand la balle est en l'air) */
  possession: Side | null
  events: MatchEvent[]
  seed: number
}

export const PITCH = {
  /** longueur en mètres */
  L: 105,
  /** largeur en mètres */
  W: 68,
}

/** 1 tick = 0,1 s de temps de jeu */
export const TICK_SEC = 0.1
export const HALF_TICKS = 27_000 // 45 min
