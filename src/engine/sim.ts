// Moteur de match : simulation tick par tick (10 Hz), déterministe.
// Home attaque vers x=105, away vers x=0.

import { Rng } from './rng'
import { runAutoSub, pickReplacement } from './autoSub'
import {
  FORMATION_SLOTS,
  assignSlots,
  type Slot,
} from './formations'
import {
  LINE_X,
  MENTALITY_LEVEL,
  MENTALITY_PUSH,
  PRESS_FACTOR,
  TEMPO_DECISION,
  WIDTH_FACTOR,
} from './instructions'
import { maxSpeed, staminaFactor, updateStamina } from './stamina'
import {
  attackTarget,
  attackWeights,
  defenseTarget,
  defenseWeights,
  type AttackSliceInput,
  type DefenseSliceInput,
} from './slices'
import {
  EXTRA_HALF_TICKS,
  HALF_TICKS,
  PITCH,
  TICK_SEC,
  isBreak,
  isExtraTime,
  type AttBehavior,
  type BallTransit,
  type Formation,
  type LivePlayer,
  type MatchEvent,
  type MatchInstructions,
  type MatchState,
  type Player,
  type PlayerInstruction,
  type Side,
  type Team,
  type TeamMatchState,
} from './types'

/**
 * Probabilité maximale qu'un appel en profondeur soit mal minuté (joueur dont
 * l'attribut `decisions` vaut 0) ; nulle pour un décideur parfait. C'est la
 * seule source de hors-jeu du moteur — calibrée au sim-bench.
 */
const RUN_MISTIME_MAX = 0.5

/**
 * Seuils de course, en m/s. Un joueur « court » au-delà de SPRINT_WALK — c'est
 * le dénominateur du critère « sprint / temps de course » du Pilier A — et
 * « sprinte » au-delà de SPRINT_SPEED (25,2 km/h, la définition usuelle en
 * analyse de match).
 */
const SPRINT_WALK = 2
const SPRINT_SPEED = 7

/**
 * Barème des notes. Une note part de 6,0 et se gagne sur ce qui change le
 * match, pas sur le fait de toucher le ballon.
 *
 * L'ancien barème dérivait de +2,15 par joueur et par match — mesuré site par
 * site — dont 93 % venus des passes réussies, des récupérations et des passes
 * coupées, c'est-à-dire d'actions qu'un titulaire répète cinquante fois. La
 * médiane finissait à 7,98 et 9 % des joueurs tapaient le plafond de 10,0 à
 * chaque match : dans le haut de l'échelle, la note ne distinguait plus rien.
 *
 * Les poids de routine sont donc calés pour qu'un match complet d'actions
 * ordinaires vaille environ +0,5, et les actions décisives portent le reste.
 * Les regrouper ici est le point : leur somme se relit, alors qu'éparpillés
 * sur quatorze sites d'appel personne ne voyait le total.
 */
const RATING = {
  base: 6,
  min: 3,
  max: 10,
  /** Routine — répétée des dizaines de fois par match, donc pondérée en conséquence. */
  passOk: 0.003,
  passFailed: -0.006,
  laneInterception: 0.08,
  looseBallRecovery: 0.04,
  tackleWon: 0.1,
  dispossessed: -0.05,
  /** Tir dans le jeu — le but lui-même est compté à part, à sa résolution. */
  shotSaved: 0.05,
  shotMissed: -0.08,
  shotOut: -0.05,
  /**
   * Gardien. Sans ces deux lignes il ne se passait rien de noté dans sa
   * surface : `PlayerStats.saves` n'était incrémenté nulle part dans le
   * moteur, et la note des gardiens restait collée à la base — 6,16 de
   * moyenne, quel que soit le match joué.
   */
  save: 0.18,
  goalConceded: -0.3,
  /** Décisif. */
  goal: 1,
  assist: 0.5,
  /**
   * Un penalty marqué vaut moins qu'un but construit : le tireur touche déjà
   * `goal` à la résolution, et l'ancien barème lui ajoutait +0,8 par-dessus,
   * ce qui payait le penalty (+1,8) mieux qu'une action de jeu (+1,0). En
   * rater un, en revanche, coûte cher.
   */
  penaltyScored: 0.2,
  penaltyMissed: -0.6,
  foul: -0.15,
  yellowCard: -0.3,
  redCard: -1.5,
} as const

/**
 * Durée pendant laquelle une possession reste imputable à la phase arrêtée qui
 * l'a lancée. Au-delà, un but compte comme une action construite. La chaîne est
 * aussi rompue par tout changement de camp.
 *
 * C'est une règle d'imputation, pas de jeu : elle ne change aucun but marqué,
 * seulement leur classement. Sa valeur dépend donc de deux choses, et il faut
 * la relire quand l'une bouge — le rythme des joueurs (à quelle vitesse la
 * phase d'un corner se joue) et le nombre de remises en jeu par match. Elle
 * valait 15 s quand les joueurs allaient 30 % plus vite et que l'arbitre
 * sifflait 7 fautes par match ; au rythme et au volume corrigés, 20 s.
 */
const SET_PIECE_CHAIN_TICKS = 200

/**
 * Règlement National (et IFAB moderne) : cinq joueurs remplaçables, en trois
 * interruptions au maximum. Les changements opérés à la mi-temps ne comptent
 * dans aucune des trois.
 */
const MAX_SUBS = 5
const MAX_SUB_WINDOWS = 3

/**
 * Effet d'un joueur touché qui reste en jeu : il perd de la vitesse de pointe
 * et se vide plus vite. Le coach automatique le sortira donc de lui-même au
 * prochain rendez-vous, sans règle dédiée.
 */
const INJURY_SPEED_MUL = 0.85
const INJURY_ENDURANCE_MUL = 0.8

/**
 * Risque de blessure. Deux sources, les deux dominantes en vrai : le contact
 * (faute subie, tacle propre encaissé) et la lésion musculaire (sprint sur
 * des jambes vides). Cibles UEFA (~8 blessures / 1000 h) : 0,25-0,45
 * sortie/match et 0,8-1,6 touché/match, toutes équipes confondues.
 * Mesuré : 0,30 sortie/match et 1,00 touché/match sur 40 matchs (TEAMS vs
 * TEAMS, `autoSubSides: []` — sans banc géré d'aucun côté, ce qui N'EST PAS
 * la configuration du harnais de référence `scripts/sim.ts`, qui passe les
 * deux côtés).
 * Mesure d'isolement (INJURY_SPEED_MUL et INJURY_ENDURANCE_MUL remis à 1,
 * sans rien changer d'autre) : sur un effectif de Ligue 3 (20 matchs, banc
 * géré des deux côtés comme au harnais de référence), le malus de touché ne
 * coûte que 0,05 but/match (1,75 → 1,80) ; l'essentiel de l'écart avec la
 * baseline sans blessure (2,00) vient donc du niveau du banc de
 * remplacement, pas du malus du joueur diminué.
 */
const INJURY_ON_FOUL = 0.05
const INJURY_ON_CLEAN_TACKLE = 0.008
/** Risque par tick de sprint, nul au-dessus de INJURY_FATIGUE_FROM. */
const INJURY_SPRINT_BASE = 0.0004
const INJURY_FATIGUE_FROM = 70
/** Part des blessures qui obligent à sortir ; le reste laisse un joueur diminué. */
const INJURY_SEVERE = 0.22

/**
 * Part des duels gagnés qui chassent le ballon hors du terrain au lieu de le
 * laisser au vainqueur. C'est la première source de touches d'un vrai match :
 * sans elle, 142 interceptions et 25 tacles par match ne produisaient aucune
 * remise en jeu. Calibré au sim-bench sur 35-45 touches et 9-11 corners.
 */
const DUEL_OUT_TACKLE = 0.5
const DUEL_OUT_INTERCEPT = 0.16

/**
 * Vitesse d'une passe en m/s. Sert deux fois : la durée du transit, et le
 * temps dont dispose un défenseur pour se jeter sur la ligne de passe.
 */
const PASS_SPEED = { short: 13, long: 19 } as const

/**
 * Fenêtre de réaction sur une ligne de passe : temps de lecture avant de
 * s'élancer, puis vitesse à laquelle le défenseur couvre les derniers mètres.
 * Ce sont les deux poignées de calibration du taux de passes coupées.
 */
const INTERCEPT_REACTION_S = 0.24
const INTERCEPT_CLOSING_MS = 4.8

/**
 * Vitesse d'un joueur ballon mort, en m/s. Pendant un arrêt de jeu le moteur
 * coupait les décisions mais laissait `movePlayers` tourner à pleine vitesse :
 * les joueurs sprintaient pendant les remises en jeu, la forme d'équipe se
 * dissolvait avant que le ballon revienne, et l'arrêt comptait quand même dans
 * les kilomètres parcourus et dans la fatigue. Ballon mort, on marche.
 */
const DEAD_BALL_WALK_MS = 1.4

/**
 * Contre d'un tir par un défenseur. Le moteur ne contrait que 4 % des tirs,
 * contre ~28 % dans un vrai match : tout ce qu'un attaquant tentait arrivait
 * jusqu'au gardien ou sortait du cadre, et se jeter dans une trajectoire ne
 * servait à rien. `reach` est une envergure de corps ; `base` est la poignée
 * de calibration du taux.
 */
const BLOCK_REACH_M = 2.0
const BLOCK_BASE = 0.85

/**
 * Rampe d'effort : part de `FLOOR` à l'arrivée et atteint le plein régime à
 * `RAMP_M` mètres de la cible. Les joueurs parcouraient 14,3 km par match
 * contre ~10,5 en vrai, et sprintaient 10,6 % de leur temps de course contre
 * ~3 % — parce que l'effort ne dépendait que du comportement choisi, jamais de
 * la distance restant à couvrir.
 */
const EFFORT_RAMP_FLOOR = 0.28
const EFFORT_RAMP_M = 24

/**
 * Part des duels qui tournent à la faute, selon que le tacle touche le ballon
 * ou non. Un tacle manqué est plus souvent sanctionné qu'un tacle propre :
 * c'est là qu'on prend l'homme.
 */
const FOUL_ON_TACKLE = 0.26
const FOUL_ON_MISSED = 0.3

/** Retenue d'un joueur déjà averti sur son prochain duel. */
const BOOKED_CAUTION = 0.45

/**
 * Multiplicateur du taux d'engagement dans un duel. Le moteur produisait ~42
 * duels par match, contre ~100 dans un vrai match — d'où trop peu de fautes
 * comme trop peu de tacles, quelle que soit la part sifflée.
 */
const DUEL_RATE = 1.7

/**
 * Position minimale, en espace équipe, à partir de laquelle une remise en jeu
 * ouvre une chaîne de phase arrêtée. 0,66 = dernier tiers.
 */
const SET_PIECE_DANGER_TX = 0.66

/**
 * Résolution du tir : base au niveau d'ancrage (50 = joueur moyen) et pente
 * qui traduit l'écart de niveau.
 *
 * Les pentes étaient trop raides, et le défaut était invisible au bench : les
 * deux équipes fictives qui lui servent de référence tournent à 68 de
 * technique et 67 de décisions, quand la Ligue 3 réelle est à 51 et 57. Le
 * moteur n'était donc calibré que pour des joueurs très au-dessus de la
 * moyenne — sur de vrais clubs il tombait à 1,5 but par match, contre ~2,5
 * dans la vraie Ligue 3.
 *
 * L'écart réel entre une élite et une D3 est mince (2,8 buts contre 2,5) ; le
 * moteur en faisait un gouffre (2,7 contre 1,5). C'est la pente qui est en
 * cause, pas la base.
 */
const SHOT_ON_TARGET_BASE = 0.565
const SHOT_ON_TARGET_SLOPE = 0.28
const SHOT_CONV_BASE = 0.211
const SHOT_CONV_SPREAD = 300

/**
 * Distance à la ligne de but en deçà de laquelle un duel peut l'envoyer dehors
 * par la ligne de but plutôt que par la touche. Elle valait 10 m et produisait
 * 12,6 corners par match, au-dessus des 9-11 que le commentaire de
 * `DUEL_OUT_*` juste au-dessus donne lui-même pour cible. Les sorties
 * excédentaires repartent en touche, qui en manquait.
 */
const GOAL_LINE_OUT_M = 8

/**
 * Durée des arrêts de jeu, EN SECONDES. Ces valeurs étaient auparavant écrites
 * directement en ticks (10 par seconde) : une touche reprenait en 1 s au lieu
 * de 10, et le moteur enchaînait 90 minutes quasi sans respiration — 0,9 % de
 * temps mort contre ~30 % dans un vrai match.
 */
const STOPPAGE_S = {
  throwIn: 18,
  goalKick: 25,
  corner: 30,
  freeKick: 25,
  penalty: 55,
  keeperRestart: 12,
  kickoff: 65,
} as const

/** Secondes -> ticks. */
function ticks(seconds: number): number {
  return Math.round(seconds / TICK_SEC)
}

const HOME_GOAL = { x: 0, y: PITCH.W / 2 }
const AWAY_GOAL = { x: PITCH.L, y: PITCH.W / 2 }

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by)
}

