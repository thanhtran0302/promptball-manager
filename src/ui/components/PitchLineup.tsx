// Éditeur de composition : terrain vu de dessus (attaque vers la droite),
// un titulaire par poste — clic sur un poste pour choisir le joueur.

import { useState } from 'react'
import { FORMATION_SLOTS, relineupForFormation } from '../../engine/formations'
import { FORMATIONS, type Formation, type Team } from '../../engine/types'

interface Props {
  team: Team
  formation: Formation
  lineup: string[]
  onChange: (next: { formation?: Formation; lineup?: string[] }) => void
}

export function PitchLineup({ team, formation, lineup, onChange }: Props) {
  const [openSlot, setOpenSlot] = useState<number | null>(null)

  const slots = FORMATION_SLOTS[formation]
  const bench = team.players.filter((p) => !lineup.includes(p.id))

  const byId = new Map(team.players.map((p) => [p.id, p]))

  const choose = (slotIdx: number, playerId: string) => {
    const next = [...lineup]
    const j = next.indexOf(playerId)
    if (j >= 0) {
      // échange de postes entre deux titulaires
      ;[next[slotIdx], next[j]] = [next[j], next[slotIdx]]
    } else {
      next[slotIdx] = playerId
    }
    onChange({ lineup: next })
    setOpenSlot(null)
  }

  const changeFormation = (f: Formation) => {
    onChange({ formation: f, lineup: relineupForFormation(lineup, team, f) })
  }

  return (
    <div className="pitch-lineup">
      <div className="pl-head">
        <h3>
          Composition <span className="muted small">— {formation} · cliquez sur un poste</span>
        </h3>
        <select value={formation} onChange={(e) => changeFormation(e.target.value as Formation)}>
          {FORMATIONS.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
      </div>

      <div className="pl-pitch">
        <div className="pl-line pl-half" />
        <div className="pl-circle" />
        <div className="pl-box pl-box-l" />
        <div className="pl-box pl-box-r" />

        {slots.map((slot, i) => {
          const p = byId.get(lineup[i])
          if (!p) return null
          const isGK = p.role === 'GK'
          return (
            <div key={i} className="pl-slot" style={{ left: `${slot.x * 100}%`, top: `${slot.y * 100}%` }}>
              <button
                className={`pl-dot ${isGK ? 'gk' : ''} ${openSlot === i ? 'active' : ''}`}
                style={!isGK ? { background: team.color } : undefined}
                onClick={() => setOpenSlot(openSlot === i ? null : i)}
                title={`${slot.label} — ${p.name}`}
              >
                {i + 1}
              </button>
              <span className="pl-tag">
                {slot.label} · {p.name.split(' ').slice(-1)[0]}
              </span>

              {openSlot === i && (
                <div className="pl-pop">
                  <div className="pl-pop-title">{slot.label} — choisir un joueur</div>
                  {team.players.map((cand) => {
                    const onPitch = lineup.includes(cand.id)
                    const attrs = cand.role === 'GK' ? `GAR ${cand.attributes.goalkeeper}` : `VIT ${cand.attributes.pace} · TEC ${cand.attributes.technique}`
                    return (
                      <button key={cand.id} className="pl-cand" onClick={() => choose(i, cand.id)}>
                        <span className="pl-cand-name">
                          <em>{cand.position}</em> {cand.name}
                        </span>
                        <span className="muted small">{attrs}</span>
                        <span className={`pl-status ${onPitch ? 'on' : ''}`}>{onPitch ? 'terrain' : 'banc'}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="pl-bench">
        <span className="muted small">Banc :</span>
        {bench.map((p) => (
          <span key={p.id} className="pl-bench-chip">
            {p.position} {p.name.split(' ').slice(-1)[0]}
          </span>
        ))}
      </div>
    </div>
  )
}
