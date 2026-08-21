import { useState } from 'react'
import type { MatchInstructions, Team } from '../../engine/types'
import { validateInstructions } from '../../engine/instructions'
import { translatePrompt, type TranslateResult } from '../../llm/translate'
import type { LLMSettings } from '../../llm/presets'
import { teamInstructionChips, describeInstructions } from '../labels'

interface Props {
  team: Team
  opponent: Team
  current: MatchInstructions
  settings: LLMSettings
  onApply: (instr: MatchInstructions) => void
  placeholder?: string
}

export function PromptBox({ team, opponent, current, settings, onApply, placeholder }: Props) {
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<TranslateResult | null>(null)
  const [errors, setErrors] = useState<string[]>([])

  const send = async () => {
    if (!prompt.trim() || loading) return
    setLoading(true)
    setResult(null)
    setErrors([])
    try {
      const r = await translatePrompt({ prompt, team, opponent, current, settings })
      const validation = validateInstructions(r.instructions, team, opponent)
      if (!validation.ok) setErrors(validation.errors)
      setResult(r)
    } catch (e) {
      setErrors([(e as Error).message])
    } finally {
      setLoading(false)
    }
  }

  const apply = () => {
    if (!result) return
    onApply(result.instructions)
    setPrompt('')
    setResult(null)
  }

  return (
    <div className="prompt-box">
      <textarea
        value={prompt}
        placeholder={placeholder ?? 'Ex : « On passe en 4-3-3, pressing haut, et Lambert doit monter son couloir à chaque occasion. Delcourt reste libre. »'}
        rows={3}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send()
        }}
      />
      <div className="prompt-actions">
        <button className="btn primary" onClick={send} disabled={loading || !prompt.trim()}>
          {loading ? 'Le staff réfléchit…' : 'Envoyer au staff'}
        </button>
        <span className="muted small">⌘/Ctrl + Entrée</span>
      </div>

      {result && (
        <div className="prompt-result">
          <div className={`source-badge ${result.source}`}>{result.source === 'llm' ? 'traduit par LLM' : 'mode démo'}</div>
          {result.coachNote && <p className="coach-note">🎙️ {result.coachNote}</p>}

          <div className="chips">
            {teamInstructionChips(result.instructions.team).map((c) => (
              <span key={c.label} className="chip">
                <em>{c.label}</em> {c.value}
              </span>
            ))}
          </div>

          <ul className="player-instructions">
            {describeInstructions(result.instructions, team, opponent).map((line, i) => (
              <li key={i}>{line}</li>
            ))}
            {result.instructions.lineup && current.lineup && result.instructions.lineup.join() !== current.lineup.join() && (
              <li>
                <strong>
                  Composition modifiée :{' '}
                  {result.instructions.lineup.filter((id, i) => id !== current.lineup![i]).length} titulaire(s) changé(s)
                </strong>
              </li>
            )}
          </ul>

          {result.warnings.length > 0 && (
            <div className="warnings">
              {result.warnings.map((w, i) => (
                <p key={i}>⚠️ {w}</p>
              ))}
            </div>
          )}

          {errors.length > 0 && (
            <div className="errors">
              {errors.map((err, i) => (
                <p key={i}>✗ {err}</p>
              ))}
            </div>
          )}

          <div className="prompt-actions">
            <button className="btn primary" onClick={apply} disabled={errors.length > 0}>
              Appliquer ces instructions
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