function newStats() {
  return {
    touches: 0,
    passes: 0,
    passesOk: 0,
    shots: 0,
    goals: 0,
    assists: 0,
    tackles: 0,
    interceptions: 0,
    fouls: 0,
    saves: 0,
    distance: 0,
    runningTicks: 0,
    sprintTicks: 0,
    rating: RATING.base,
  }
}

export interface MatchOptions {
  home: Team
  away: Team
  homeInstructions: MatchInstructions
  awayInstructions: MatchInstructions
  seed: number
  /**
   * Côtés dont les remplacements sont gérés par le coach automatique.
   * L'interface n'y met que le camp de l'IA ; le sim-bench y met les deux,
   * sinon la calibration mesure une fatigue de fin de match irréaliste.
   */
  autoSubSides?: Side[]
  /**
   * Match à élimination directe : une égalité à la fin du temps réglementaire
   * envoie en prolongation. Faux par défaut, et faux au sim-bench — sinon les
   * bornes du Pilier A se mesureraient sur des matchs de 120 minutes.
   */
  knockout?: boolean
}

export class MatchEngine {
  readonly state: MatchState
  private rng: Rng
  private nextDecisionTick = 0
  private freezeUntilTick = 0
  private lastPasserId: string | null = null
  /** bruit de déplacement lissé par joueur */
  private wander = new Map<string, { dx: number; dy: number }>()
  /** balle lissée par côté (inertie du bloc) */
  private smoothed = new Map<Side, { tx: number; ty: number }>()
  /** phase attaque (1) / défense (0) lissée par côté — transitions visibles */
  private phase = new Map<Side, number>()
  /** rang des défenseurs les plus proches du ballon (0 = premier presseur) */
  private presserRanks = new Map<string, 0 | 1 | 2>()
  /** ligne du hors-jeu par côté, en espace ATTAQUANT (tx max pour rester en jeu) */
  private offsideLine = new Map<Side, number>()
  /** passes exemptées de hors-jeu après remise en jeu (engagement, 6 m, corner, CF) */
  private restartExemptUntilTick = 0
  /** cible issue du dernier slice (micro-décision), en coordonnées terrain */
  private sliceTargets = new Map<string, { x: number; y: number }>()
  /** dernier camp à avoir touché le ballon (sorties de balle) */
  private lastTouchSide: Side | null = null
  /** dernier camp en possession, pour invalider les slices au changement de camp */
  private lastSlicePossession: Side | null = null
  /**
   * Appels en profondeur en cours. Le comportement est retiré au sort toutes
   * les 0,3 s : sans mémoire, un appel dure une slice et le coureur est rappelé
   * derrière la ligne avant qu'une passe puisse lui parvenir — le hors-jeu ne
   * peut alors jamais se produire. L'épisode fige le choix et le pari de timing
   * pour la durée de la course.
   */
  private runEpisodes = new Map<string, { untilTick: number; gamble: boolean }>()
  /**
   * Possession en cours issue d'une phase arrêtée : sert à imputer les buts
   * (critère « buts sur phase arrêtée » du Pilier A). Rompue par un changement
   * de camp ou par l'expiration de SET_PIECE_CHAIN_TICKS.
   */
  private setPieceChain: { side: Side; untilTick: number } | null = null
  /** dernier porteur, pour invalider sa cible hors-ballon */
  private lastCarrierId: string | null = null

  /** Côtés pris en charge par le coach automatique (remplacements). */
  private readonly autoSubSides: Side[]
  /** Rendez-vous de remplacement déjà consommés (`away:m60`…) */
  private autoSubDone = new Set<string>()
  private readonly knockout: boolean

  constructor(opts: MatchOptions) {
    this.rng = new Rng(opts.seed)
    this.autoSubSides = opts.autoSubSides ?? []
    this.knockout = opts.knockout ?? false
    const homeTms = this.buildTeamState('home', opts.home, opts.homeInstructions)
    const awayTms = this.buildTeamState('away', opts.away, opts.awayInstructions)

    const players: Record<string, LivePlayer> = {}
    for (const tms of [homeTms, awayTms]) {
      for (const p of tms.team.players) {
        players[p.id] = {
          id: p.id,
          side: tms.side,
          onPitch: tms.lineup.includes(p.id),
          x: PITCH.L / 2,
          y: PITCH.W / 2,
          prevX: PITCH.L / 2,
          prevY: PITCH.W / 2,
          stamina: 100,
          stats: newStats(),
          warned40: false,
          warned20: false,
          behavior: 'hold_position',
          yellowCards: 0,
          sentOff: false,
          subbedOff: false,
          injury: 'none',
        }
      }
    }

    this.state = {
      tick: 0,
      phase: 'first_half',
      addedTimeSec: Math.round(this.rng.range(30, 180)),
      periodEndTick: HALF_TICKS,
      deadTicks: 0,
      refereeStrictness: this.rng.range(0.8, 1.3),
      score: { home: 0, away: 0 },
      ball: {
        x: PITCH.L / 2,
        y: PITCH.W / 2,
        prevX: PITCH.L / 2,
        prevY: PITCH.W / 2,
        carrierId: null,
        transit: null,
      },
      players,
      home: homeTms,
      away: awayTms,
      possession: null,
      events: [],
      seed: opts.seed,
    }
    this.resetPositions('home')
  }

  private buildTeamState(side: Side, team: Team, instructions: MatchInstructions): TeamMatchState {
    const lineup =
      instructions.lineup && instructions.lineup.length === 11
        ? [...instructions.lineup]
        : assignSlots(team.players, instructions.team.formation)
    return {
      side,
      team,
      instructions,
      lineup,
      subsUsed: 0,
      subWindows: 0,
      lastSubTick: -1,
      stats: {
        shots: 0,
        shotsOnTarget: 0,
        possessionTicks: 0,
        corners: 0,
        fouls: 0,
        yellowCards: 0,
        redCards: 0,
        offsides: 0,
        penalties: 0,
        passes: 0,
        passesOk: 0,
        setPieceGoals: 0,
      },
    }
  }

  // -----------------------------------------------------------------------
  // Conversions d'espace
  // -----------------------------------------------------------------------

  private toPitch(side: Side, tx: number, ty: number): { x: number; y: number } {
    tx = clamp(tx, 0.005, 0.995)
    ty = clamp(ty, 0.01, 0.99)
    return side === 'home'
      ? { x: tx * PITCH.L, y: ty * PITCH.W }
      : { x: PITCH.L - tx * PITCH.L, y: PITCH.W - ty * PITCH.W }
  }

  private toTeamSpace(side: Side, x: number, y: number): { tx: number; ty: number } {
    return side === 'home'
      ? { tx: x / PITCH.L, ty: y / PITCH.W }
      : { tx: 1 - x / PITCH.L, ty: 1 - y / PITCH.W }
  }

  private attackedGoal(side: Side): { x: number; y: number } {
    return side === 'home' ? AWAY_GOAL : HOME_GOAL
  }

  private player(id: string): Player {
    const side = this.state.players[id].side
    return (side === 'home' ? this.state.home : this.state.away).team.players.find(
      (p) => p.id === id,
    )!
  }

  private tms(side: Side): TeamMatchState {
    return side === 'home' ? this.state.home : this.state.away
  }

  private instrFor(tms: TeamMatchState, playerId: string): PlayerInstruction | undefined {
    return tms.instructions.players.find((pi) => pi.playerId === playerId)
  }

  private minute(): number {
    return Math.floor((this.state.tick * TICK_SEC) / 60)
  }

  private log(
    type: MatchEvent['type'],
    message: string,
    side?: Side,
    playerId?: string,
    x?: number,
    y?: number,
  ) {
    this.state.events.push({
      tick: this.state.tick,
      minute: this.minute(),
      type,
      side,
      playerId,
      message,
      x,
      y,
    })
  }

  private bumpRating(id: string, delta: number) {
    const lp = this.state.players[id]
    lp.stats.rating = clamp(lp.stats.rating + delta, RATING.min, RATING.max)
  }

  // -----------------------------------------------------------------------
  // Tick principal
  // -----------------------------------------------------------------------

  tick(): void {
    const st = this.state
    if (st.phase === 'finished' || isBreak(st.phase)) return
    st.tick++

    if (st.tick >= st.periodEndTick) {
      this.endOfPeriod()
      return
    }
    this.runAutoSubs()

    // mémoire des positions pour l'interpolation du rendu
    st.ball.prevX = st.ball.x
    st.ball.prevY = st.ball.y

    // ballon hors jeu : le gel qui suit chaque remise en jeu est le seul temps
    // mort modélisé — c'est la mesure du critère « temps morts » du Pilier A
    if (st.tick < this.freezeUntilTick) st.deadTicks++

    if (st.possession) st[st.possession].stats.possessionTicks++
    if (st.ball.carrierId) this.lastTouchSide = st.players[st.ball.carrierId].side

    this.updateBall()

    const carrierId = st.ball.carrierId
    if (carrierId) {
      const lp = st.players[carrierId]
      st.possession = lp.side
      const frozen = st.tick < this.freezeUntilTick
      if (!frozen) {
        this.tryTackle(lp)
        if (st.ball.carrierId === carrierId && st.tick >= this.nextDecisionTick) {
          this.decide(lp)
        }
      }
    }

    this.movePlayers()
  }

  /** Avance la simulation de n ticks. */
  runTicks(n: number): void {
    for (let i = 0; i < n && this.state.phase !== 'finished'; i++) this.tick()
  }

  // -----------------------------------------------------------------------
  // Ballon
  // -----------------------------------------------------------------------

  private updateBall() {
    const st = this.state
    const t = st.ball.transit
    if (!t) {
      const carrier = st.ball.carrierId ? st.players[st.ball.carrierId] : null
      // Ballon mort : la balle reste au point de la remise en jeu. Sans ce
      // garde-fou, le tireur l'emmenait avec lui pendant le gel — une touche
      // partait 25 m plus loin que la sortie, le long de la ligne.
      if (carrier && st.tick >= this.freezeUntilTick) {
        const goal = this.attackedGoal(carrier.side)
        const d = Math.max(dist(carrier.x, carrier.y, goal.x, goal.y), 1)
        st.ball.x = carrier.x + ((goal.x - carrier.x) / d) * 0.8
        st.ball.y = carrier.y + ((goal.y - carrier.y) / d) * 0.8
      }
      return
    }
    const p = clamp((st.tick - t.startTick) / Math.max(t.endTick - t.startTick, 1), 0, 1)
    // la balle roule vers un point FIXE (pas de guidage) : c'est au joueur
    // d'anticiper le point de chute — voir l'anticipation dans movePlayers
    st.ball.x = t.fromX + (t.toX - t.fromX) * p
    st.ball.y = t.fromY + (t.toY - t.fromY) * p
    if (st.tick >= t.endTick) {
      st.ball.transit = null
      this.resolveArrival(t)
      return
    }
    this.checkOutOfBounds()
  }

  /**
   * Sorties de balle : touches sur les lignes de touche, corner ou six
   * mètres sur les lignes de but (selon le dernier camp à avoir touché le
   * ballon). Les tirs sont exclus : leur sortie est résolue à l'arrivée.
   */
  private checkOutOfBounds() {
    const st = this.state
    const t = st.ball.transit
    if (!t || t.kind === 'shot') return
    const M = 0.4
    const outY = st.ball.y < M || st.ball.y > PITCH.W - M
    const outX = st.ball.x < M || st.ball.x > PITCH.L - M
    if (!outY && !outX) return
    const last = this.lastTouchSide ?? st.possession ?? 'home'
    this.ballOut(last, st.ball.x, st.ball.y, outY)
  }

  /**
   * Résout une sortie de balle en (x, y), le dernier contact étant `last`.
   * Partagé par la détection sur trajectoire et par les sorties sur duel.
   */
  private ballOut(last: Side, x: number, y: number, sideline: boolean) {
    const other: Side = last === 'home' ? 'away' : 'home'
    if (sideline) {
      // touche pour le camp qui n'a pas touché le ballon en dernier
      this.throwIn(other, clamp(x, 2, PITCH.L - 2), y < PITCH.W / 2 ? 0.6 : PITCH.W - 0.6)
      return
    }
    // ligne de but : dernier touché défenseur → corner ; attaquant → six mètres
    const defSide: Side = x < PITCH.L / 2 ? 'home' : 'away'
    if (last === defSide) {
      this.tms(other).stats.corners++
      this.giveCorner(other)
      this.log('corner', `Corner pour ${this.tms(other).team.short}.`, other)
    } else {
      this.goalKickRestart(defSide)
    }
  }

  /**
   * Un duel (tacle, interception) qui chasse le ballon hors du terrain. La
   * ligne franchie est la plus proche du point du duel : au milieu c'est une
   * touche, près d'une ligne de but c'est un corner ou un six mètres selon qui
   * a touché en dernier.
   */
  private knockOut(last: Side, x: number, y: number) {
    // La touche est l'issue par défaut : un joueur en difficulté pousse le
    // ballon sur le côté. La ligne de but n'est franchie que tout près d'elle,
    // sinon la seule géométrie (105 m de long contre 68 de large) produirait
    // un corner à chaque duel aux abords de la surface.
    const dGoalLine = Math.min(x, PITCH.L - x)
    this.ballOut(last, x, y, dGoalLine > GOAL_LINE_OUT_M)
  }

