import { useState } from 'react'
import { ALL_TEAMS } from '../../data/allTeams'
import type { Team } from '../../engine/types'
import type { LLMSettings } from '../../llm/presets'
import { SettingsModal } from '../components/SettingsModal'

/** Attributs retenus pour situer un club d'un coup d'oeil. */
const RATED = ['pace', 'technique', 'passing', 'shooting', 'tackling', 'decisions'] as const

/**
 * Descriptif d'une carte d'équipe. Les deux équipes fictives ont un style
 * écrit à la main ; pour les clubs réels, seul un niveau moyen permet de
 * choisir parmi dix-sept.
 */
function tagline(team: Team): string {
  const written: Record<string, string> = {
    lumiere: 'Technique · possession',
    atlantique: 'Physique · direct',
  }
  if (written[team.id]) return written[team.id]
  const total = team.players.reduce(
    (sum, p) => sum + RATED.reduce((n, k) => n + p.attributes[k], 0) / RATED.length,
    0,
  )
  return `Niveau moyen ${Math.round(total / team.players.length)}`
}

interface Props {
  userTeamId: string
  onChooseTeam: (id: string) => void
  onGoSquad: () => void
  settings: LLMSettings
  onUpdateSettings: (s: LLMSettings) => void
  knockout: boolean
  onToggleKnockout: (v: boolean) => void
}

export function SetupScreen({
  userTeamId,
  onChooseTeam,
  onGoSquad,
  settings,
  onUpdateSettings,
  knockout,
  onToggleKnockout,
}: Props) {
  const [showSettings, setShowSettings] = useState(false)

  return (
    <div className="screen setup">
      <div className="hero">
        <h1>Le football manager qui se pilote au prompt</h1>
        <p className="muted">
          Formation, mentalité, instructions individuelles, remplacements : tout passe par le langage naturel.
          Le moteur simule le match minute par minute — vos joueurs obéissent, mais leur endurance, leur
          vitesse et leur technique décident de ce qu'ils peuvent réellement faire.
        </p>
      </div>

      <h2>Choisissez votre équipe</h2>
      <div className="team-choice">
        {ALL_TEAMS.map((t) => (
          <button
            key={t.id}
            className={`team-card ${userTeamId === t.id ? 'selected' : ''}`}
            onClick={() => onChooseTeam(t.id)}
          >
            <span className="team-jersey" style={{ background: t.color }} />
            <span className="team-name">{t.name}</span>
            <span className="muted small">{tagline(t)}</span>
          </button>
        ))}
      </div>

      <div className="setup-actions">
        <button className="btn ghost" onClick={() => setShowSettings(true)}>
          ⚙️ Réglages LLM {settings.apiKey ? '' : '(mode démo)'}
        </button>
        <label className="muted small">
          <input type="checkbox" checked={knockout} onChange={(e) => onToggleKnockout(e.target.checked)} />{' '}
          Élimination directe (prolongation si nul)
        </label>
        <button className="btn primary big" onClick={onGoSquad}>
          Voir l'effectif →
        </button>
      </div>

      {showSettings && <SettingsModal settings={settings} onSave={onUpdateSettings} onClose={() => setShowSettings(false)} />}
    </div>
  )
}
