import { useState } from 'react'
import { TEAMS } from '../../data/teams'
import type { LLMSettings } from '../../llm/presets'
import { SettingsModal } from '../components/SettingsModal'

interface Props {
  userTeamId: string
  onChooseTeam: (id: string) => void
  onGoSquad: () => void
  settings: LLMSettings
  onUpdateSettings: (s: LLMSettings) => void
}

export function SetupScreen({ userTeamId, onChooseTeam, onGoSquad, settings, onUpdateSettings }: Props) {
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
        {TEAMS.map((t) => (
          <button
            key={t.id}
            className={`team-card ${userTeamId === t.id ? 'selected' : ''}`}
            onClick={() => onChooseTeam(t.id)}
          >
            <span className="team-jersey" style={{ background: t.color }} />
            <span className="team-name">{t.name}</span>
            <span className="muted small">{t.id === 'lumiere' ? 'Technique · possession' : 'Physique · direct'}</span>
          </button>
        ))}
      </div>

      <div className="setup-actions">
        <button className="btn ghost" onClick={() => setShowSettings(true)}>
          ⚙️ Réglages LLM {settings.apiKey ? '' : '(mode démo)'}
        </button>
        <button className="btn primary big" onClick={onGoSquad}>
          Voir l'effectif →
        </button>
      </div>

      {showSettings && <SettingsModal settings={settings} onSave={onUpdateSettings} onClose={() => setShowSettings(false)} />}
    </div>
  )
}