  /** Touche : le plus proche vient prendre la balle sur la ligne. */
  private throwIn(side: Side, x: number, y: number) {
    this.markSetPieceIfDangerous(side, STOPPAGE_S.throwIn, x, y)
    const st = this.state
    const taker = this.nearestTo(x, y, side)
    if (!taker) return
    st.ball.transit = null
    const bx = clamp(x, 1, PITCH.L - 1)
    const by = clamp(y, 1, PITCH.W - 1)
    st.ball.x = bx
    st.ball.y = by
    st.ball.prevX = bx
    st.ball.prevY = by
    st.ball.carrierId = taker.id
    st.possession = side
    this.lastTouchSide = side
    taker.stats.touches++
    this.freezeUntilTick = st.tick + ticks(STOPPAGE_S.throwIn)
    this.restartExemptUntilTick = st.tick + 40
    this.nextDecisionTick = st.tick + 12
    this.lastPasserId = null
    this.log('throw_in', `Touche pour ${this.tms(side).team.short} — ${this.nameOf(taker.id)}.`, side, taker.id, x, y)
  }

  /** Six mètres (balle sortie en touche de but) : remise en jeu visible. */
  private goalKickRestart(defSide: Side) {
    const st = this.state
    const keeper = this.keeperOf(defSide)
    const spot = this.toPitch(defSide, 0.06, 0.5)
    st.ball.transit = {
      fromX: st.ball.x,
      fromY: st.ball.y,
      toX: spot.x,
      toY: spot.y,
      startTick: st.tick,
      endTick: st.tick + 8,
      kind: 'clearance',
      intendedReceiverId: keeper?.id,
      success: true,
    }
    st.possession = defSide
    this.lastTouchSide = defSide
    this.freezeUntilTick = st.tick + ticks(STOPPAGE_S.goalKick)
    this.restartExemptUntilTick = st.tick + 45
    this.nextDecisionTick = st.tick + 20
    this.log('goal_kick', `Six mètres pour ${this.tms(defSide).team.short}.`, defSide, undefined, spot.x, spot.y)
  }

  private resolveArrival(t: BallTransit) {
    const st = this.state
    if (t.kind === 'shot') {
      this.resolveShot(t)
      return
    }
    if (t.offside && t.intendedReceiverId) {
      const receiverSide = st.players[t.intendedReceiverId].side
      const defSide: Side = receiverSide === 'home' ? 'away' : 'home'
      this.tms(defSide).stats.offsides++
      const taker = this.nearestTo(t.toX, t.toY, defSide)
      if (taker) {
        st.ball.carrierId = taker.id
        st.possession = defSide
        taker.stats.touches++
      }
      this.freezeUntilTick = st.tick + ticks(STOPPAGE_S.freeKick)
      this.restartExemptUntilTick = st.tick + 40
      this.nextDecisionTick = st.tick + 14
      this.lastPasserId = null
      this.log(
        'offside',
        `🚩 Hors-jeu ! ${this.nameOf(t.intendedReceiverId)} était en position illégale.`,
        defSide,
        t.intendedReceiverId,
        t.toX,
        t.toY,
      )
      return
    }
    if (t.interceptedById) {
      // passe coupée sur la trajectoire : l'intercepteur récupère sur place
      const inter = st.players[t.interceptedById]
      this.lastTouchSide = inter.side
      inter.stats.interceptions++
      this.bumpRating(inter.id, RATING.laneInterception)
      this.log('interception', `Belle lecture ! ${this.nameOf(inter.id)} coupe la passe.`, inter.side, inter.id, inter.x, inter.y)
      this.lastPasserId = null
      // une interception sur dix est un dégagement en catastrophe plutôt qu'une
      // récupération propre : le ballon file en touche
      if (this.rng.chance(DUEL_OUT_INTERCEPT)) {
        st.ball.carrierId = null
        this.knockOut(inter.side, inter.x, inter.y)
        return
      }
      st.ball.carrierId = inter.id
      st.possession = inter.side
      inter.stats.touches++
      this.nextDecisionTick = st.tick + 5
      return
    }
    const receiver = t.intendedReceiverId ? st.players[t.intendedReceiverId] : null
    if (t.success && receiver && receiver.onPitch) {
      st.possession = receiver.side
      this.lastTouchSide = receiver.side
      const dArr = dist(receiver.x, receiver.y, t.toX, t.toY)
      if (dArr > 1.8) {
        // le receveur va chercher la balle au point de chute (pas de téléportation)
        const dur = Math.max(3, Math.round(dArr / 6 / TICK_SEC))
        st.ball.carrierId = null
        st.ball.transit = {
          fromX: t.toX,
          fromY: t.toY,
          toX: receiver.x,
          toY: receiver.y,
          startTick: st.tick,
          endTick: st.tick + dur,
          kind: 'clearance',
          intendedReceiverId: receiver.id,
          success: true,
        }
        this.nextDecisionTick = st.tick + dur + 4
      } else {
        st.ball.carrierId = receiver.id
        receiver.stats.touches++
        this.lastPasserId = t.kind === 'pass' ? this.lastKicker : null
        this.nextDecisionTick = st.tick + 4
      }
      return
    }
    // balle perdue : le plus proche court dessus (plus de téléportation)
    const winner = this.nearestTo(t.toX, t.toY)
    if (winner) {
      const changed = st.possession !== winner.side
      st.possession = winner.side
      this.lastTouchSide = winner.side
      const d = dist(winner.x, winner.y, t.toX, t.toY)
      if (d > 2) {
        // balle flottante : le récupéreur doit d'abord la course au ballon
        const dur = Math.max(3, Math.round(d / 6 / TICK_SEC))
        st.ball.carrierId = null
        st.ball.transit = {
          fromX: t.toX,
          fromY: t.toY,
          toX: winner.x,
          toY: winner.y,
          startTick: st.tick,
          endTick: st.tick + dur,
          kind: 'clearance',
          intendedReceiverId: winner.id,
          success: true,
        }
        this.nextDecisionTick = st.tick + dur + 4
      } else {
        st.ball.carrierId = winner.id
        winner.stats.touches++
        this.nextDecisionTick = st.tick + 5
      }
      if (changed) {
        winner.stats.interceptions++
        this.bumpRating(winner.id, RATING.looseBallRecovery)
        this.log('interception', `Balle perdue ! ${this.nameOf(winner.id)} récupère la balle.`, winner.side, winner.id)
      }
      this.lastPasserId = null
    }
  }

  private nameOf(id: string): string {
    return this.player(id).name
  }

  private resolveShot(t: BallTransit) {
    const st = this.state
    const shooterId = t.shooterId!
    const shooter = st.players[shooterId]
    const shootingSide = shooter.side
    const defSide: Side = shootingSide === 'home' ? 'away' : 'home'
    const defTms = this.tms(defSide)
    const keeper = this.keeperOf(defSide)

    if (t.shotOutcome === 'goal') {
      st.score[shootingSide]++
      shooter.stats.goals++
      if (this.isSetPieceGoal(shootingSide)) this.tms(shootingSide).stats.setPieceGoals++
      this.bumpRating(shooterId, RATING.goal)
      if (keeper) this.bumpRating(keeper.id, RATING.goalConceded)
      const assistId = t.assistCandidateId
      if (assistId && !t.fromPenalty && st.players[assistId].side === shootingSide) {
        st.players[assistId].stats.assists++
        this.bumpRating(assistId, RATING.assist)
      }
      this.log(
        'goal',
        t.fromPenalty
          ? `⚽ BUT ! ${this.nameOf(shooterId)} transforme le penalty pour ${this.tms(shootingSide).team.short} !`
          : `⚽ BUT ! ${this.nameOf(shooterId)} marque pour ${this.tms(shootingSide).team.short}${assistId && assistId !== shooterId ? ` (passe décisive de ${this.nameOf(assistId)})` : ''} !`,
        shootingSide,
        shooterId,
        t.toX,
        t.toY,
      )
      this.resetPositions(defSide)
    } else if (t.shotOutcome === 'save') {
      // le gardien capte la balle — visible : la balle file vers lui, court temps mort
      if (keeper) {
        keeper.stats.saves++
        this.bumpRating(keeper.id, RATING.save)
        st.ball.carrierId = null
        st.ball.transit = {
          fromX: st.ball.x,
          fromY: st.ball.y,
          toX: keeper.x,
          toY: keeper.y,
          startTick: st.tick,
          endTick: st.tick + 5,
          kind: 'clearance',
          intendedReceiverId: keeper.id,
          success: true,
        }
        st.possession = keeper.side
        this.freezeUntilTick = st.tick + ticks(STOPPAGE_S.keeperRestart)
        this.restartExemptUntilTick = st.tick + 40
        this.nextDecisionTick = st.tick + 14
      }
      this.log(
        'save',
        t.fromPenalty
          ? `Penalty arrêté ! Le gardien de ${defTms.team.short} repousse la frappe de ${this.nameOf(shooterId)} !`
          : `Frappe de ${this.nameOf(shooterId)}… arrêté par le gardien !`,
        shootingSide,
        shooterId,
        t.toX,
        t.toY,
      )
    } else if (t.shotOutcome === 'off_target') {
      this.log(
        'off_target',
        t.fromPenalty
          ? `${this.nameOf(shooterId)} manque le penalty ! C'est au-dessus…`
          : `Frappe de ${this.nameOf(shooterId)}… à côté.`,
        shootingSide,
        shooterId,
        t.toX,
        t.toY,
      )
      if (this.rng.chance(0.45)) {
        // corner
        const attTms = this.tms(shootingSide)
        attTms.stats.corners++
        this.giveCorner(shootingSide)
        this.log('corner', `Corner pour ${attTms.team.short}.`, shootingSide)
      } else if (keeper) {
        // six mètres joué : la balle est placée au point de réparation court,
        // le gardien vient la chercher — remise en jeu visible
        const spot = this.toPitch(defSide, 0.06, 0.5)
        st.ball.carrierId = null
        st.ball.transit = {
          fromX: st.ball.x,
          fromY: st.ball.y,
          toX: spot.x,
          toY: spot.y,
          startTick: st.tick,
          endTick: st.tick + 8,
          kind: 'clearance',
          intendedReceiverId: keeper.id,
          success: true,
        }
        st.possession = defSide
        this.freezeUntilTick = st.tick + ticks(STOPPAGE_S.goalKick)
        this.restartExemptUntilTick = st.tick + 45
        this.nextDecisionTick = st.tick + 20
        this.log('goal_kick', `Six mètres pour ${defTms.team.short}.`, defSide, undefined, spot.x, spot.y)
      }
      this.bumpRating(shooterId, RATING.shotOut)
    } else {
      // Contré : le ballon rebondit sur le défenseur et repart de quelques
      // mètres. Sans cette déviation le contreur restait toujours le plus
      // proche du point d'impact et récupérait à chaque fois — un contre
      // valait une perte de balle certaine, alors qu'un tir contré revient à
      // l'attaque environ une fois sur deux.
      const bx = clamp(t.toX + this.rng.range(-6, 6), 1, PITCH.L - 1)
      const by = clamp(t.toY + this.rng.range(-6, 6), 1, PITCH.W - 1)
      st.ball.x = bx
      st.ball.y = by
      const winner = this.nearestTo(bx, by)
      if (winner) {
        st.ball.carrierId = winner.id
        st.possession = winner.side
        this.nextDecisionTick = st.tick + 5
      }
    }
    this.lastPasserId = null
  }

  private giveCorner(side: Side) {
    this.markSetPiece(side, STOPPAGE_S.corner)
    const st = this.state
    // La balle sortie était encore en transit (checkOutOfBounds lit une passe
    // en vol) : sans cette coupure, le transit périmé reprenait la main au
    // tick suivant, le corner n'était jamais joué et le tireur restait planté
    // au drapeau pendant les 30 s de gel.
    st.ball.transit = null
    // spot de corner côté but adverse
    const goal = this.attackedGoal(side)
    const x = goal.x === PITCH.L ? PITCH.L - 1 : 1
    const y = st.ball.y < PITCH.W / 2 ? 1 : PITCH.W - 1
    // le joueur de l'équipe attaquante le plus proche du spot prend le corner
    const takers = Object.values(st.players).filter(
      (lp) => lp.side === side && lp.onPitch && this.player(lp.id).role !== 'GK',
    )
    let taker = takers[0]
    let best = Infinity
    for (const lp of takers) {
      const d = dist(lp.x, lp.y, x, y)
      if (d < best) {
        best = d
        taker = lp
      }
    }
    if (taker) {
      st.ball.carrierId = taker.id
      st.possession = side
      this.lastTouchSide = side
      st.ball.x = x
      st.ball.y = y
      st.ball.prevX = x
      st.ball.prevY = y
      this.freezeUntilTick = st.tick + ticks(STOPPAGE_S.corner)
      this.restartExemptUntilTick = st.tick + 40
      this.nextDecisionTick = st.tick + 12
    }
  }

  private keeperOf(side: Side): LivePlayer | null {
    const tms = this.tms(side)
    for (const id of tms.lineup) {
      if (this.player(id).role === 'GK' && this.state.players[id].onPitch) return this.state.players[id]
    }
    // gardien absent (exclu ou blessé) : le joueur de champ le plus à même d'aller au but
    let best: LivePlayer | null = null
    let bestAttr = -1
    for (const lp of Object.values(this.state.players)) {
      if (!lp.onPitch || lp.side !== side) continue
      const gk = this.player(lp.id).attributes.goalkeeper
      if (gk > bestAttr) {
        bestAttr = gk
        best = lp
      }
    }
    return best
  }

