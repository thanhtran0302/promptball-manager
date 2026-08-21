// Rendu 2D du terrain (façon vue 2D de Football Manager) sur Canvas.
// 10 pixels par mètre : 1050 × 680 en résolution interne.

import type { MatchEvent, Team } from '../engine/types'
import type { RenderFrame } from '../game/controller'

const PPM = 10 // pixels par mètre
export const CANVAS_W = 105 * PPM
export const CANVAS_H = 68 * PPM

/** durée de vie d'une annotation (en ticks de 0,1 s) */
const ANNOT_AGE = 16

const ANNOT_LABELS: Partial<Record<MatchEvent['type'], string>> = {
  shot: 'Frappe !',
  goal: 'BUT !',
  save: 'Arrêt',
  off_target: 'À côté',
  offside: 'Hors-jeu',
  goal_kick: 'Six mètres',
  red_card: 'Rouge !',
  penalty: 'Penalty !',
}

const ANNOT_COLORS: Partial<Record<MatchEvent['type'], string>> = {
  goal: '#4ade80',
  save: '#60a5fa',
  offside: '#fb923c',
  red_card: '#f87171',
  penalty: '#fde047',
}

export interface DrawOptions {
  home: Team
  away: Team
  hoverPlayerId?: string | null
  /** événements récents à annoter sur le terrain (frappe, but, arrêt…) */
  events?: MatchEvent[]
  nowTick?: number
}

export function drawMatch(ctx: CanvasRenderingContext2D, frame: RenderFrame, opts: DrawOptions) {
  ctx.save()
  drawPitch(ctx)
  drawPlayers(ctx, frame, opts)
  drawBall(ctx, frame)
  drawAnnotations(ctx, opts)
  ctx.restore()
}

