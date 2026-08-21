// Contrôleur de match : horloge temps réel → ticks de simulation,
// vitesses, pause, et "coach IA" de l'équipe adverse.

import { MatchEngine } from '../engine/sim'
import { MENTALITY_LEVEL, PRESSINGS, MENTALITIES } from '../engine/instructions'
import { TICK_SEC, type MatchInstructions, type MatchPhase, type Side } from '../engine/types'

/** À ×1, 1 minute de jeu = 30 secondes réelles (match ≈ 45 min réelles).
 *  ×0.5 = temps réel 1:1 (match ≈ 90 min). */
export const SIM_SEC_PER_REAL_SEC = 2
export const SPEEDS = [0.5, 1, 2, 4, 8] as const
export type Speed = (typeof SPEEDS)[number]

export interface RenderPlayer {
  id: string
  side: Side
  x: number
  y: number
  carrier: boolean
}

export interface RenderFrame {
  alpha: number
  ballX: number
  ballY: number
  /** nature du déplacement de balle, pour accentuer les tirs */
  ballKind: 'pass' | 'shot' | 'clearance' | 'carry' | null
  players: RenderPlayer[]
}

export class MatchController {
  readonly engine: MatchEngine
  /** côté géré par l'IA (l'autre est le joueur humain) */
  readonly aiSide: Side
  speed: Speed = 1
  paused = true
  onHalftime?: () => void
  onFulltime?: () => void

  private acc = 0
  private lastTs: number | null = null
  private aiAdjusted = new Set<number>()

  constructor(engine: MatchEngine, aiSide: Side) {
    this.engine = engine
    this.aiSide = aiSide
  }

  /** À appeler à chaque frame (requestAnimationFrame). */
  update(nowMs: number): void {
    if (this.paused || this.engine.state.phase === 'finished') {
      this.lastTs = nowMs
      return
    }
    if (this.engine.state.phase === 'halftime') {
      this.paused = true
      this.lastTs = nowMs
      this.onHalftime?.()
      return
    }
    if (this.lastTs === null) this.lastTs = nowMs
    const dtSec = Math.min((nowMs - this.lastTs) / 1000, 0.25)
    this.lastTs = nowMs

    this.acc += (dtSec * SIM_SEC_PER_REAL_SEC * this.speed) / TICK_SEC
    const whole = Math.floor(this.acc)
    if (whole > 0) {
      this.acc -= whole
      for (let i = 0; i < whole; i++) {
        this.engine.tick()
        // tick() peut faire évoluer la phase : lecture sans narrowing TS
        const phase = this.currentPhase()
        this.maybeAiAdjust()
        if (phase === 'halftime') {
          this.paused = true
          this.onHalftime?.()
          return
        }
        if (phase === 'finished') {
          this.paused = true
          this.onFulltime?.()
          return
        }
      }
    }
  }

  /** État interpolé pour un rendu fluide à 60 fps. */
  get frame(): RenderFrame {
    const st = this.engine.state
    const alpha = Math.min(this.acc, 1)
    const players: RenderPlayer[] = []
    for (const lp of Object.values(st.players)) {
      if (!lp.onPitch) continue
      players.push({
        id: lp.id,
        side: lp.side,
        x: lp.prevX + (lp.x - lp.prevX) * alpha,
        y: lp.prevY + (lp.y - lp.prevY) * alpha,
        carrier: st.ball.carrierId === lp.id,
      })
    }
    return {
      alpha,
      ballX: st.ball.prevX + (st.ball.x - st.ball.prevX) * alpha,
      ballY: st.ball.prevY + (st.ball.y - st.ball.prevY) * alpha,
      ballKind: st.ball.transit?.kind ?? (st.ball.carrierId ? 'carry' : null),
      players,
    }
  }

  /** Lecture de la phase sans narrowing (le moteur la fait évoluer en tick()). */
  private currentPhase(): MatchPhase {
    return this.engine.state.phase
  }

  resume() {
    if (this.engine.state.phase === 'halftime') {
      this.engine.startSecondHalf()
    }
    this.lastTs = null
    this.paused = false
  }

  pause() {
    this.paused = true
  }

  setSpeed(s: Speed) {
    this.speed = s
  }

  applyInstructions(side: Side, instr: MatchInstructions): string[] {
    const errors: string[] = []
    this.engine.applyInstructions(side, instr)
    for (const sub of instr.substitutions ?? []) {
      const r = this.engine.makeSub(side, sub.outPlayerId, sub.inPlayerId)
      if (!r.ok && r.error) errors.push(r.error)
    }
    return errors
  }

  /** Le coach IA adapte sa tactique aux minutes 60 et 75 (règles fixes). */
  private maybeAiAdjust() {
    const st = this.engine.state
    const minute = Math.floor((st.tick * TICK_SEC) / 60)
    for (const trigger of [60, 75]) {
      if (minute === trigger && !this.aiAdjusted.has(trigger)) {
        this.aiAdjusted.add(trigger)
        const tms = st[this.aiSide]
        const diff = st.score[this.aiSide] - st.score[this.aiSide === 'home' ? 'away' : 'home']
        const instr: MatchInstructions = structuredClone(tms.instructions)
        const level = MENTALITY_LEVEL[instr.team.mentality]
        if (diff < 0) {
          // mené : plus d'audace et de pressing
          instr.team.mentality = MENTALITIES[Math.min(level + 1, 4)]
          instr.team.pressing = PRESSINGS[Math.min(PRESSINGS.indexOf(instr.team.pressing) + 1, 2)]
          st.events.push({
            tick: st.tick,
            minute,
            type: 'info',
            side: this.aiSide,
            message: `${tms.team.short} passe à une attitude plus offensive (${instr.team.mentality.replace('_', ' ')}).`,
          })
          this.engine.applyInstructions(this.aiSide, instr)
        } else if (diff >= 2) {
          instr.team.mentality = MENTALITIES[Math.max(level - 1, 0)]
          st.events.push({
            tick: st.tick,
            minute,
            type: 'info',
            side: this.aiSide,
            message: `${tms.team.short} fait tourner et gère son avantage (${instr.team.mentality.replace('_', ' ')}).`,
          })
          this.engine.applyInstructions(this.aiSide, instr)
        }
      }
    }
  }
}