  /**
   * Sortie définitive du terrain (exclusion, blessure). Les cibles de slice et
   * le rang de presseur du joueur sont périmés, et le ballon qu'il portait
   * revient au plus proche — sans quoi un fantôme hors terrain continue de le
   * porter. Point unique : les deux appelants divergeaient mot pour mot.
   */
  private leavePitch(playerId: string) {
    const st = this.state
    st.players[playerId].onPitch = false
    this.sliceTargets.delete(playerId)
    this.presserRanks.delete(playerId)
    if (st.ball.carrierId === playerId) {
      st.ball.carrierId = null
      const winner = this.nearestTo(st.ball.x, st.ball.y)
      if (winner) {
        st.ball.carrierId = winner.id
        st.possession = winner.side
      }
    }
  }

  /** Exclusion : le joueur quitte le terrain, son équipe finit en infériorité. */
  private sendOff(side: Side, playerId: string, reason: 'second_yellow' | 'direct') {
    const st = this.state
    const lp = st.players[playerId]
    lp.sentOff = true
    this.leavePitch(playerId)
    this.tms(side).stats.redCards++
    this.bumpRating(playerId, RATING.redCard)
    const teamName = this.tms(side).team.short
    this.log(
      'red_card',
      reason === 'second_yellow'
        ? `🟥 Deuxième jaune : ${this.nameOf(playerId)} est exclu ! ${teamName} finira à ${this.tms(side).lineup.filter((id) => st.players[id].onPitch).length}.`
        : `🟥 Carton rouge direct pour ${this.nameOf(playerId)} ! ${teamName} est réduit à ${this.tms(side).lineup.filter((id) => st.players[id].onPitch).length}.`,
      side,
      playerId,
    )
  }

  /**
   * Blessure. La gravité est un tirage séparé du déclenchement : le taux de
   * sorties et le taux de touchés se calibrent alors indépendamment.
   * Un joueur déjà 'out' n'est plus concerné ; un 'knock' peut s'aggraver.
   */
  private injure(side: Side, playerId: string, cause: 'contact' | 'muscle') {
    const st = this.state
    const lp = st.players[playerId]
    if (!lp || !lp.onPitch || lp.injury === 'out') return

    const severe = this.rng.chance(INJURY_SEVERE)
    const how = cause === 'contact' ? 'touché sur l’action' : 'se tient la cuisse'
    if (!severe) {
      if (lp.injury === 'knock') return // déjà diminué, rien de neuf à dire
      lp.injury = 'knock'
      this.log('injury', `🤕 ${this.nameOf(playerId)} ${how} — il reste sur le terrain, diminué.`, side, playerId)
      return
    }

    lp.injury = 'out'
    this.leavePitch(playerId)
    this.log('injury', `🚑 ${this.nameOf(playerId)} ne peut pas continuer, il quitte le terrain.`, side, playerId)
    this.forcedSub(side, playerId)
  }

  /**
   * Sortie sur blessure : le camp auto-coaché remplace immédiatement, hors
   * rendez-vous. Une blessure consomme un joueur et une fenêtre — le règlement
   * ne prévoit aucune exemption. Le camp humain décide lui-même, y compris de
   * finir à dix. Quota épuisé ou banc vide : l'équipe joue en infériorité.
   */
  private forcedSub(side: Side, playerId: string) {
    const tms = this.tms(side)
    const short = () =>
      this.log(
        'info',
        `${tms.team.short} n'a plus de solution sur le banc : l'équipe finit à ${tms.lineup.filter((id) => this.state.players[id].onPitch).length}.`,
        side,
      )
    if (!this.autoSubSides.includes(side)) return
    if (!this.canSub(side)) return short()
    const inId = pickReplacement(this, side, playerId)
    if (!inId) return short()
    if (!this.makeSub(side, playerId, inId).ok) short()
  }

  /**
   * Penalty : temps mort, tireur désigné (meilleur tir + sang-froid),
   * résolution un coup — la frappe voyage jusqu'au but via un transit tir.
   */
  private awardPenalty(attSide: Side) {
    this.markSetPiece(attSide, STOPPAGE_S.penalty)
    const st = this.state
    const attTms = this.tms(attSide)
    const defSide: Side = attSide === 'home' ? 'away' : 'home'
    attTms.stats.penalties++

    // tireur : meilleur tir+sang-froid parmi les joueurs sur le terrain
    let shooter: LivePlayer | null = null
    let bestScore = -1
    for (const lp of Object.values(st.players)) {
      if (!lp.onPitch || lp.side !== attSide) continue
      if (this.player(lp.id).role === 'GK') continue
      const s = this.player(lp.id).attributes.shooting + this.player(lp.id).attributes.composure
      if (s > bestScore) {
        bestScore = s
        shooter = lp
      }
    }
    if (!shooter) return

    const goal = this.attackedGoal(attSide)
    const spotX = goal.x === PITCH.L ? PITCH.L - 11 : 11
    const spotY = PITCH.W / 2
    shooter.x = spotX - (goal.x === PITCH.L ? 2 : -2)
    shooter.y = spotY
    shooter.prevX = shooter.x
    shooter.prevY = shooter.y
    st.ball.x = spotX
    st.ball.y = spotY
    st.ball.prevX = spotX
    st.ball.prevY = spotY

    this.log(
      'penalty',
      `Penalty pour ${attTms.team.short} ! ${this.nameOf(shooter.id)} s'élance…`,
      attSide,
      shooter.id,
      spotX,
      spotY,
    )

    // conversion : ~76 % de base, ajustée tireur vs gardien
    const keeper = this.keeperOf(defSide)
    const gkAttr = keeper ? this.player(keeper.id).attributes.goalkeeper : 50
    const shooterAttr = this.player(shooter.id)
    const mental = (shooterAttr.attributes.shooting + shooterAttr.attributes.composure) / 2
    let conv = clamp(0.76 + (mental - 50) / 99 * 0.25 - (gkAttr - 50) / 99 * 0.3, 0.5, 0.93)
    let outcome: BallTransit['shotOutcome']
    if (this.rng.chance(conv)) outcome = 'goal'
    else outcome = this.rng.chance(0.75) ? 'save' : 'off_target'

    shooter.stats.shots++
    attTms.stats.shots++
    if (outcome === 'goal' || outcome === 'save') attTms.stats.shotsOnTarget++
    this.bumpRating(shooter.id, outcome === 'goal' ? RATING.penaltyScored : RATING.penaltyMissed)

    st.ball.carrierId = null
    st.ball.transit = {
      fromX: spotX,
      fromY: spotY,
      toX: goal.x,
      toY: goal.y,
      startTick: st.tick,
      endTick: st.tick + 22,
      kind: 'shot',
      success: outcome !== 'off_target',
      shotOutcome: outcome,
      shooterId: shooter.id,
      fromPenalty: true,
    }
    this.freezeUntilTick = st.tick + ticks(STOPPAGE_S.penalty)
    this.restartExemptUntilTick = st.tick + 45
    this.nextDecisionTick = st.tick + 26
    this.lastPasserId = null
    this.lastKicker = null
    this.lastTouchSide = attSide
  }

  private nearestTo(x: number, y: number, side?: Side): LivePlayer | null {
    const st = this.state
    const cands = Object.values(st.players).filter(
      (lp) => lp.onPitch && (side === undefined || lp.side === side),
    )
    if (!cands.length) return null
    // tri par distance réelle : seuls les joueurs réellement au point de
    // chute peuvent prendre la balle (fini la balle magnétique vers un
    // joueur éloigné) ; sinon le plus proche court dessus
    const sorted = cands
      .map((lp) => ({ lp, d: dist(lp.x, lp.y, x, y) }))
      .sort((a, b) => a.d - b.d)
    const close = sorted.filter((s) => s.d <= 2.5)
    if (close.length === 0) return sorted[0].lp
    const weights = close.map((s) => 1 / Math.pow(0.3 + s.d, 2))
    return close[this.rng.weighted(weights)].lp
  }

  private pressureOn(playerId: string): number {
    const st = this.state
    const lp = st.players[playerId]
    const oppSide: Side = lp.side === 'home' ? 'away' : 'home'
    let pressure = 0
    for (const o of Object.values(st.players)) {
      if (!o.onPitch || o.side !== oppSide) continue
      const d = dist(o.x, o.y, lp.x, lp.y)
      if (d < 3.5) pressure += 1 - d / 3.5
    }
    return pressure
  }

  // -----------------------------------------------------------------------
  // Décision du porteur
  // -----------------------------------------------------------------------

  private decide(carrier: LivePlayer) {
    const st = this.state
    const p = this.player(carrier.id)
    const a = p.attributes
    const tms = this.tms(carrier.side)
    const ti = tms.instructions.team
    const pi = this.instrFor(tms, carrier.id)
    const goal = this.attackedGoal(carrier.side)
    const dGoal = dist(carrier.x, carrier.y, goal.x, goal.y)
    const pressure = this.pressureOn(carrier.id)

    type Action =
      | { kind: 'shoot' }
      | { kind: 'dribble' }
      | { kind: 'pass'; targetId: string; long: boolean }

    const actions: Action[] = []
    const weights: number[] = []
    const push = (a2: Action, w: number) => {
      if (w > 0.01) {
        actions.push(a2)
        weights.push(w)
      }
    }

    const isGK = p.role === 'GK'

    // tir
    if (!isGK && (dGoal < 25 || (dGoal < 32 && pi?.instruction === 'shoot_more'))) {
      const offCenter = Math.abs(carrier.y - goal.y)
      const angleF = 1 - Math.min(offCenter / 28, 1) * 0.6
      const rangeF = Math.pow((25 - Math.min(dGoal, 25)) / 25, 2.2)
      let w = rangeF * (0.9 + a.shooting / 70) * angleF * 0.062
      w *= 0.7 + (a.composure / 99) * 0.6 // le sang-froid conclut
      if (dGoal < 16) w *= 1.9 // dans la surface : le tir est le choix par défaut
      if (dGoal < 11) w *= 1.3 // très proche : on arme
      // situation franche : réellement seul à moins de 11 m — on frappe.
      if (dGoal < 11 && pressure < 0.7) w = Math.max(w, 0.5)
      w /= 1 + Math.max(pressure - 1.2, 0) * 0.5 // pressé à plusieurs : plus difficile
      if (pi?.instruction === 'shoot_more') w *= 2.2
      w *= 0.7 + MENTALITY_LEVEL[ti.mentality] * 0.12
      push({ kind: 'shoot' }, w)
    }

    // dribble
    if (!isGK) {
      let w = (0.7 + a.technique / 60 + a.pace / 150) / (1 + pressure * 0.8)
      if (pi?.instruction === 'cut_inside') w *= 1.35
      if (dGoal < 50) w *= 1.2
      if (pressure > 1.5) w *= 0.35
      push({ kind: 'dribble' }, w)
    }

    // passes
    const tempoFast = ti.tempo === 'rapide'
    const shortBias = (pi?.instruction === 'short_passes' ? 1.3 : 1) * (tempoFast ? 1.15 : 1)
    const longBias =
      (pi?.instruction === 'long_passes' ? 1.6 : 1) * (ti.tempo === 'rapide' ? 1.5 : ti.tempo === 'lent' ? 0.55 : 1)

    for (const mate of Object.values(st.players)) {
      if (!mate.onPitch || mate.side !== carrier.side || mate.id === carrier.id) continue
      const mateP = this.player(mate.id)
      if (mateP.role === 'GK' && !isGK) continue // pas de passe en retrait vers le gardien en MVP
      const d = dist(carrier.x, carrier.y, mate.x, mate.y)
      if (d > 55 || d < 2) continue
      const gain = clamp((this.progression(mate, goal) - this.progression(carrier, goal)) / 60, -1, 1)
      const openness = this.pressureOn(mate.id)
      if (d <= 22) {
        push({ kind: 'pass', targetId: mate.id, long: false }, (1.0 + gain * 1.1) * (0.5 + 1 / (1 + openness * 2)) * shortBias)
      } else {
        push({ kind: 'pass', targetId: mate.id, long: true }, (0.45 + gain * 1.0) * (0.3 + 1 / (1 + openness * 2)) * longBias)
      }
    }

    // le gardien n'a pas d'autres options que la passe
    if (isGK) {
      push({ kind: 'dribble' }, 0.01) // poids quasi nul : évite une liste vide si aucune passe dispo
    }

    const idx = this.rng.weighted(weights)
    const action = actions[idx] ?? { kind: 'dribble' as const }

    if (action.kind === 'shoot') {
      this.startShot(carrier)
    } else if (action.kind === 'pass') {
      this.startPass(carrier, action.targetId, action.long)
    } else {
      // dribble : le porteur avance réellement vers le but (pas d'immobilité)
      const goal = this.attackedGoal(carrier.side)
      const gd = Math.max(dist(carrier.x, carrier.y, goal.x, goal.y), 1)
      const adv = this.rng.range(2, 3.5)
      this.sliceTargets.set(carrier.id, {
        x: clamp(carrier.x + ((goal.x - carrier.x) / gd) * adv + this.rng.range(-1.5, 1.5), 0.5, PITCH.L - 0.5),
        y: clamp(carrier.y + ((goal.y - carrier.y) / gd) * adv + this.rng.range(-1.5, 1.5), 0.5, PITCH.W - 0.5),
      })
    }

    // décisions un peu plus rapides dans le dernier tiers, plus vives sous pression
    let baseInterval = this.rng.range(16, 30) * TEMPO_DECISION[ti.tempo]
    if (dGoal < 35) baseInterval *= 0.85
    if (pressure > 0.8) baseInterval *= 0.75
    this.nextDecisionTick = st.tick + Math.max(6, Math.round(baseInterval))
  }

