import { useState } from 'react'
import { PRESETS, type LLMSettings } from '../../llm/presets'

interface Props {
  settings: LLMSettings
  onSave: (s: LLMSettings) => void
  onClose: () => void
}

export function SettingsModal({ settings, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<LLMSettings>(settings)
  const preset = PRESETS.find((p) => p.id === draft.presetId)

  const applyPreset = (id: string) => {
    const p = PRESETS.find((p) => p.id === id)
    if (!p) return
    setDraft({ ...draft, presetId: id, baseUrl: p.baseUrl, model: p.model })
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Réglages LLM</h2>
        <p className="muted small">
          Le jeu interroge n'importe quel fournisseur compatible avec le protocole OpenAI.
          Sans clé, le jeu reste jouable : la traduction des prompts se fait alors par mots-clés (mode démo)
          et l'éditeur manuel reste disponible.
        </p>

        <label>Fournisseur</label>
        <div className="preset-row">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              className={`chip-btn ${draft.presetId === p.id ? 'active' : ''}`}
              onClick={() => applyPreset(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset && <p className="muted small">{preset.hint}</p>}

        <label>Base URL</label>
        <input
          value={draft.baseUrl}
          placeholder="https://…/v1"
          onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
        />

        <label>Modèle</label>
        <input
          value={draft.model}
          placeholder="provider/modele (OpenRouter) ou modele"
          onChange={(e) => setDraft({ ...draft, model: e.target.value })}
        />

        <label>Clé API</label>
        <input
          type="password"
          value={draft.apiKey}
          placeholder="sk-…"
          onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
        />
        <p className="muted small">
          La clé reste dans le navigateur (localStorage) et n'est envoyée qu'au fournisseur choisi.
          Pour une version publique, il faudrait passer par un petit backend proxy.
        </p>

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>
            Annuler
          </button>
          <button className="btn primary" onClick={() => { onSave(draft); onClose() }}>
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  )
}
