import { useEffect, useRef, useState } from 'react'
import { MAX_SUBS, MAX_SUB_WINDOWS, type MatchEngine } from '../../engine/sim'
import type { Team, MatchInstructions } from '../../engine/types'
import type { LLMSettings } from '../../llm/presets'
import { MatchController, SPEEDS, type Speed } from '../../game/controller'
import { CANVAS_H, CANVAS_W, drawMatch, pickPlayer } from '../MatchCanvas'
import { PromptBox } from '../components/PromptBox'

interface Props {
  engine: MatchEngine
  userTeam: Team
  opponent: Team
  settings: LLMSettings
  onFinished: () => void
}

export function MatchScreen({ engine, userTeam, opponent, settings, onFinished }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const controllerRef = useRef<MatchController | null>(null)
  const hoverRef = useRef<string | null>(null)
  const [, setUiTick] = useState(0)
  const [promptOpen, setPromptOpen] = useState(false)
  const [subError, setSubError] = useState('')
  const [subFor, setSubFor] = useState<string | null>(null)
  const finishedRef = useRef(false)

  if (!controllerRef.current) {
    controllerRef.current = new MatchController(engine, 'away')
  }
  const controller = controllerRef.current

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = CANVAS_W * dpr
    canvas.height = CANVAS_H * dpr

    let raf = 0
    let lastPanel = 0
    const loop = (ts: number) => {
      controller.update(ts)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawMatch(ctx, controller.frame, {
        home: userTeam,
        away: opponent,
        hoverPlayerId: hoverRef.current,
        events: engine.state.events.slice(-30),
        nowTick: engine.state.tick,
      })
      if (ts - lastPanel > 250) {
        lastPanel = ts
        setUiTick((t) => t + 1)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [controller, engine, userTeam, opponent])

  useEffect(() => {
    controller.onFulltime = () => setUiTick((t) => t + 1)
  }, [controller])

  const st = engine.state
  const minute = Math.floor((st.tick * 0.1) / 60)
  const minuteLabel = minute >= 90 ? `90+${minute - 90}'` : `${minute}'`
  const finished = st.phase === 'finished'
  const halftime = st.phase === 'halftime'
  const kickoffPending = st.tick === 0 && controller.paused && !promptOpen

  const openTacticalPause = () => {
    controller.pause()
    setPromptOpen(true)
  }

  const applyPromptInstructions = (instr: MatchInstructions) => {
    const errors = controller.applyInstructions('home', instr)
    if (errors.length) setSubError(errors.join(' '))
    setPromptOpen(false)
    controller.resume()
  }

  const doSub = (outId: string, inId: string) => {
    const r = engine.makeSub('home', outId, inId)
    setSubError(r.ok ? '' : r.error ?? '')
    setSubFor(null)
  }

  // la règle vit dans le moteur (5 joueurs, 3 fenêtres, mi-temps offerte) :
  // la dupliquer ici la ferait diverger au premier ajustement
  const canSub = engine.canSub('home')
  const bench = userTeam.players.filter(
    (p) => !st.home.lineup.includes(p.id) && !st.players[p.id].subbedOff && !st.players[p.id].sentOff,
  )

  return (
    <div className="screen match">
      <div className="match-header">
        <div className="score-board">
          <span className="sb-team" style={{ color: userTeam.color }}>
            {userTeam.short}
          </span>
          <span className="sb-score">
            {st.score.home} – {st.score.away}
          </span>
          <span className="sb-team" style={{ color: opponent.color }}>
            {opponent.short}
          </span>
          <span className="sb-minute">{finished ? 'Terminé' : halftime ? 'MT' : minuteLabel}</span>
        </div>

        <div className="match-controls">
          {!finished && !halftime && (
            <>
              <button
                className="btn"
                onClick={() => (controller.paused ? controller.resume() : controller.pause())}
              >
                {controller.paused ? '▶ Reprendre' : '⏸ Pause'}
              </button>
              {SPEEDS.map((s: Speed) => (
                <button
                  key={s}
                  className={`chip-btn ${controller.speed === s ? 'active' : ''}`}
                  onClick={() => controller.setSpeed(s)}
                >
                  ×{s}
                </button>
              ))}
              <button className="btn accent" onClick={openTacticalPause} disabled={controller.paused && !kickoffPending}>
                💬 Pause tactique
              </button>
            </>
          )}
          {halftime && (
            <button className="btn primary" onClick={() => controller.resume()}>
              ▶ Coup d'envoi de la seconde période
            </button>
          )}
          {finished && (
            <button
              className="btn primary"
              onClick={() => {
                if (!finishedRef.current) {
                  finishedRef.current = true
                  onFinished()
                }
              }}
            >
              Résumé du match →
            </button>
          )}
        </div>
      </div>

      <div className="match-body">
        <div className="pitch-wrap">
          <canvas
            ref={canvasRef}
            style={{ width: '100%', aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              const x = ((e.clientX - rect.left) / rect.width) * CANVAS_W
              const y = ((e.clientY - rect.top) / rect.height) * CANVAS_H
              hoverRef.current = pickPlayer(controller.frame, x, y)
            }}
            onMouseLeave={() => (hoverRef.current = null)}
          />

          {kickoffPending && (
            <div className="pitch-overlay">
              <h3>Coup d'envoi imminent</h3>
              <p className="muted">{userTeam.name} reçoit {opponent.name}. Dernière chance de garder votre plan… ou de le changer.</p>
              <div className="overlay-actions">
                <button className="btn ghost" onClick={openTacticalPause}>
                  💬 Dernières consignes
                </button>
                <button className="btn primary big" onClick={() => controller.resume()}>
                  ▶ Coup d'envoi
                </button>
              </div>
            </div>
          )}

          {promptOpen && (
            <div className="pitch-overlay">
              <h3>Pause tactique</h3>
              <p className="muted small">
                Le match est arrêté à la {minuteLabel}. Décrivez vos ajustements — ils s'appliqueront dès la reprise.
              </p>
              <PromptBox
                team={userTeam}
                opponent={opponent}
                current={st.home.instructions}
                settings={settings}
                onApply={applyPromptInstructions}
                placeholder="Ex : « On passe en 4-2-3-1, mentalité offensive, et remplace Lambert par Ribeiro, il est mort. »"
              />
              <div className="overlay-actions">
                <button
                  className="btn ghost"
                  onClick={() => {
                    setPromptOpen(false)
                    controller.resume()
                  }}
                >
                  Reprendre sans rien changer
                </button>
              </div>
            </div>
          )}
        </div>

        <aside className="match-side">
          <StatsPanel engine={engine} userTeam={userTeam} opponent={opponent} />

          <section className="panel">
            <h4>Fil du match</h4>
            <ul className="ticker">
              {st.events
                .slice(-60)
                .reverse()
                .map((ev, i) => (
                  <li key={`${ev.tick}-${i}`} className={`ev-${ev.type}`}>
                    <span className="ev-min">{ev.minute}'</span>
                    <span
                      className="ev-dot"
                      style={{ background: ev.side === 'home' ? userTeam.color : ev.side === 'away' ? opponent.color : 'transparent' }}
                    />
                    {ev.message}
                  </li>
                ))}
              {st.events.length === 0 && <li className="muted">En attente du coup d'envoi…</li>}
            </ul>
          </section>

          <section className="panel">
            <h4>
              Endurance — {userTeam.short}{' '}
              <span className="muted small">
                ({st.home.subsUsed}/{MAX_SUBS} remplacements · {st.home.subWindows}/{MAX_SUB_WINDOWS} fenêtres)
              </span>
            </h4>
            {halftime && !finished && (
              <p className="muted small">Mi-temps : les changements ne consomment pas de fenêtre.</p>
            )}
            {subError && <p className="errors">✗ {subError}</p>}
            <ul className="stamina-list">
              {st.home.lineup.map((id) => {
                const lp = st.players[id]
                if (!lp.onPitch && lp.sentOff) return null // exclu
                const p = userTeam.players.find((pl) => pl.id === id)!
                return (
                  <li key={id}>
                    <span className="st-name" title={p.name}>
                      {p.position} {p.name.split(' ').slice(-1)[0]}
                    </span>
                    <div className={`st-bar v-${lp.stamina > 60 ? 'hi' : lp.stamina > 35 ? 'mid' : 'lo'}`}>
                      <span style={{ width: `${lp.stamina}%` }} />
                    </div>
                    <span className="st-val">{Math.round(lp.stamina)}</span>
                    {canSub && (
                      <button className="icon-btn" title="Remplacer" onClick={() => setSubFor(subFor === id ? null : id)}>
                        🔁
                      </button>
                    )}
                    {subFor === id && (
                      <div className="sub-menu">
                        {bench
                          .filter((b) => (p.role === 'GK' ? b.role === 'GK' : true))
                          .map((b) => (
                            <button key={b.id} onClick={() => doSub(id, b.id)}>
                              {b.position} {b.name} <span className="muted">({Math.round(st.players[b.id].stamina)}%)</span>
                            </button>
                          ))}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  )
}

function StatsPanel({ engine, userTeam, opponent }: { engine: MatchEngine; userTeam: Team; opponent: Team }) {
  const st = engine.state
  const total = st.home.stats.possessionTicks + st.away.stats.possessionTicks || 1
  const homePoss = Math.round((st.home.stats.possessionTicks / total) * 100)
  const rows: { label: string; home: number | string; away: number | string }[] = [
    { label: 'Possession', home: `${homePoss}%`, away: `${100 - homePoss}%` },
    { label: 'Tirs', home: st.home.stats.shots, away: st.away.stats.shots },
    { label: 'Cadrés', home: st.home.stats.shotsOnTarget, away: st.away.stats.shotsOnTarget },
    { label: 'Passes (réussies)', home: `${st.home.stats.passes} (${st.home.stats.passesOk})`, away: `${st.away.stats.passes} (${st.away.stats.passesOk})` },
    { label: 'Corners', home: st.home.stats.corners, away: st.away.stats.corners },
    { label: 'Hors-jeu', home: st.home.stats.offsides, away: st.away.stats.offsides },
    { label: 'Penalties', home: st.home.stats.penalties, away: st.away.stats.penalties },
    { label: 'Fautes', home: st.home.stats.fouls, away: st.away.stats.fouls },
    { label: 'Cartons jaunes', home: st.home.stats.yellowCards, away: st.away.stats.yellowCards },
    { label: 'Cartons rouges', home: st.home.stats.redCards, away: st.away.stats.redCards },
  ]
  return (
    <section className="panel">
      <h4>Statistiques</h4>
      <div className="poss-bar">
        <span style={{ width: `${homePoss}%`, background: userTeam.color }} />
        <span style={{ width: `${100 - homePoss}%`, background: opponent.color }} />
      </div>
      <table className="stats-table">
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th>{r.home}</th>
              <td>{r.label}</td>
              <th>{r.away}</th>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