  private progression(lp: LivePlayer, goal: { x: number; y: number }): number {
    return PITCH.L - dist(lp.x, lp.y, goal.x, goal.y)
  }

  private startPass(carrier: LivePlayer, targetId: string, long: boolean) {
    const st = this.state
    const p = this.player(carrier.id)
    const receiver = st.players[targetId]
    const d = dist(carrier.x, carrier.y, receiver.x, receiver.y)
    const pressPasser = this.pressureOn(carrier.id)
    const pressReceiver = this.pressureOn(targetId)

    let prob =
      0.95 -
      d * (long ? 0.0048 : 0.006) -
      pressReceiver * 0.055 -
      pressPasser * 0.04 +
      ((p.attributes.passing - 50) / 99) * 0.3 -
      (long ? 0.07 : 0) -
      (1 - staminaFactor(carrier.stamina)) * 0.5
    prob = clamp(prob, 0.15, 0.97)

    const success = this.rng.chance(prob)
    const offside = this.checkOffside(carrier.side, receiver)
    this.lastTouchSide = carrier.side

    // interception sur la trajectoire : un adversaire sur la ligne de passe
    // peut couper le ballon (les longs ballons passent au-dessus de la
    // première ligne — approximation de l'arc sans axe z)
    let rawX = this.rng.range(-2, 2) * 0.4
    let rawY = this.rng.range(-2, 2) * 0.4
    if (!success) {
      // passe ratée : la déviation pousse vers l'extérieur près des lignes
      rawX = this.rng.range(-2, 2) * 3
      rawY = this.rng.range(-2, 2) * 4
      if (receiver.y < 20) rawY -= this.rng.range(4, 15)
      else if (receiver.y > PITCH.W - 20) rawY += this.rng.range(4, 15)
      if (receiver.x < 12) rawX -= this.rng.range(1, 5)
      else if (receiver.x > PITCH.L - 12) rawX += this.rng.range(1, 5)
    }
    // une passe réussie reste dans le terrain ; une passe ratée peut sortir
    const limX: [number, number] = success ? [1, PITCH.L - 1] : [-5, PITCH.L + 5]
    const limY: [number, number] = success ? [1, PITCH.W - 1] : [-5, PITCH.W + 5]
    const toX = clamp(receiver.x + rawX, limX[0], limX[1])
    const toY = clamp(receiver.y + rawY, limY[0], limY[1])
    const linePick = this.pickLineInterceptor(carrier, toX, toY, long, targetId)
    const lineIntercepted = success && !offside && linePick !== null && this.rng.chance(linePick.prob)

    carrier.stats.passes++
    this.tms(carrier.side).stats.passes++
    if (success && !offside && !lineIntercepted) {
      carrier.stats.passesOk++
      this.tms(carrier.side).stats.passesOk++
      this.bumpRating(carrier.id, RATING.passOk)
    } else {
      this.bumpRating(carrier.id, RATING.passFailed)
    }

    const speed = long ? PASS_SPEED.long : PASS_SPEED.short
    const duration = Math.max(2, Math.round((d / speed) /TICK_SEC))

    st.ball.carrierId = null
    st.ball.transit = {
      // départ = position réelle du ballon aux pieds (0,8 m devant le passeur)
      fromX: st.ball.x,
      fromY: st.ball.y,
      toX: lineIntercepted ? linePick!.player.x : toX,
      toY: lineIntercepted ? linePick!.player.y : toY,
      startTick: st.tick,
      endTick: lineIntercepted ? st.tick + Math.max(2, Math.round((dist(carrier.x, carrier.y, linePick!.player.x, linePick!.player.y) / speed) / TICK_SEC)) : st.tick + duration,
      kind: 'pass',
      intendedReceiverId: targetId,
      success: success && !offside && !lineIntercepted,
      offside,
      interceptedById: lineIntercepted ? linePick!.player.id : undefined,
    }
    if (success && !offside && !lineIntercepted) this.lastKicker = carrier.id
  }

  /**
   * Cherche l'adversaire le plus dangereux sur la trajectoire d'une passe.
   * Probabilité de coupe selon la proximité à la ligne et les attributs
   * (vivacité, décisions) ; les longs ballons sont moins coupables (arc).
   */
  /**
   * Défenseur qui se jette dans la trajectoire du tir, s'il y en a un. Même
   * géométrie de couloir que `pickLineInterceptor`, mais un tir ne laisse pas
   * le temps de venir se placer : le défenseur doit déjà être sur la ligne, et
   * le contre se tente d'autant mieux qu'il est près du tireur.
   */
  private pickShotBlocker(shooter: LivePlayer, goalX: number, goalY: number): LivePlayer | null {
    const st = this.state
    const oppSide: Side = shooter.side === 'home' ? 'away' : 'home'
    const vx = goalX - shooter.x
    const vy = goalY - shooter.y
    const len2 = vx * vx + vy * vy
    if (len2 < 4) return null
    let best: { player: LivePlayer; prob: number } | null = null
    for (const o of Object.values(st.players)) {
      if (!o.onPitch || o.side !== oppSide) continue
      if (this.player(o.id).role === 'GK') continue // l'arrêt du gardien est résolu à part
      const t = ((o.x - shooter.x) * vx + (o.y - shooter.y) * vy) / len2
      if (t <= 0 || t > 1) continue
      const perp = dist(o.x, o.y, shooter.x + vx * t, shooter.y + vy * t)
      if (perp > BLOCK_REACH_M) continue
      const prob = (1 - perp / BLOCK_REACH_M) * BLOCK_BASE * clamp(1 - t, 0.15, 1)
      if (prob > (best?.prob ?? 0)) best = { player: o, prob }
    }
    return best !== null && this.rng.chance(best.prob) ? best.player : null
  }

  private pickLineInterceptor(
    passer: LivePlayer,
    toX: number,
    toY: number,
    long: boolean,
    _receiverId: string,
  ): { player: LivePlayer; prob: number } | null {
    const st = this.state
    const oppSide: Side = passer.side === 'home' ? 'away' : 'home'
    const vx = toX - passer.x
    const vy = toY - passer.y
    const len2 = vx * vx + vy * vy
    if (len2 < 4) return null
    const reach = 1.25
    const len = Math.sqrt(len2)
    const speed = long ? PASS_SPEED.long : PASS_SPEED.short
    let best: { player: LivePlayer; prob: number } | null = null
    for (const o of Object.values(st.players)) {
      if (!o.onPitch || o.side !== oppSide) continue
      const t = ((o.x - passer.x) * vx + (o.y - passer.y) * vy) / len2
      if (t < 0.12 || t > 0.88) continue // hors de la zone utile du segment
      const px = passer.x + vx * t
      const py = passer.y + vy * t
      const perp = dist(o.x, o.y, px, py)
      if (perp > reach) continue
      // Le défenseur doit atteindre la ligne avant le ballon. Sans ce terme la
      // probabilité ne dépendait que de la distance au couloir : un joueur
      // immobile coupait une passe tendue aussi souvent qu'un ballon lent, et
      // le moteur cadrait ~5 % des passes coupées contre ~2,8 % en vrai.
      const travel = (len * t) / speed
      const need = INTERCEPT_REACTION_S + perp / INTERCEPT_CLOSING_MS
      if (need >= travel) continue // le ballon est déjà passé
      const a = this.player(o.id).attributes
      let prob = (1 - need / travel) * (0.32 + ((a.agility + a.decisions) / 2 / 99) * 0.5)
      if (long) prob *= 0.45 // le ballon passe au-dessus de la première ligne
      if (prob > (best?.prob ?? 0)) best = { player: o, prob }
    }
    return best
  }

  private lastKicker: string | null = null

  private startShot(carrier: LivePlayer) {
    const st = this.state
    const p = this.player(carrier.id)
    const goal = this.attackedGoal(carrier.side)
    const d = dist(carrier.x, carrier.y, goal.x, goal.y)
    const defSide: Side = carrier.side === 'home' ? 'away' : 'home'
    const keeper = this.keeperOf(defSide)
    const gkAttr = keeper ? this.player(keeper.id).attributes.goalkeeper : 50

    const offCenter = Math.abs(carrier.y - goal.y)
    const angleF = 1 - Math.min(offCenter / 30, 1) * 0.55

    // résolution en deux étapes (modèle type OFM) :
    // 1) la frappe est-elle cadrée ? 2) cadrée, entre-t-elle ?
    const mental = (p.attributes.shooting + p.attributes.composure + p.attributes.decisions) / 3
    let onTarget = clamp(SHOT_ON_TARGET_BASE + ((mental - 50) / 99) * SHOT_ON_TARGET_SLOPE, 0.15, 0.85)
    onTarget *= clamp(1.05 - d / 35, 0.35, 1) * angleF // loin et/ou angle fermé : plus dur
    onTarget = clamp(onTarget, 0.08, 0.8)

    // un défenseur sur la trajectoire contre avant que la précision compte
    const blocker = this.pickShotBlocker(carrier, goal.x, goal.y)
    let outcome: BallTransit['shotOutcome']
    if (blocker) {
      outcome = 'blocked'
    } else if (this.rng.chance(onTarget)) {
      let conv = SHOT_CONV_BASE + (p.attributes.shooting - gkAttr) / SHOT_CONV_SPREAD
      if (d < 11) conv *= 1.25 // très proche du but
      conv = clamp(conv, 0.08, 0.55)
      if (this.rng.chance(conv)) outcome = 'goal'
      else outcome = this.rng.chance(0.85) ? 'save' : 'blocked'
    } else {
      outcome = 'off_target'
    }

    carrier.stats.shots++
    this.tms(carrier.side).stats.shots++
    if (outcome === 'goal' || outcome === 'save') this.tms(carrier.side).stats.shotsOnTarget++
    this.bumpRating(
      carrier.id,
      outcome === 'goal' ? 0 : outcome === 'save' ? RATING.shotSaved : RATING.shotMissed,
    )
    this.lastTouchSide = carrier.side

    if (blocker) {
      this.log(
        'block',
        `Contré ! ${this.nameOf(blocker.id)} se jette devant la frappe de ${this.nameOf(carrier.id)}.`,
        blocker.side,
        blocker.id,
        blocker.x,
        blocker.y,
      )
    }

    const tx = blocker
      ? blocker.x
      : outcome === 'off_target'
        ? goal.x + this.rng.range(-4, 4) * (goal.x === PITCH.L ? -1 : 1)
        : goal.x
    const ty = blocker
      ? blocker.y
      : outcome === 'off_target'
        ? goal.y + this.rng.range(6, 12) * (this.rng.chance(0.5) ? 1 : -1)
        : goal.y
    const duration = Math.max(2, Math.round(d / 24 / TICK_SEC))

    st.ball.carrierId = null
    st.ball.transit = {
      fromX: st.ball.x,
      fromY: st.ball.y,
      toX: clamp(tx, 0, PITCH.L),
      toY: clamp(ty, -2, PITCH.W + 2),
      startTick: st.tick,
      endTick: st.tick + duration,
      kind: 'shot',
      success: outcome !== 'off_target',
      shotOutcome: outcome,
      shooterId: carrier.id,
      assistCandidateId: this.lastPasserId && this.lastPasserId !== carrier.id ? this.lastPasserId : undefined,
    }
    this.log('shot', `${this.nameOf(carrier.id)} tente sa chance !`, carrier.side, carrier.id, carrier.x, carrier.y)
    this.lastPasserId = null
    this.lastKicker = null
  }

