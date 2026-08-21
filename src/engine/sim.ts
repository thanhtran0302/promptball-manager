// Moteur de match : simulation tick par tick (10 Hz), déterministe.
// Home attaque vers x=105, away vers x=0.

import { Rng } from './rng'
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
  HALF_TICKS,
  PITCH,
  TICK_SEC,
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
    rating: 6,
  }
}

export interface MatchOptions {
  home: Team
  away: Team
  homeInstructions: MatchInstructions
  awayInstructions: MatchInstructions
  seed: number
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
  /** poids de pressing par id : les défenseurs désignés ferment sur le porteur */
  private pressers = new Map<string, number>()
  /** ligne du hors-jeu par côté, en espace ATTAQUANT (tx max pour rester en jeu) */
  private offsideLine = new Map<Side, number>()
  /** passes exemptées de hors-jeu après remise en jeu (engagement, 6 m, corner, CF) */
  private restartExemptUntilTick = 0

  constructor(opts: MatchOptions) {
    this.rng = new Rng(opts.seed)
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
        }
      }
    }

    this.state = {
      tick: 0,
      phase: 'first_half',
      addedTimeSec: Math.round(this.rng.range(30, 180)),
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
      stats: {
        shots: 0,
        shotsOnTarget: 0,
        possessionTicks: 0,
        corners: 0,
        fouls: 0,
        yellowCards: 0,
        offsides: 0,
        passes: 0,
        passesOk: 0,
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
    lp.stats.rating = clamp(lp.stats.rating + delta, 3, 10)
  }

  // -----------------------------------------------------------------------
  // Tick principal
  // -----------------------------------------------------------------------

  tick(): void {
    const st = this.state
    if (st.phase === 'finished' || st.phase === 'halftime') return
    st.tick++

    if (st.tick === HALF_TICKS) {
      this.halftime()
      return
    }
    const fullTimeTick = HALF_TICKS * 2 + Math.round(st.addedTimeSec / TICK_SEC)
    if (st.tick >= fullTimeTick) {
      this.fulltime()
      return
    }

    // mémoire des positions pour l'interpolation du rendu
    st.ball.prevX = st.ball.x
    st.ball.prevY = st.ball.y

    if (st.possession) st[st.possession].stats.possessionTicks++

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
      if (carrier) {
        const goal = this.attackedGoal(carrier.side)
        const d = Math.max(dist(carrier.x, carrier.y, goal.x, goal.y), 1)
        st.ball.x = carrier.x + ((goal.x - carrier.x) / d) * 0.8
        st.ball.y = carrier.y + ((goal.y - carrier.y) / d) * 0.8
      }
      return
    }
    const p = clamp((st.tick - t.startTick) / Math.max(t.endTick - t.startTick, 1), 0, 1)
    st.ball.x = t.fromX + (t.toX - t.fromX) * p
    st.ball.y = t.fromY + (t.toY - t.fromY) * p
    if (st.tick >= t.endTick) {
      st.ball.transit = null
      this.resolveArrival(t)
    }
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
      this.freezeUntilTick = st.tick + 12
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
    const receiver = t.intendedReceiverId ? st.players[t.intendedReceiverId] : null
    if (t.success && receiver && receiver.onPitch) {
      st.ball.carrierId = receiver.id
      receiver.stats.touches++
      st.possession = receiver.side
      this.lastPasserId = t.kind === 'pass' ? this.lastKicker : null
      this.nextDecisionTick = st.tick + 4
      return
    }
    // balle perdue : le plus proche court dessus (plus de téléportation)
    const winner = this.nearestTo(t.toX, t.toY)
    if (winner) {
      const changed = st.possession !== winner.side
      st.possession = winner.side
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
        this.bumpRating(winner.id, 0.15)
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
      this.bumpRating(shooterId, 1)
      const assistId = t.assistCandidateId
      if (assistId && st.players[assistId].side === shootingSide) {
        st.players[assistId].stats.assists++
        this.bumpRating(assistId, 0.5)
      }
      this.log(
        'goal',
        `⚽ BUT ! ${this.nameOf(shooterId)} marque pour ${this.tms(shootingSide).team.short}${assistId && assistId !== shooterId ? ` (passe décisive de ${this.nameOf(assistId)})` : ''} !`,
        shootingSide,
        shooterId,
        t.toX,
        t.toY,
      )
      this.resetPositions(defSide)
    } else if (t.shotOutcome === 'save') {
      // le gardien capte la balle — visible : la balle file vers lui, court temps mort
      if (keeper) {
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
        this.freezeUntilTick = st.tick + 10
        this.restartExemptUntilTick = st.tick + 40
        this.nextDecisionTick = st.tick + 14
      }
      this.log('save', `Frappe de ${this.nameOf(shooterId)}… arrêté par le gardien !`, shootingSide, shooterId, t.toX, t.toY)
    } else if (t.shotOutcome === 'off_target') {
      this.log('off_target', `Frappe de ${this.nameOf(shooterId)}… à côté.`, shootingSide, shooterId, t.toX, t.toY)
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
        this.freezeUntilTick = st.tick + 16
        this.restartExemptUntilTick = st.tick + 45
        this.nextDecisionTick = st.tick + 20
        this.log('goal_kick', `Six mètres pour ${defTms.team.short}.`, defSide, undefined, spot.x, spot.y)
      }
      this.bumpRating(shooterId, -0.05)
    } else {
      // contré : balle libre au point de frappe
      const winner = this.nearestTo(t.toX, t.toY)
      if (winner) {
        st.ball.carrierId = winner.id
        st.possession = winner.side
        this.nextDecisionTick = st.tick + 5
      }
    }
    this.lastPasserId = null
  }

  private giveCorner(side: Side) {
    const st = this.state
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
      taker.x = x
      taker.y = y
      st.ball.carrierId = taker.id
      st.possession = side
      st.ball.x = x
      st.ball.y = y
      this.freezeUntilTick = st.tick + 10
      this.restartExemptUntilTick = st.tick + 40
      this.nextDecisionTick = st.tick + 12
    }
  }

  private keeperOf(side: Side): LivePlayer | null {
    const tms = this.tms(side)
    for (const id of tms.lineup) {
      if (this.player(id).role === 'GK') return this.state.players[id]
    }
    return null
  }

  private nearestTo(x: number, y: number, side?: Side): LivePlayer | null {
    const st = this.state
    const cands = Object.values(st.players).filter(
      (lp) => lp.onPitch && (side === undefined || lp.side === side),
    )
    if (!cands.length) return null
    const weights = cands.map((lp) => 1 / Math.pow(0.5 + dist(lp.x, lp.y, x, y), 2))
    return cands[this.rng.weighted(weights)]
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
      let w = rangeF * (0.9 + a.shooting / 70) * angleF * 0.25
      if (dGoal < 16) w *= 1.75 // dans la surface : on conclut l'action
      w /= 1 + pressure * 0.3
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
    }
    // dribble : pas d'action immédiate, le porteur avance vers sa cible

    // décisions un peu plus rapides dans le dernier tiers
    let baseInterval = this.rng.range(18, 36) * TEMPO_DECISION[ti.tempo]
    if (dGoal < 35) baseInterval *= 0.85
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
      0.93 -
      d * (long ? 0.0048 : 0.006) -
      pressReceiver * 0.07 -
      pressPasser * 0.04 +
      ((p.attributes.passing - 50) / 99) * 0.3 -
      (long ? 0.07 : 0) -
      (1 - staminaFactor(carrier.stamina)) * 0.5
    prob = clamp(prob, 0.15, 0.97)

    const success = this.rng.chance(prob)
    const offside = this.checkOffside(carrier.side, receiver)
    carrier.stats.passes++
    this.tms(carrier.side).stats.passes++
    if (success && !offside) {
      carrier.stats.passesOk++
      this.tms(carrier.side).stats.passesOk++
      this.bumpRating(carrier.id, 0.02)
    } else {
      this.bumpRating(carrier.id, -0.03)
    }

    const noiseX = this.rng.range(-2, 2)
    const noiseY = this.rng.range(-2, 2)
    const speed = long ? 19 : 13 // m/s
    const duration = Math.max(2, Math.round((d / speed) /TICK_SEC))

    st.ball.carrierId = null
    st.ball.transit = {
      fromX: carrier.x,
      fromY: carrier.y,
      toX: clamp(receiver.x + (success ? noiseX * 0.4 : noiseX * 3), 1, PITCH.L - 1),
      toY: clamp(receiver.y + (success ? noiseY * 0.4 : noiseY * 3), 1, PITCH.W - 1),
      startTick: st.tick,
      endTick: st.tick + duration,
      kind: 'pass',
      intendedReceiverId: targetId,
      success: success && !offside,
      offside,
    }
    if (success && !offside) this.lastKicker = carrier.id
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
    let xg = 0.42 * Math.exp(-d / 7.5) * angleF
    xg = clamp(
      (xg * (0.7 + (p.attributes.shooting / 99) * 0.6)) / (0.7 + (gkAttr / 99) * 0.6),
      0.02,
      0.4,
    )

    let outcome: BallTransit['shotOutcome']
    if (this.rng.chance(xg)) outcome = 'goal'
    else {
      const r = this.rng.next()
      outcome = r < 0.45 ? 'off_target' : r < 0.85 ? 'save' : 'blocked'
    }

    carrier.stats.shots++
    this.tms(carrier.side).stats.shots++
    if (outcome === 'goal' || outcome === 'save') this.tms(carrier.side).stats.shotsOnTarget++
    this.bumpRating(carrier.id, outcome === 'goal' ? 0 : 0.1)

    const tx =
      outcome === 'off_target' ? goal.x + this.rng.range(-4, 4) * (goal.x === PITCH.L ? -1 : 1) : goal.x
    const ty = outcome === 'off_target' ? goal.y + this.rng.range(6, 12) * (this.rng.chance(0.5) ? 1 : -1) : goal.y
    const duration = Math.max(2, Math.round(d / 24 / TICK_SEC))

    st.ball.carrierId = null
    st.ball.transit = {
      fromX: carrier.x,
      fromY: carrier.y,
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
      (0.008 + (defP.attributes.tackling / 99) * 0.01) *
      pressF *
      (1.15 - (carrierP.attributes.agility / 99) * 0.6) *
      (1 + support * 0.3) /
      (1 + (carrierP.attributes.technique / 99) * 0.5)
    p *= staminaFactor(first.stamina)
    if (!this.rng.chance(p)) return

    // tentative de tacle
    if (!this.rng.chance(0.68)) return // tacle manqué, l'attaquant passe

    if (this.rng.chance(0.26)) {
      // faute
      const oppTmsStats = oppTms.stats
      oppTmsStats.fouls++
      first.stats.fouls++
      this.bumpRating(first.id, -0.15)
      this.log('foul', `Faute de ${this.nameOf(first.id)} sur ${this.nameOf(carrier.id)}.`, oppSide, first.id)
      if (this.rng.chance(0.22)) {
        oppTmsStats.yellowCards++
        this.bumpRating(first.id, -0.3)
        this.log('yellow_card', `🟨 Carton jaune pour ${this.nameOf(first.id)}.`, oppSide, first.id)
      }
      // coup franc : possession conservée, petit temps de repli
      st.ball.carrierId = carrier.id
      st.possession = carrier.side
      this.freezeUntilTick = st.tick + 10
      this.restartExemptUntilTick = st.tick + 40
      this.nextDecisionTick = st.tick + 12
      return
    }

    // tacle gagnant
    first.stats.tackles++
    this.bumpRating(first.id, 0.2)
    this.bumpRating(carrier.id, -0.05)
    st.ball.carrierId = first.id
    st.possession = first.side
    first.stats.touches++
    this.log('tackle', `Beau tacle de ${this.nameOf(first.id)} !`, oppSide, first.id)
    this.lastPasserId = null
    this.nextDecisionTick = st.tick + 5
  }

  // -----------------------------------------------------------------------
  // Déplacement & endurance
  // -----------------------------------------------------------------------

  private movePlayers() {
    const st = this.state
    this.updatePhaseAndPressers()
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
      const tgt = this.targetFor(lp)
      const vmax = maxSpeed(p.attributes.pace, lp.stamina)
      const d = dist(lp.x, lp.y, tgt.x, tgt.y)
      let speedRatio = 0
      if (d > 0.05) {
        const step = Math.min(d, vmax * TICK_SEC)
        lp.x += ((tgt.x - lp.x) / d) * step
        lp.y += ((tgt.y - lp.y) / d) * step
        lp.stats.distance += step
        speedRatio = step / (vmax * TICK_SEC)
      }

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
        p.attributes.stamina,
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
   * Phase attaque/défense lissée par côté (transitions visibles) et
   * désignation des pressemens : les deux joueurs de champ les plus proches
   * du ballon viennent fermer sur le porteur, goal-side.
   */
  private updatePhaseAndPressers() {
    const st = this.state
    for (const side of ['home', 'away'] as const) {
      const target = st.possession === side ? 1 : 0
      const cur = this.phase.get(side) ?? 0.5
      this.phase.set(side, cur + (target - cur) * 0.04)
    }
    this.pressers.clear()
    for (const side of ['home', 'away'] as const) {
      if (st.possession === side) continue
      const pf = PRESS_FACTOR[this.tms(side).instructions.team.pressing]
      const cands = Object.values(st.players)
        .filter((lp) => lp.onPitch && lp.side === side && this.player(lp.id).role !== 'GK')
        .sort(
          (a, b) =>
            dist(a.x, a.y, st.ball.x, st.ball.y) - dist(b.x, b.y, st.ball.x, st.ball.y),
        )
      if (cands[0]) this.pressers.set(cands[0].id, Math.min(0.85, 0.45 + pf * 0.27))
      if (cands[1]) this.pressers.set(cands[1].id, Math.min(0.5, 0.18 + pf * 0.16))
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

  /** Le récepteur est-il hors-jeu AU MOMENT de la passe ? */
  private checkOffside(side: Side, receiver: LivePlayer): boolean {
    if (this.state.tick < this.restartExemptUntilTick) return false
    const r = this.toTeamSpace(side, receiver.x, receiver.y)
    if (r.tx <= 0.5) return false // hors-jeu uniquement dans le camp adverse
    const b = this.toTeamSpace(side, this.state.ball.x, this.state.ball.y)
    if (r.tx <= b.tx + 0.005) return false // pas devant le ballon
    const line = this.offsideLine.get(side) ?? 0.9
    return r.tx > line + 0.03 // dépassement net (~3 m au-delà de l'avant-dernier défenseur)
  }

  private targetFor(lp: LivePlayer): { x: number; y: number } {
    const st = this.state
    const tms = this.tms(lp.side)
    const ti = tms.instructions.team
    const pi = this.instrFor(tms, lp.id)
    const slotIdx = tms.lineup.indexOf(lp.id)
    const p = this.player(lp.id)
    const ballTs = this.smoothBall(lp.side)
    // phase lissée : 1 = en attaque, 0 = en défense, transition sur ~2,5 s
    const ab = clamp(this.phase.get(lp.side) ?? 0.5, 0, 1)

    if (p.role === 'GK') {
      let tx = 0.03
      if (ballTs.tx > 0.78) tx += Math.min((ballTs.tx - 0.78) * 0.4, 0.06)
      const ty = 0.5 + clamp(ballTs.ty - 0.5, -0.22, 0.22)
      return this.toPitch(lp.side, tx, ty)
    }

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

    // --- pressing : les défenseurs désignés viennent fermer sur le porteur ---
    const pressW = this.pressers.get(lp.id)
    if (pressW !== undefined && ab < 0.6 && st.ball.carrierId) {
      const ownGoal = this.attackedGoal(lp.side === 'home' ? 'away' : 'home')
      // point légèrement côté but par rapport au ballon (défenseur se place goal-side)
      const gsx = st.ball.x + (ownGoal.x - st.ball.x) * 0.12
      const gsy = st.ball.y + (ownGoal.y - st.ball.y) * 0.12
      const pt = this.toTeamSpace(lp.side, gsx, gsy)
      tx = tx * (1 - pressW) + pt.tx * pressW
      ty = ty * (1 - pressW) + pt.ty * pressW
    }

    const w = this.wander.get(lp.id)
    const pos = this.toPitch(lp.side, tx, ty)
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
    this.freezeUntilTick = st.tick + 15
    this.restartExemptUntilTick = st.tick + 40
    this.nextDecisionTick = st.tick + 18
    this.lastPasserId = null
    this.log('kickoff', `Coup d'envoi — ${this.tms(kickingSide).team.short} engage.`, kickingSide)
  }

  private halftime() {
    const st = this.state
    st.phase = 'halftime'
    st.ball.carrierId = null
    st.ball.transit = null
    this.log(
      'halftime',
      `Mi-temps : ${st.home.team.short} ${st.score.home} - ${st.score.away} ${st.away.team.short}.`,
    )
  }

  startSecondHalf() {
    if (this.state.phase !== 'halftime') return
    this.state.phase = 'second_half'
    this.resetPositions('away')
  }

  private fulltime() {
    const st = this.state
    st.phase = 'finished'
    st.ball.carrierId = null
    st.ball.transit = null
    this.log(
      'fulltime',
      `Coup de sifflet final ! ${st.home.team.short} ${st.score.home} - ${st.score.away} ${st.away.team.short}.`,
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
        // réassignation automatique des 11 joueurs aux nouveaux postes
        const onPitch = oldLineup.map((id) => this.player(id))
        tms.lineup = assignSlots(onPitch, instr.team.formation)
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

  makeSub(side: Side, outId: string, inId: string): { ok: boolean; error?: string } {
    const st = this.state
    const tms = this.tms(side)
    if (tms.subsUsed >= 3) return { ok: false, error: 'Plus de remplacements disponibles (3/3).' }
    const out = st.players[outId]
    const inc = st.players[inId]
    if (!out || !out.onPitch) return { ok: false, error: `${this.nameOf(outId)} n'est pas sur le terrain.` }
    if (!inc || inc.onPitch) return { ok: false, error: `${this.nameOf(inId)} est déjà sur le terrain.` }
    if (this.player(inId).role === 'GK' && this.player(outId).role !== 'GK')
      return { ok: false, error: 'Un gardien ne peut remplacer qu’un gardien (MVP).' }

    const idx = tms.lineup.indexOf(outId)
    tms.lineup[idx] = inId
    out.onPitch = false
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
    this.log('sub', `🔁 Remplacement ${tms.team.short} : ${this.nameOf(inId)} entre à la place de ${this.nameOf(outId)}.`, side, inId)
    return { ok: true }
  }
}