function drawPitch(ctx: CanvasRenderingContext2D) {
  // fond + bandes de tonte
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#1e6b34' : '#1a5f2e'
    ctx.fillRect(i * (CANVAS_W / 14), 0, CANVAS_W / 14 + 1, CANVAS_H)
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.75)'
  ctx.lineWidth = 2

  // contour
  ctx.strokeRect(4, 4, CANVAS_W - 8, CANVAS_H - 8)

  // ligne médiane + rond central
  ctx.beginPath()
  ctx.moveTo(CANVAS_W / 2, 4)
  ctx.lineTo(CANVAS_W / 2, CANVAS_H - 4)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(CANVAS_W / 2, CANVAS_H / 2, 9.15 * PPM, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(CANVAS_W / 2, CANVAS_H / 2, 3, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  ctx.fill()

  // surfaces (16,50 × 40,32 m) et 5,50 × 18,32 m
  const box = (x: number, dir: number) => {
    ctx.strokeRect(x, (68 / 2 - 20.16) * PPM, dir * 16.5 * PPM, 40.32 * PPM)
    ctx.strokeRect(x, (68 / 2 - 9.16) * PPM, dir * 5.5 * PPM, 18.32 * PPM)
    // point de penalty
    const spotX = x + dir * 11 * PPM
    ctx.beginPath()
    ctx.arc(spotX, (68 / 2) * PPM, 3, 0, Math.PI * 2)
    ctx.fill()
    // arc de surface : portion du cercle de 9,15 m extérieure au bord de la
    // surface (intersection exacte à acos(5,5/9,15) ≈ ±53° du point de penalty)
    const half = Math.acos(5.5 / 9.15)
    ctx.beginPath()
    if (dir > 0) ctx.arc(spotX, (68 / 2) * PPM, 9.15 * PPM, -half, half)
    else ctx.arc(spotX, (68 / 2) * PPM, 9.15 * PPM, Math.PI - half, Math.PI + half)
    ctx.stroke()
  }
  box(4, 1)
  box(CANVAS_W - 4, -1)

  // buts
  ctx.fillStyle = '#fff'
  ctx.fillRect(4 - 6, (68 / 2 - 3.66) * PPM, 6, 7.32 * PPM)
  ctx.fillRect(CANVAS_W - 4, (68 / 2 - 3.66) * PPM, 6, 7.32 * PPM)
}

function drawPlayers(ctx: CanvasRenderingContext2D, frame: RenderFrame, opts: DrawOptions) {
  const numbers = new Map<string, number>()
  for (const p of frame.players) {
    const team = p.side === 'home' ? opts.home : opts.away
    const idx = frame.players.filter((q) => q.side === p.side).indexOf(p)
    numbers.set(p.id, idx + 1)

    const x = p.x * PPM
    const y = p.y * PPM
    const isGK = idx === 0
    const hovered = opts.hoverPlayerId === p.id

    // ombre
    ctx.beginPath()
    ctx.arc(x, y + 3, 13, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(0,0,0,0.25)'
    ctx.fill()

    // pastille
    ctx.beginPath()
    ctx.arc(x, y, 13, 0, Math.PI * 2)
    ctx.fillStyle = isGK ? '#facc15' : team.color
    ctx.fill()
    ctx.lineWidth = p.carrier ? 3.5 : 1.5
    ctx.strokeStyle = p.carrier ? '#fde047' : 'rgba(0,0,0,0.55)'
    ctx.stroke()

    // numéro
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 11px system-ui'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(idx + 1), x, y)

    if (hovered || p.carrier) {
      const name = team.players.find((pl) => pl.id === p.id)?.name ?? ''
      ctx.font = '600 11px system-ui'
      const w = ctx.measureText(name).width + 10
      ctx.fillStyle = 'rgba(8,12,20,0.85)'
      ctx.fillRect(x - w / 2, y - 32, w, 16)
      ctx.fillStyle = p.carrier ? '#fde047' : '#fff'
      ctx.fillText(name, x, y - 24)
    }
  }
}

function drawBall(ctx: CanvasRenderingContext2D, frame: RenderFrame) {
  const x = frame.ballX * PPM
  const y = frame.ballY * PPM
  const r = frame.ballKind === 'shot' ? 8 : 6
  ctx.beginPath()
  ctx.arc(x, y + 2, r, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(0,0,0,0.3)'
  ctx.fill()
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fillStyle = frame.ballKind === 'shot' ? '#fde047' : '#fff'
  ctx.fill()
  ctx.lineWidth = frame.ballKind === 'shot' ? 2.5 : 1.5
  ctx.strokeStyle = '#111'
  ctx.stroke()
}

/** Anneaux + étiquettes pour les actions récentes (frappe, but, arrêt, hors-jeu). */
function drawAnnotations(ctx: CanvasRenderingContext2D, opts: DrawOptions) {
  if (!opts.events || opts.nowTick === undefined) return
  for (const ev of opts.events) {
    if (ev.x === undefined || ev.y === undefined) continue
    const label = ANNOT_LABELS[ev.type]
    if (!label) continue
    const age = opts.nowTick - ev.tick
    if (age < 0 || age > ANNOT_AGE) continue
    const fade = 1 - age / ANNOT_AGE
    const x = ev.x * PPM
    const y = ev.y * PPM
    const color = ANNOT_COLORS[ev.type] ?? '#fde047'

    ctx.beginPath()
    ctx.arc(x, y, 12 + age * 2.2, 0, Math.PI * 2)
    ctx.strokeStyle = color
    ctx.globalAlpha = fade * 0.9
    ctx.lineWidth = 2.5
    ctx.stroke()
    ctx.globalAlpha = 1

    if (age <= 10) {
      ctx.font = `bold ${ev.type === 'goal' ? 16 : 12}px system-ui`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      const w = ctx.measureText(label).width + 12
      ctx.fillStyle = 'rgba(8,12,20,0.85)'
      ctx.fillRect(x - w / 2, y - 34, w, 18)
      ctx.fillStyle = color
      ctx.fillText(label, x, y - 19)
    }
  }
}

/** Trouve le joueur sous le curseur (pour l'infobulle), en coordonnées canvas. */
export function pickPlayer(frame: RenderFrame, canvasX: number, canvasY: number): string | null {
  let best: string | null = null
  let bestD = 20
  for (const p of frame.players) {
    const d = Math.hypot(p.x * PPM - canvasX, p.y * PPM - canvasY)
    if (d < bestD) {
      bestD = d
      best = p.id
    }
  }
  return best
}