  private tryTackle(carrier: LivePlayer) {
    const st = this.state
    const carrierP = this.player(carrier.id)
    const oppSide: Side = carrier.side === 'home' ? 'away' : 'home'
    const oppTms = this.tms(oppSide)
    const pressF = PRESS_FACTOR[oppTms.instructions.team.pressing]

    // défenseur le plus proche + soutien éventuel
    let first: LivePlayer | null = null
    let firstD = Infinity
    let support = 0
    for (const o of Object.values(st.players)) {
      if (!o.onPitch || o.side !== oppSide) continue
      const d = dist(o.x, o.y, carrier.x, carrier.y)
      if (d < firstD) {
        firstD = d
        first = o
      } else if (d < 4) support++
    }
    if (!first || firstD > 2.6) return

    const defP = this.player(first.id)
    let p =
      (0.006 + (defP.attributes.tackling / 99) * 0.01) *
      pressF *
      (1.15 - (carrierP.attributes.agility / 99) * 0.6) *
      (1 + support * 0.3) /
      (1 + (carrierP.attributes.technique / 99) * 0.5)
    p *= staminaFactor(first.stamina) * DUEL_RATE
    if (!this.rng.chance(p)) return

    // Tentative de tacle. Une faute ne pouvait être sifflée QUE sur un tacle
    // réussi : un tacle manqué renvoyait immédiatement, et l'attaquant passait
    // sans que rien ne se produise. C'est l'inverse d'un terrain — le tacle mal
    // ajusté est la première source de fautes, et le moteur ne sifflait que
    // 7,5 fautes par match contre ~22.
    const clean = this.rng.chance(0.68)

    // faute : modulée par l'agressivité du tacleur et la sévérité de l'arbitre
    const foulProb =
      (clean ? FOUL_ON_TACKLE : FOUL_ON_MISSED) *
      (0.6 + (defP.attributes.aggression / 99) * 0.8) *
      st.refereeStrictness *
      // un joueur déjà averti retient son tacle : sans ça, les fautes se
      // concentraient sur les mêmes joueurs agressifs et le second jaune
      // tombait quatre fois trop souvent
      (first.yellowCards > 0 ? BOOKED_CAUTION : 1)
    if (this.rng.chance(foulProb)) {
      oppTms.stats.fouls++
      first.stats.fouls++
      this.bumpRating(first.id, RATING.foul)
      this.log('foul', `Faute de ${this.nameOf(first.id)} sur ${this.nameOf(carrier.id)}.`, oppSide, first.id, carrier.x, carrier.y)

      // le fauté encaisse le contact : première source de blessure en vrai
      if (this.rng.chance(INJURY_ON_FOUL)) this.injure(carrier.side, carrier.id, 'contact')

      // faute dans la surface de réparation → penalty ?
      const goal = this.attackedGoal(carrier.side)
      const inBox = Math.abs(carrier.x - goal.x) < 16.5 && Math.abs(carrier.y - PITCH.W / 2) < 20.16
      if (inBox && this.rng.chance(0.022)) {
        this.awardPenalty(carrier.side)
        return
      }

      // cartons : faute cartonnable (~13 %), dont 2 % de rouges directs
      if (this.rng.chance(0.13 * st.refereeStrictness)) {
        if (this.rng.chance(0.02)) {
          this.sendOff(oppSide, first.id, 'direct')
          return
        }
        first.yellowCards++
        oppTms.stats.yellowCards++
        this.bumpRating(first.id, RATING.yellowCard)
        this.log('yellow_card', `🟨 Carton jaune pour ${this.nameOf(first.id)}.`, oppSide, first.id)
        if (first.yellowCards >= 2) {
          this.sendOff(oppSide, first.id, 'second_yellow')
          return
        }
      }

      // coup franc : possession conservée, petit temps de repli
      this.markSetPieceIfDangerous(carrier.side, STOPPAGE_S.freeKick, carrier.x, carrier.y)
      // le fauté a pu quitter le terrain entre-temps (blessure + remplacement
      // forcé juste au-dessus, qui l'a déjà remplacé) : le tireur doit être un
      // joueur réellement sur la pelouse, jamais le fantôme qu'on vient de sortir.
      const taker = carrier.onPitch ? carrier : this.nearestTo(carrier.x, carrier.y, carrier.side)
      st.ball.carrierId = taker?.id ?? null
      st.possession = carrier.side
      this.freezeUntilTick = st.tick + ticks(STOPPAGE_S.freeKick)
      this.restartExemptUntilTick = st.tick + 40
      this.nextDecisionTick = st.tick + 12
      return
    }

    if (!clean) return // tacle manqué et rien de sifflé : l'attaquant passe

    // tacle gagnant
    first.stats.tackles++
    this.bumpRating(first.id, RATING.tackleWon)
    this.bumpRating(carrier.id, RATING.dispossessed)
    this.log('tackle', `Beau tacle de ${this.nameOf(first.id)} !`, oppSide, first.id)
    if (this.rng.chance(INJURY_ON_CLEAN_TACKLE)) this.injure(carrier.side, carrier.id, 'contact')
    this.lastPasserId = null

    // un tacle sur deux environ chasse le ballon hors du terrain plutôt que de
    // le laisser au tacleur : c'est la première source de touches d'un vrai
    // match, et le moteur n'en produisait aucune
    if (this.rng.chance(DUEL_OUT_TACKLE)) {
      st.ball.carrierId = null
      this.lastTouchSide = first.side
      this.knockOut(first.side, carrier.x, carrier.y)
      return
    }

    st.ball.carrierId = first.id
    st.possession = first.side
    this.lastTouchSide = first.side
    first.stats.touches++
    this.nextDecisionTick = st.tick + 5
  }

  // -----------------------------------------------------------------------
  // Déplacement & endurance
  // -----------------------------------------------------------------------

  private movePlayers() {
    const st = this.state
    const deadBall = st.tick < this.freezeUntilTick
    this.updatePhaseAndPressers()

    // changement de camp : les comportements choisis n'ont plus de sens
    if (st.possession !== this.lastSlicePossession) {
      this.lastSlicePossession = st.possession
      if (this.setPieceChain && this.setPieceChain.side !== st.possession) {
        this.setPieceChain = null // le ballon a changé de camp : chaîne rompue
      }
      this.sliceTargets.clear()
      this.runEpisodes.clear() // on perd le ballon : les appels tombent
    }
    // nouveau porteur : sa cible hors-ballon est périmée
    if (st.ball.carrierId !== this.lastCarrierId) {
      if (st.ball.carrierId) this.sliceTargets.delete(st.ball.carrierId)
      this.lastCarrierId = st.ball.carrierId
    }

    if (st.tick % 5 === 0) {
      for (const lp of Object.values(st.players)) {
        if (!lp.onPitch) continue
        this.wander.set(lp.id, { dx: this.rng.range(-1.2, 1.2), dy: this.rng.range(-1.2, 1.2) })
      }
    }

    for (const lp of Object.values(st.players)) {
      if (!lp.onPitch) continue
      lp.prevX = lp.x
      lp.prevY = lp.y

      const p = this.player(lp.id)

      // slice (micro-décision) échelonnée : un tiers des joueurs par tick
      const slotIdx = this.tms(lp.side).lineup.indexOf(lp.id)
      if (
        p.role !== 'GK' &&
        st.ball.carrierId !== lp.id &&
        st.tick % 3 === slotIdx % 3
      ) {
        this.evaluateSlice(lp)
      }

      // anticipation : le joueur désigné d'une balle en mouvement court au
      // point de chute fixe — c'est le joueur qui va à la balle, jamais
      // l'inverse (fini la balle aimantée qui vire vers son receveur)
      const transit = st.ball.transit
      const awaited =
        transit &&
        transit.intendedReceiverId === lp.id &&
        p.role !== 'GK' &&
        (transit.kind === 'clearance' ||
          (transit.kind === 'pass' && transit.success && !transit.offside && !transit.interceptedById))
          ? { x: transit.toX, y: transit.toY }
          : null

      // remise en jeu : le tireur va chercher le ballon posé sur le point au
      // lieu de tenir son poste — c'est lui qui bouge, la balle ne bouge plus
      const restart = deadBall && st.ball.carrierId === lp.id ? { x: st.ball.x, y: st.ball.y } : null

      const tgt =
        restart ??
        awaited ??
        (p.role !== 'GK' && this.sliceTargets.has(lp.id)
          ? this.sliceTargets.get(lp.id)!
          : this.targetFor(lp))
      const d = dist(lp.x, lp.y, tgt.x, tgt.y)
      const knocked = lp.injury === 'knock'
      const vmaxFull = maxSpeed(p.attributes.pace, lp.stamina) * (knocked ? INJURY_SPEED_MUL : 1)
      const isCarrier = st.ball.carrierId === lp.id
      // zone morte : à son poste, on tient sa position (arrête le papillonnage)
      const deadZone = restart
        ? 0.4 // sur le ballon, au mètre : c'est de là que part la remise en jeu
        : awaited
        ? 0.4 // au point de chute, au mètre
        : p.role === 'GK'
          ? 2.5 // le gardien se replace par paliers, il ne suit pas le ballon au mètre
          : lp.behavior === 'close_down' || lp.behavior === 'mark_man'
            ? 0.8 // le presseur doit arriver à portée de tacle
            : lp.behavior === 'run_in_behind'
              ? 0.8 // un appel se joue au mètre : s'arrêter 3,5 m avant la
              // cible revient à tenir sa position — le coureur n'atteint
              // jamais l'épaule du défenseur, et le hors-jeu reste hors
              // d'atteinte quel que soit le reste
              : isCarrier
                ? 1.5
                : 3.5
      const effort = awaited ? 1 : p.role === 'GK' ? 0.4 : this.effortFor(lp, d, isCarrier)
      // ballon mort : on se replace au pas, on ne court pas
      const vmax = deadBall ? DEAD_BALL_WALK_MS : vmaxFull * effort
      let speedRatio = 0
      if (d > deadZone) {
        const step = Math.min(d - deadZone * 0.5, vmax * TICK_SEC)
        lp.x += ((tgt.x - lp.x) / d) * step
        lp.y += ((tgt.y - lp.y) / d) * step
        lp.stats.distance += step
        // rapporté à la vitesse max RÉELLE : courir à 60 % coûte moins cher
        speedRatio = step / (vmaxFull * TICK_SEC)
        // seuils absolus (m/s), pas relatifs : un joueur lent à fond n'est pas
        // en sprint au sens de l'analyse de match
        const mps = step / TICK_SEC
        if (mps > SPRINT_WALK) {
          lp.stats.runningTicks++
          if (mps > SPRINT_SPEED) {
            lp.stats.sprintTicks++
            // lésion musculaire : le risque n'existe que sur des jambes déjà
            // entamées, et croît à mesure que la fraîcheur tombe
            if (lp.stamina < INJURY_FATIGUE_FROM) {
              const fatigue = (INJURY_FATIGUE_FROM - lp.stamina) / INJURY_FATIGUE_FROM
              if (this.rng.chance(INJURY_SPRINT_BASE * fatigue)) this.injure(lp.side, lp.id, 'muscle')
            }
          }
        }
      }

      // une lésion musculaire vient peut-être de le sortir : plus de fatigue à
      // mettre à jour, et surtout plus de « jambes lourdes » juste après
      // « il ne peut pas continuer »
      if (!lp.onPitch) continue

      const tms = this.tms(lp.side)
      const ti = tms.instructions.team
      const pi = this.instrFor(tms, lp.id)
      const attacking = st.possession === lp.side
      const extraWork =
        (attacking && pi?.instruction === 'overlap') ||
        (!attacking && (pi?.instruction === 'man_mark' || ti.pressing === 'haut'))
      const before = lp.stamina
      updateStamina(
        lp,
        TICK_SEC,
        {
          speedRatio,
          pressing: ti.pressing,
          tempo: ti.tempo,
          extraWork,
          intensityElevee: pi?.intensity === 'elevee',
        },
        knocked ? p.attributes.stamina * INJURY_ENDURANCE_MUL : p.attributes.stamina,
        p.role === 'GK',
      )
      if (!lp.warned40 && lp.stamina < 40 && before >= 40) {
        lp.warned40 = true
        this.log('stamina_low', `${p.name} a les jambes lourdes…`, lp.side, lp.id)
      }
      if (!lp.warned20 && lp.stamina < 20 && before >= 20) {
        lp.warned20 = true
        this.log('stamina_low', `${p.name} est au bout du rouleau !`, lp.side, lp.id)
      }
    }
  }

  /**
   * Phase attaque/défense lissée par côté (transitions visibles), rang des
   * pressemens (les deux joueurs de champ les plus proches du ballon) et
   * ligne de hors-jeu par camp attaquant.
   */
  private updatePhaseAndPressers() {
    const st = this.state
    for (const side of ['home', 'away'] as const) {
      const target = st.possession === side ? 1 : 0
      const cur = this.phase.get(side) ?? 0.5
      this.phase.set(side, cur + (target - cur) * 0.04)
    }
    this.presserRanks.clear()
    for (const side of ['home', 'away'] as const) {
      if (st.possession === side) continue
      const ballTs = this.toTeamSpace(side, st.ball.x, st.ball.y)
      // près de son but, un troisième défenseur vient aider
      const maxRank = ballTs.tx < 0.3 ? 3 : 2
      const cands = Object.values(st.players)
        .filter((lp) => lp.onPitch && lp.side === side && this.player(lp.id).role !== 'GK')
        .sort(
          (a, b) =>
            dist(a.x, a.y, st.ball.x, st.ball.y) - dist(b.x, b.y, st.ball.x, st.ball.y),
        )
      for (let r = 0; r < maxRank; r++) {
        if (cands[r]) this.presserRanks.set(cands[r].id, r as 0 | 1 | 2)
      }
    }

    // ligne de hors-jeu pour chaque camp attaquant = position de l'avant-dernier
    // défenseur adverse (gardien inclus), convertie dans l'espace de l'attaquant
    for (const side of ['home', 'away'] as const) {
      const other: Side = side === 'home' ? 'away' : 'home'
      const txs = Object.values(st.players)
        .filter((lp) => lp.onPitch && lp.side === other)
        .map((lp) => this.toTeamSpace(other, lp.x, lp.y).tx)
        .sort((a, b) => a - b)
      const lineDef = txs.length >= 2 ? txs[1] : 0.15
      this.offsideLine.set(side, 1 - lineDef)
    }
  }

