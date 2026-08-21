import { useState } from 'react'
import type { Formation, MatchInstructions, Team } from '../../engine/types'
import type { LLMSettings } from '../../llm/presets'
import { assignSlots, relineupForFormation } from '../../engine/formations'
import { PromptBox } from '../components/PromptBox'
import { ManualEditor } from '../components/ManualEditor'
import { PitchLineup } from '../components/PitchLineup'
import { SettingsModal } from '../components/SettingsModal'
import { teamInstructionChips } from '../labels'

interface Props {
  userTeam: Team
  opponent: Team
  settings: LLMSettings
  onUpdateSettings: (s: LLMSettings) => void
  instructions: MatchInstructions
  onValidate: (instr: MatchInstructions) => void
  onStart: (instr: MatchInstructions) => void
}

/** Garantit une compo valide : 11 joueurs, recalculée si la formation change. */
function normalize(next: MatchInstructions, team: Team, prevFormation: Formation): MatchInstructions {
  let lineup = next.lineup
  if (!lineup || lineup.length !== 11) lineup = assignSlots(team.players, next.team.formation)
  if (next.team.formation !== prevFormation) lineup = relineupForFormation(lineup, team, next.team.formation)
  return { ...next, lineup }
}

export function TacticsScreen({ userTeam, opponent, settings, onUpdateSettings, instructions, onValidate, onStart }: Props) {
  const [showSettings, setShowSettings] = useState(false)
  const [instr, setInstr] = useState<MatchInstructions>(() =>
    normalize(instructions, userTeam, instructions.team.formation),
  )

  const funnel = (next: MatchInstructions) => {
    const fixed = normalize(next, userTeam, instr.team.formation)
    setInstr(fixed)
    onValidate(fixed)
  }

  const formation = instr.team.formation
  const lineup = instr.lineup!

  return (
    <div className="screen tactics">
      <div className="screen-head">
        <h2>Tactique d'avant-match — {userTeam.name}</h2>
        <button className="btn primary big" onClick={() => onStart(instr)}>
          🏟️ Lancer le match
        </button>
      </div>

      <div className="tactics-cols">
        <div className="tactics-main">
          <section className="panel lineup-panel">
            <PitchLineup
              team={userTeam}
              formation={formation}
              lineup={lineup}
              onChange={({ formation: f, lineup: l }) => {
                if (f && f !== formation) {
                  funnel({ ...instr, team: { ...instr.team, formation: f }, lineup: l })
                } else if (l) {
                  funnel({ ...instr, lineup: l })
                }
              }}
            />
          </section>

          <h3>Parlez à votre staff</h3>
          <p className="muted small">
            Décrivez votre plan en langage naturel — tactique, instructions individuelles, et même la
            composition (« fais jouer Fontaine à la place de Zerhouni »). Le staff traduit et vous
            avertit des risques physiques avant même le coup d'envoi.
          </p>
          <PromptBox
            team={userTeam}
            opponent={opponent}
            current={instr}
            settings={settings}
            onApply={funnel}
          />

          <ManualEditor team={userTeam} opponent={opponent} value={instr} onChange={funnel} />
        </div>

        <aside className="tactics-side">
          <h3>Plan actuel</h3>
          <div className="chips">
            {teamInstructionChips(instr.team).map((c) => (
              <span key={c.label} className="chip">
                <em>{c.label}</em> {c.value}
              </span>
            ))}
          </div>
          <ul className="player-instructions">
            {instr.players.length === 0 && <li className="muted">Aucune instruction individuelle.</li>}
            {instr.players.map((pi) => {
              const p = userTeam.players.find((pl) => pl.id === pi.playerId)
              return (
                <li key={pi.playerId}>
                  {p?.name} — {pi.instruction}
                  {pi.intensity === 'elevee' ? ' (élevée)' : ''}
                  {pi.instruction === 'man_mark' && pi.targetPlayerId
                    ? ` → ${opponent.players.find((o) => o.id === pi.targetPlayerId)?.name}`
                    : ''}
                </li>
              )
            })}
          </ul>
          <button className="btn ghost small-btn" onClick={() => setShowSettings(true)}>
            ⚙️ {settings.apiKey ? `LLM : ${settings.model}` : 'Configurer le LLM (mode démo actif)'}
          </button>
        </aside>
      </div>

      {showSettings && <SettingsModal settings={settings} onSave={onUpdateSettings} onClose={() => setShowSettings(false)} />}
    </div>
  )
}
