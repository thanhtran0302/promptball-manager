// Éditeur manuel d'instructions : produit exactement le même JSON que la
// couche LLM — utile pour jouer sans clé, déboguer ou affiner.

import { useState } from 'react'
import {
  DEF_LINES,
  FORMATIONS,
  MENTALITIES,
  PLAYER_INSTRUCTIONS,
  PRESSINGS,
  TEMPOS,
  WIDTHS,
  validateInstructions,
} from '../../engine/instructions'
import type {
  MatchInstructions,
  PlayerInstruction,
  PlayerInstructionType,
  Team,
} from '../../engine/types'
import { INSTRUCTION_HINTS, INSTRUCTION_LABELS } from '../labels'

interface Props {
  team: Team
  opponent: Team
  value: MatchInstructions
  onChange: (instr: MatchInstructions) => void
}

export function ManualEditor({ team, opponent, value, onChange }: Props) {
  const [newPlayer, setNewPlayer] = useState('')
  const [newInstr, setNewInstr] = useState<PlayerInstructionType>('overlap')
  const [newTarget, setNewTarget] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [open, setOpen] = useState(false)

  const setTeam = (patch: Partial<MatchInstructions['team']>) =>
    onChange({ ...value, team: { ...value.team, ...patch } })

  const addPlayerInstruction = () => {
    if (!newPlayer) return
    const pi: PlayerInstruction = { playerId: newPlayer, instruction: newInstr }
    if (newInstr === 'man_mark' && newTarget) pi.targetPlayerId = newTarget
    onChange({ ...value, players: [...value.players.filter((p) => p.playerId !== newPlayer), pi] })
    setNewPlayer('')
    setNewTarget('')
  }

  const removePlayerInstruction = (playerId: string) =>
    onChange({ ...value, players: value.players.filter((p) => p.playerId !== playerId) })

  const nameOf = (id: string) => team.players.find((p) => p.id === id)?.name ?? id
  const oppNameOf = (id: string) => opponent.players.find((p) => p.id === id)?.name ?? id

  const addSub = (outId: string, inId: string) => {
    if (!outId || !inId || outId === inId) return
    if (value.substitutions.some((s) => s.outPlayerId === outId)) return
    onChange({ ...value, substitutions: [...value.substitutions, { outPlayerId: outId, inPlayerId: inId }] })
  }

  const validate = () => {
    const res = validateInstructions(value, team, opponent)
    setErrors(res.ok ? [] : res.errors)
    return res.ok
  }

  return (
    <div className="manual-editor">
      <button className="btn ghost toggle" onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} Éditeur manuel {open ? '' : '(sans prompting)'}
      </button>

      {open && (
        <div className="editor-body">
          <div className="editor-grid">
            <div>
              <label>Formation</label>
              <select value={value.team.formation} onChange={(e) => setTeam({ formation: e.target.value as MatchInstructions['team']['formation'] })}>
                {FORMATIONS.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </div>
            <div>
              <label>Mentalité</label>
              <select value={value.team.mentality} onChange={(e) => setTeam({ mentality: e.target.value as MatchInstructions['team']['mentality'] })}>
                {MENTALITIES.map((m) => (
                  <option key={m} value={m}>
                    {m.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Pressing</label>
              <select value={value.team.pressing} onChange={(e) => setTeam({ pressing: e.target.value as MatchInstructions['team']['pressing'] })}>
                {PRESSINGS.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <label>Tempo</label>
              <select value={value.team.tempo} onChange={(e) => setTeam({ tempo: e.target.value as MatchInstructions['team']['tempo'] })}>
                {TEMPOS.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label>Largeur</label>
              <select value={value.team.width} onChange={(e) => setTeam({ width: e.target.value as MatchInstructions['team']['width'] })}>
                {WIDTHS.map((w) => (
                  <option key={w}>{w}</option>
                ))}
              </select>
            </div>
            <div>
              <label>Ligne défensive</label>
              <select value={value.team.defensiveLine} onChange={(e) => setTeam({ defensiveLine: e.target.value as MatchInstructions['team']['defensiveLine'] })}>
                {DEF_LINES.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </div>
          </div>

          <h4>Instructions individuelles</h4>
          <ul className="player-instructions">
            {value.players.map((pi) => (
              <li key={pi.playerId}>
                <strong>{nameOf(pi.playerId)}</strong> — {INSTRUCTION_LABELS[pi.instruction]}
                {pi.instruction === 'man_mark' && pi.targetPlayerId ? ` sur ${oppNameOf(pi.targetPlayerId)}` : ''}
                {pi.intensity === 'elevee' ? ' (intensité élevée)' : ''}
                <button className="icon-btn" onClick={() => removePlayerInstruction(pi.playerId)} title="Retirer">
                  ✕
                </button>
              </li>
            ))}
            {value.players.length === 0 && <li className="muted">Aucune instruction individuelle.</li>}
          </ul>

          <div className="editor-row">
            <select value={newPlayer} onChange={(e) => setNewPlayer(e.target.value)}>
              <option value="">— joueur —</option>
              {team.players.filter((p) => !value.players.some((pi) => pi.playerId === p.id)).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.position})
                </option>
              ))}
            </select>
            <select value={newInstr} onChange={(e) => setNewInstr(e.target.value as PlayerInstructionType)}>
              {PLAYER_INSTRUCTIONS.map((i) => (
                <option key={i} value={i}>
                  {INSTRUCTION_LABELS[i]}
                </option>
              ))}
            </select>
            {newInstr === 'man_mark' && (
              <select value={newTarget} onChange={(e) => setNewTarget(e.target.value)}>
                <option value="">— cible adverse —</option>
                {opponent.players.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            <button className="btn" onClick={addPlayerInstruction} disabled={!newPlayer}>
              Ajouter
            </button>
          </div>
          <p className="muted small">{INSTRUCTION_HINTS[newInstr]}</p>

          <h4>Remplacements prévus</h4>
          <ul className="player-instructions">
            {value.substitutions.map((s) => (
              <li key={s.outPlayerId}>
                {nameOf(s.inPlayerId)} à la place de {nameOf(s.outPlayerId)}
                <button
                  className="icon-btn"
                  onClick={() => onChange({ ...value, substitutions: value.substitutions.filter((x) => x.outPlayerId !== s.outPlayerId) })}
                >
                  ✕
                </button>
              </li>
            ))}
            {value.substitutions.length === 0 && <li className="muted">Aucun (possible aussi pendant le match).</li>}
          </ul>
          <SubAdder team={team} lineup={value} onAdd={addSub} />

          {errors.length > 0 && (
            <div className="errors">
              {errors.map((e, i) => (
                <p key={i}>✗ {e}</p>
              ))}
            </div>
          )}
          <button className="btn ghost small-btn" onClick={validate}>
            Vérifier
          </button>
        </div>
      )}
    </div>
  )
}

function SubAdder({ team, lineup, onAdd }: { team: Team; lineup: MatchInstructions; onAdd: (out: string, inP: string) => void }) {
  const [out, setOut] = useState('')
  const [inP, setInP] = useState('')
  const nameOf = (id: string) => team.players.find((p) => p.id === id)?.name ?? id
  return (
    <div className="editor-row">
      <select value={out} onChange={(e) => setOut(e.target.value)}>
        <option value="">— sort —</option>
        {team.players.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <select value={inP} onChange={(e) => setInP(e.target.value)}>
        <option value="">— entre —</option>
        {team.players.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button className="btn" disabled={!out || !inP} onClick={() => { onAdd(out, inP); setOut(''); setInP('') }}>
        Prévoir
      </button>
      {lineup.substitutions.length > 0 && (
        <span className="muted small">{lineup.substitutions.map((s) => `${nameOf(s.inPlayerId)}↔${nameOf(s.outPlayerId)}`).join(' · ')}</span>
      )}
    </div>
  )
}