  /** Ouvre une chaîne de phase arrêtée au profit de `side`. */
  /**
   * Une remise en jeu n'ouvre une chaîne de phase arrêtée que si elle part
   * assez près du but adverse. Un coup franc dans son propre camp ou une
   * touche au milieu ne comptent pas comme phase arrêtée dans les statistiques
   * réelles — les compter faisait grimper la part de buts sur phase arrêtée à
   * 38 % dès que l'arbitre sifflait un nombre réaliste de fautes.
   */
  private markSetPieceIfDangerous(side: Side, stoppageS: number, x: number, y: number) {
    if (this.toTeamSpace(side, x, y).tx < SET_PIECE_DANGER_TX) return
    this.markSetPiece(side, stoppageS)
  }

  private markSetPiece(side: Side, stoppageS: number) {
    // la fenêtre court sur le jeu VIVANT qui suit la reprise : comptée depuis
    // l'arrêt, un arrêt long la consommerait entièrement et aucun but ne serait
    // jamais imputé à la phase arrêtée
    const untilTick = this.state.tick + ticks(stoppageS) + SET_PIECE_CHAIN_TICKS
    this.setPieceChain = { side, untilTick }
  }

  /** Le but qui vient d'être marqué vient-il d'une phase arrêtée ? */
  private isSetPieceGoal(scoringSide: Side): boolean {
    const c = this.setPieceChain
    return c !== null && c.side === scoringSide && this.state.tick < c.untilTick
  }

  /** Le récepteur est-il hors-jeu AU MOMENT de la passe ? */
  private checkOffside(side: Side, receiver: LivePlayer): boolean {
    if (this.state.tick < this.restartExemptUntilTick) return false
    const r = this.toTeamSpace(side, receiver.x, receiver.y)
    if (r.tx <= 0.5) return false // hors-jeu uniquement dans le camp adverse
    const b = this.toTeamSpace(side, this.state.ball.x, this.state.ball.y)
    if (r.tx <= b.tx + 0.005) return false // pas devant le ballon
    const line = this.offsideLine.get(side) ?? 0.9
    // Tolérance d'environ 20 cm au-delà de l'avant-dernier défenseur. Elle
    // était de 0,03, soit 3,15 m : un attaquant devait dépasser d'une longueur
    // de voiture pour être signalé, et l'arbitre ne sifflait que 0,5 hors-jeu
    // par match contre ~4 en vrai. La règle réelle se joue au centimètre ; ce
    // qu'il reste ici n'est pas une marge d'arbitrage mais l'épaisseur d'un
    // corps, que le moteur réduit à un point.
    return r.tx > line + 0.002
  }

  /** Micro-décision façon FM : choix pondéré d'un comportement, cible en terrain. */
  private evaluateSlice(lp: LivePlayer) {
    const st = this.state
    const tms = this.tms(lp.side)
    const p = this.player(lp.id)
    if (p.role === 'GK') return
    // la famille de comportements suit la possession RÉELLE, pas la phase
    // lissée — sinon les duels qui clignotent devant le but figent tout le
    // monde en zone de transition et personne ne presse plus
    const attackingNow = st.possession === lp.side
    const base = this.formulaTargetTs(lp)
    const ballTs = this.toTeamSpace(lp.side, st.ball.x, st.ball.y)
    const pTs = this.toTeamSpace(lp.side, lp.x, lp.y)
    const pi = this.instrFor(tms, lp.id)
    const slots = FORMATION_SLOTS[tms.instructions.team.formation]
    const slotIdx = tms.lineup.indexOf(lp.id)
    const slot = slots[slotIdx >= 0 ? slotIdx : 0]

    if (attackingNow) {
      const running = this.runEpisodes.get(lp.id)
      const inRun = running !== undefined && st.tick < running.untilTick
      const inp: AttackSliceInput = {
        attrs: p.attributes,
        role: slot.role,
        ti: tms.instructions.team,
        pi,
        playerTx: pTs.tx,
        playerTy: pTs.ty,
        ballTx: ballTs.tx,
        ballTy: ballTs.ty,
        offsideLineTx: this.offsideLine.get(lp.side) ?? 0.9,
        runGamble: inRun ? running!.gamble : false,
        phaseBlend: clamp(this.phase.get(lp.side) ?? 0.5, 0, 1),
        minute: this.minute(),
        goalDiff:
          st.score[lp.side] - st.score[lp.side === 'home' ? 'away' : 'home'],
        stamina: lp.stamina,
      }
      let behavior: AttBehavior
      if (inRun) {
        // course engagée : on ne rejoue pas les dés avant la fin de l'appel
        behavior = 'run_in_behind'
      } else {
        this.runEpisodes.delete(lp.id)
        const weights = attackWeights(inp)
        behavior = weights[this.rng.weighted(weights.map((w) => w.weight))].behavior
        if (behavior === 'run_in_behind') {
          // un appel s'ouvre : sa durée et son timing sont figés maintenant.
          // Plus le joueur décide mal, plus il part tôt et se retrouve devant
          // la ligne au moment où la passe est jouée.
          const gamble = this.rng.chance(RUN_MISTIME_MAX * (1 - p.attributes.decisions / 99))
          this.runEpisodes.set(lp.id, {
            untilTick: st.tick + Math.round(this.rng.range(12, 26)),
            gamble,
          })
          inp.runGamble = gamble
        }
      }
      lp.behavior = behavior
      const t = attackTarget(behavior, inp, base.tx, base.ty)
      const pos = this.toPitch(lp.side, t.tx, t.ty)
      this.sliceTargets.set(lp.id, {
        x: clamp(pos.x, 0.5, PITCH.L - 0.5),
        y: clamp(pos.y, 0.5, PITCH.W - 0.5),
      })
    } else {
      // plus proche attaquant adverse (espace défenseur)
      const oppSide: Side = lp.side === 'home' ? 'away' : 'home'
      let nearest: { tx: number; ty: number } | null = null
      let nearestD = Infinity
      for (const o of Object.values(st.players)) {
        if (!o.onPitch || o.side !== oppSide || this.player(o.id).role === 'GK') continue
        const d = dist(o.x, o.y, lp.x, lp.y)
        if (d < nearestD) {
          nearestD = d
          nearest = this.toTeamSpace(lp.side, o.x, o.y)
        }
      }
      const inp: DefenseSliceInput = {
        attrs: p.attributes,
        role: slot.role,
        ti: tms.instructions.team,
        pi,
        playerTx: pTs.tx,
        playerTy: pTs.ty,
        ballTx: ballTs.tx,
        ballTy: ballTs.ty,
        presserRank: this.presserRanks.get(lp.id),
        nearestAttackerDist: nearestD,
      }
      const weights = defenseWeights(inp)
      const chosen = weights[this.rng.weighted(weights.map((w) => w.weight))]
      lp.behavior = chosen.behavior
      const t = defenseTarget(chosen.behavior, inp, base.tx, base.ty, nearest)
      const pos = this.toPitch(lp.side, t.tx, t.ty)
      this.sliceTargets.set(lp.id, {
        x: clamp(pos.x, 0.5, PITCH.L - 0.5),
        y: clamp(pos.y, 0.5, PITCH.W - 0.5),
      })
    }
  }

  /**
   * Cible de positionnement par la formule (espace équipe), sans le gardien.
   * Sert de comportement neutre (hold_position / hold_shape) aux slices.
   */
  private formulaTargetTs(lp: LivePlayer): { tx: number; ty: number } {
    const st = this.state
    const tms = this.tms(lp.side)
    const ti = tms.instructions.team
    const pi = this.instrFor(tms, lp.id)
    const slotIdx = tms.lineup.indexOf(lp.id)
    const p = this.player(lp.id)
    const ballTs = this.smoothBall(lp.side)
    // phase lissée : 1 = en attaque, 0 = en défense, transition sur ~2,5 s
    const ab = clamp(this.phase.get(lp.side) ?? 0.5, 0, 1)

    const slots: Slot[] = FORMATION_SLOTS[ti.formation]
    const slot = slots[slotIdx >= 0 ? slotIdx : 0]

    // planchers (défense) et plafonds (attaque) par rôle : le bloc ne colle
    // jamais aux filets, les attaquants ne dépassent pas la surface adverse.
    const FLOOR: Record<string, number> = { DF: 0.05, MD: 0.16, AT: 0.28 }
    const CAP: Record<string, number> = { DF: 0.75, MD: 0.8, AT: 0.88 }

    const followDef: Record<string, number> = { bas: 0.42, moyen: 0.58, haut: 0.72 }
    const lateral = slot.role === 'DF' ? 0.35 : slot.role === 'MD' ? 0.3 : 0.15

    // --- composante ATTAQUE (bloc qui monte avec le ballon) ---
    const rolePush = slot.role === 'DF' ? 0.55 : slot.role === 'MD' ? 0.9 : 1.15
    let push = (0.16 + MENTALITY_PUSH[ti.mentality] * 1.6) * rolePush
    if (pi?.instruction === 'stay_back') push *= 0.15
    let attTx = slot.x + (ballTs.tx - 0.5) * 0.45 + push + 0.04
    if (pi?.instruction === 'overlap') attTx += pi.intensity === 'elevee' ? 0.26 : 0.19
    attTx = Math.min(attTx, CAP[slot.role])

    // --- composante DÉFENSE (bloc qui décroît vers sa surface) ---
    let defTx = slot.x + (ballTs.tx - 0.5) * followDef[ti.pressing] - 0.04 + LINE_X[ti.defensiveLine]
    if (pi?.instruction === 'man_mark' && pi.targetPlayerId) {
      const target = st.players[pi.targetPlayerId]
      if (target && target.onPitch) {
        const tts = this.toTeamSpace(lp.side, target.x, target.y)
        defTx = defTx * 0.55 + tts.tx * 0.45
      }
    }
    defTx = Math.max(defTx, FLOOR[slot.role])

    // --- mélange des deux selon la phase (transition visible) ---
    let tx = defTx + (attTx - defTx) * ab
    let ty = slot.y + (ballTs.ty - 0.5) * lateral
    ty = 0.5 + (ty - 0.5) * WIDTH_FACTOR[ti.width]
    if (pi?.instruction === 'overlap') ty = 0.5 + (ty - 0.5) * (1 + 0.55 * ab)
    if (pi?.instruction === 'cut_inside') ty = 0.5 + (ty - 0.5) * (1 - 0.8 * ab)
    if (pi?.instruction === 'free_role') {
      tx = tx * (1 - 0.3 * ab) + ballTs.tx * 0.3 * ab
      ty = ty * (1 - 0.3 * ab) + ballTs.ty * 0.3 * ab
    }
    if (pi?.instruction === 'man_mark' && pi.targetPlayerId && ab < 0.5) {
      const target = st.players[pi.targetPlayerId]
      if (target && target.onPitch) {
        const tts = this.toTeamSpace(lp.side, target.x, target.y)
        const mw = 0.45 * (1 - ab)
        ty = ty * (1 - mw) + tts.ty * mw
      }
    }

    if (st.ball.carrierId === lp.id) tx += 0.06

    // discipline de ligne : en attaque, on joue sur l'épaule du dernier
    // défenseur (~2,5 m) — seuls les appels mal timés sont sifflés
    if (ab > 0.4) {
      const line = this.offsideLine.get(lp.side) ?? 0.95
      tx = Math.min(tx, line + 0.025)
    }
    return { tx: p.role === 'GK' ? 0.03 : tx, ty }
  }

  /**
   * Gestion de l'effort : un joueur ne sprinte pas en permanence.
   * Repositionnement tactique = course légère, action urgente = sprint,
   * cible à portée = on ajuste le pas. Le porteur avance avec le ballon
   * sous contrôle. Cible réaliste : 9-12 km parcourus par match.
   */
  private effortFor(lp: LivePlayer, distToTarget: number, isCarrier: boolean): number {
    let e: number
    switch (lp.behavior) {
      case 'close_down':
      case 'run_in_behind':
      case 'overlap_run':
      case 'attack_box':
        e = 1 // action urgente
        break
      case 'come_short':
      case 'hold_width':
      case 'intercept_lane':
      case 'cover':
      case 'mark_man':
        e = 0.8
        break
      default:
        e = 0.5 // repositionnement
    }
    // Rampe continue sur la distance à couvrir, au lieu des deux marches
    // d'escalier d'avant (< 2 m puis < 5 m). Un joueur ne s'élance pas pour
    // trois mètres : il ne sprinte que s'il a de quoi lancer sa foulée.
    //
    // Baisser les paliers d'effort à la place produit une falaise : la vitesse
    // maximale plafonne à 8,2 m/s pour un joueur rapide, donc un effort de
    // 0,85 la ramène à 6,95, sous le seuil de sprint de 7 m/s — et le ratio de
    // sprint tombe d'un coup de 10,6 % à 0,0 %. La rampe garde les vrais
    // sprints, sur les courses longues, et coupe le reste.
    e *= clamp(EFFORT_RAMP_FLOOR + distToTarget / EFFORT_RAMP_M, EFFORT_RAMP_FLOOR, 1)
    if (isCarrier) e = Math.min(e, 0.8) // balle aux pieds : vitesse contrôlée
    return clamp(e, 0.12, 1)
  }

  private targetFor(lp: LivePlayer): { x: number; y: number } {
    const p = this.player(lp.id)
    const ballTs = this.smoothBall(lp.side)

    if (p.role === 'GK') {
      let tx = 0.03
      if (ballTs.tx > 0.78) tx += Math.min((ballTs.tx - 0.78) * 0.4, 0.06)
      const ty = 0.5 + clamp(ballTs.ty - 0.5, -0.22, 0.22)
      return this.toPitch(lp.side, tx, ty)
    }

    const t = this.formulaTargetTs(lp)
    const w = this.wander.get(lp.id)
    const pos = this.toPitch(lp.side, t.tx, t.ty)
    return {
      x: clamp(pos.x + (w?.dx ?? 0), 0.5, PITCH.L - 0.5),
      y: clamp(pos.y + (w?.dy ?? 0), 0.5, PITCH.W - 0.5),
    }
  }

  /** Position de la balle lissée (espace équipe) : le bloc bouge avec inertie,
   *  comme un vrai bloc défensif, au lieu de vibrer à chaque passe. */
  private smoothBall(side: Side): { tx: number; ty: number } {
    let s = this.smoothed.get(side)
    if (!s) {
      s = { tx: 0.5, ty: 0.5 }
      this.smoothed.set(side, s)
    }
    const b = this.toTeamSpace(side, this.state.ball.x, this.state.ball.y)
    s.tx += (b.tx - s.tx) * 0.025
    s.ty += (b.ty - s.ty) * 0.025
    return s
  }

  // -----------------------------------------------------------------------
  // Resets & phases
  // -----------------------------------------------------------------------

  private resetPositions(kickingSide: Side) {
    const st = this.state
    for (const tms of [st.home, st.away]) {
      const slots = FORMATION_SLOTS[tms.instructions.team.formation]
      tms.lineup.forEach((id, i) => {
        const lp = st.players[id]
        if (!lp.onPitch) return // exclu : le poste reste vacant
        const slot = slots[i]
        const pos = this.toPitch(tms.side, slot.x, slot.y)
        lp.x = pos.x
        lp.y = pos.y
        lp.prevX = pos.x
        lp.prevY = pos.y
      })
    }
    st.ball.x = PITCH.L / 2
    st.ball.y = PITCH.W / 2
    st.ball.prevX = st.ball.x
    st.ball.prevY = st.ball.y
    st.ball.transit = null

    // engagement : un joueur central de l'équipe qui engage
    const takers = Object.values(st.players).filter(
      (lp) => lp.side === kickingSide && lp.onPitch && this.player(lp.id).role !== 'GK',
    )
    let taker = takers[0]
    let best = Infinity
    for (const lp of takers) {
      const d = dist(lp.x, lp.y, PITCH.L / 2, PITCH.W / 2)
      if (d < best) {
        best = d
        taker = lp
      }
    }
    if (taker) {
      taker.x = PITCH.L / 2 - (kickingSide === 'home' ? 1.5 : -1.5)
      taker.y = PITCH.W / 2
      st.ball.carrierId = taker.id
      st.possession = kickingSide
    }
    this.freezeUntilTick = st.tick + ticks(STOPPAGE_S.kickoff)
    this.restartExemptUntilTick = st.tick + 40
    this.nextDecisionTick = st.tick + 18
    this.lastPasserId = null
    this.lastTouchSide = kickingSide
    this.log('kickoff', `Coup d'envoi — ${this.tms(kickingSide).team.short} engage.`, kickingSide)
  }

  /** Fin de période : pause, ou coup de sifflet final. */
  private endOfPeriod() {
    const st = this.state
    st.ball.carrierId = null
    st.ball.transit = null

    if (st.phase === 'first_half') {
      st.phase = 'halftime'
      this.log('halftime', `Mi-temps : ${st.home.team.short} ${st.score.home} - ${st.score.away} ${st.away.team.short}.`)
      this.runAutoSubs()
      return
    }

    if (st.phase === 'second_half') {
      if (this.knockout && st.score.home === st.score.away) {
        st.phase = 'break_before_extra'
        this.log('halftime', `Fin du temps réglementaire, ${st.score.home} - ${st.score.away} : on joue la prolongation.`)
        this.runAutoSubs()
        return
      }
      this.fulltime()
      return
    }

    if (st.phase === 'extra_first_half') {
      st.phase = 'extra_halftime'
      this.log('halftime', `Mi-temps de la prolongation : ${st.home.team.short} ${st.score.home} - ${st.score.away} ${st.away.team.short}.`)
      this.runAutoSubs()
      return
    }

    this.fulltime()
  }

  private runAutoSubs() {
    for (const side of this.autoSubSides) runAutoSub(this, side, this.autoSubDone)
  }

  /** Reprise après une pause : enchaîne sur la période suivante. */
  startNextPeriod() {
    const st = this.state
    if (!isBreak(st.phase)) return
    if (st.phase === 'halftime') {
      st.phase = 'second_half'
      st.periodEndTick = HALF_TICKS * 2 + Math.round(st.addedTimeSec / TICK_SEC)
      this.resetPositions('away')
      return
    }
    if (st.phase === 'break_before_extra') {
      st.phase = 'extra_first_half'
      // `+=` : le tick est un compteur continu et chaque période de
      // prolongation dure ses quinze minutes pleines. L'arrêt de jeu du temps
      // réglementaire est déjà consommé — c'est l'AFFICHAGE qui le retranche
      // (MatchScreen), pas la durée de jeu qui en est amputée.
      st.periodEndTick += EXTRA_HALF_TICKS
      this.resetPositions('home')
      return
    }
    // extra_halftime
    st.phase = 'extra_second_half'
    st.periodEndTick += EXTRA_HALF_TICKS
    this.resetPositions('away')
  }

  private fulltime() {
    const st = this.state
    const wasExtra = isExtraTime(st.phase)
    st.phase = 'finished'
    st.ball.carrierId = null
    st.ball.transit = null
    this.log(
      'fulltime',
      wasExtra && st.score.home === st.score.away
        ? // pas de séance de tirs au but dans le moteur : on le dit plutôt que de le masquer
          `Fin de la prolongation : ${st.home.team.short} ${st.score.home} - ${st.score.away} ${st.away.team.short}, toujours dos à dos.`
        : `Coup de sifflet final ! ${st.home.team.short} ${st.score.home} - ${st.score.away} ${st.away.team.short}.`,
    )
  }

  // -----------------------------------------------------------------------
  // Instructions & remplacements en cours de match
  // -----------------------------------------------------------------------

  applyInstructions(side: Side, instr: MatchInstructions) {
    const tms = this.tms(side)
    const oldFormation = tms.instructions.team.formation
    const oldLineup = [...tms.lineup]
    tms.instructions = instr

    const hasLineup = Array.isArray(instr.lineup) && instr.lineup.length === 11
    if (instr.team.formation !== oldFormation) {
      if (!hasLineup) {
        // réassignation automatique des joueurs présents aux nouveaux postes
        // (impossible en infériorité numérique : on garde le mapping actuel)
        const onPitch = oldLineup.map((id) => this.player(id)).filter((_, i) => this.state.players[oldLineup[i]].onPitch)
        if (onPitch.length === 11) tms.lineup = assignSlots(onPitch, instr.team.formation)
      }
      this.log('info', `${tms.team.short} passe en ${instr.team.formation}.`, side)
    }

    if (hasLineup && instr.lineup!.some((id, i) => id !== oldLineup[i])) {
      const newLineup = instr.lineup!
      const inSet = new Set(newLineup)
      const entering = newLineup.filter((id) => !oldLineup.includes(id))
      const leaving = oldLineup.filter((id) => !inSet.has(id))
      let ok = true
      for (let i = 0; i < entering.length; i++) {
        const r = this.makeSub(side, leaving[i], entering[i])
        if (!r.ok) {
          ok = false
          this.log('info', `Changement de composition refusé : ${r.error}`, side)
          break
        }
      }
      if (ok) {
        // permutation pure de l'ordre des postes + entrées déjà traitées
        tms.lineup = [...newLineup]
        this.replaceAtSlots(tms, instr.team.formation)
        this.log('info', `Nouvelle composition en place pour ${tms.team.short}.`, side)
      }
    }
  }

  /** Repositionne instantanément les titulaires sur leurs postes de base. */
  private replaceAtSlots(tms: TeamMatchState, formation: Formation) {
    const st = this.state
    const slots = FORMATION_SLOTS[formation]
    tms.lineup.forEach((id, i) => {
      const lp = st.players[id]
      if (!lp || !lp.onPitch) return
      const slot = slots[i]
      const pos = this.toPitch(tms.side, slot.x, slot.y)
      lp.x = pos.x
      lp.y = pos.y
      lp.prevX = pos.x
      lp.prevY = pos.y
    })
  }

  /**
   * Une fenêtre s'ouvre au premier changement d'une interruption. Les suivants
   * opérés au même tick (boucle d'applyInstructions, clics enchaînés pendant
   * une pause tactique) tombent dans la même fenêtre. La mi-temps n'en ouvre
   * aucune : le règlement l'offre en plus des trois.
   */
  private opensSubWindow(tms: TeamMatchState): boolean {
    return !isBreak(this.state.phase) && tms.lastSubTick !== this.state.tick
  }

  /**
   * Plafonds réglementaires. L'IFAB accorde en prolongation un remplacement
   * supplémentaire — que les cinq soient épuisés ou non — et une fenêtre de
   * plus. isExtraTime couvre la coupure d'avant-prolongation, où le droit est
   * déjà ouvert.
   */
  maxSubs(): number {
    return isExtraTime(this.state.phase) ? MAX_SUBS + 1 : MAX_SUBS
  }

  maxSubWindows(): number {
    return isExtraTime(this.state.phase) ? MAX_SUB_WINDOWS + 1 : MAX_SUB_WINDOWS
  }

  /** Vrai si un remplacement de plus est réglementairement possible. */
  canSub(side: Side): boolean {
    const tms = this.tms(side)
    if (this.state.phase === 'finished') return false
    if (tms.subsUsed >= this.maxSubs()) return false
    return !this.opensSubWindow(tms) || tms.subWindows < this.maxSubWindows()
  }

  makeSub(side: Side, outId: string, inId: string): { ok: boolean; error?: string } {
    const st = this.state
    // canSub le refuse déjà : sans la garde ici, un menu resté ouvert au coup
    // de sifflet final muterait encore lineup, subsUsed et les notes du match
    if (st.phase === 'finished') return { ok: false, error: 'Le match est terminé.' }
    const tms = this.tms(side)
    const newWindow = this.opensSubWindow(tms)
    const maxSubs = this.maxSubs()
    const maxWindows = this.maxSubWindows()
    if (tms.subsUsed >= maxSubs)
      return { ok: false, error: `Plus de remplacements disponibles (${maxSubs}/${maxSubs}).` }
    if (newWindow && tms.subWindows >= maxWindows)
      return {
        ok: false,
        error: `Plus de fenêtre de remplacement disponible (${maxWindows}/${maxWindows}) — attendez la mi-temps.`,
      }
    const out = st.players[outId]
    const inc = st.players[inId]
    // un blessé qui a quitté le terrain reste remplaçable — c'est même le seul
    // cas où le sortant n'est pas sur la pelouse. L'exclu, lui, ne l'est pas.
    if (!out || (!out.onPitch && out.injury !== 'out'))
      return { ok: false, error: `${this.nameOf(outId)} n'est pas sur le terrain.` }
    // déjà remplacé une fois : un second sortant sur le même id écrirait
    // lineup[-1] (indexOf renvoie -1), un 12e joueur fantôme sur le terrain.
    if (out.subbedOff) return { ok: false, error: `${this.nameOf(outId)} a déjà été remplacé.` }
    if (!inc || inc.onPitch) return { ok: false, error: `${this.nameOf(inId)} est déjà sur le terrain.` }
    if (inc.subbedOff) return { ok: false, error: `${this.nameOf(inId)} a déjà été remplacé.` }
    if (inc.sentOff) return { ok: false, error: `${this.nameOf(inId)} a été exclu.` }
    if (inc.injury === 'out') return { ok: false, error: `${this.nameOf(inId)} est blessé, il ne peut pas entrer.` }
    if (this.player(inId).role === 'GK' && this.player(outId).role !== 'GK')
      return { ok: false, error: 'Un gardien ne peut remplacer qu’un gardien (MVP).' }

    const idx = tms.lineup.indexOf(outId)
    tms.lineup[idx] = inId
    out.onPitch = false
    out.subbedOff = true
    inc.onPitch = true
    inc.stamina = 100
    inc.warned40 = false
    inc.warned20 = false
    inc.x = clamp(out.x, 2, PITCH.L - 2)
    inc.y = out.y < PITCH.W / 2 ? 0.5 : PITCH.W - 0.5 // entre au bord du terrain
    inc.prevX = inc.x
    inc.prevY = inc.y
    if (st.ball.carrierId === outId) st.ball.carrierId = inId
    tms.subsUsed++
    if (newWindow) tms.subWindows++
    // la mi-temps ne mémorise pas son tick : sinon la reprise hériterait d'une
    // fenêtre déjà ouverte et le premier changement du retour serait gratuit
    if (!isBreak(st.phase)) tms.lastSubTick = st.tick
    this.log('sub', `🔁 Remplacement ${tms.team.short} : ${this.nameOf(inId)} entre à la place de ${this.nameOf(outId)}.`, side, inId)
    return { ok: true }
  }
}
