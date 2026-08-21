// Presets de fournisseurs — tous compatibles avec le protocole OpenAI
// (chat/completions). OpenRouter permet en plus de choisir n'importe quel
// modèle via le champ model ("provider/modele").

export interface LLMPreset {
  id: string
  label: string
  baseUrl: string
  model: string
  hint: string
}

export const PRESETS: LLMPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    hint: 'Clé sur platform.openai.com — sk-…',
  },
  {
    id: 'grok',
    label: 'Grok (xAI)',
    baseUrl: 'https://api.x.ai/v1',
    model: 'grok-3-mini',
    hint: 'Clé sur console.x.ai — xai-…',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
    hint: 'Clé sur openrouter.ai — sk-or-… — n’importe quel modèle au format "provider/modele"',
  },
]

export interface LLMSettings {
  presetId: string
  baseUrl: string
  apiKey: string
  model: string
}

export const DEFAULT_SETTINGS: LLMSettings = {
  presetId: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  model: 'openai/gpt-4o-mini',
  apiKey: '',
}

const STORAGE_KEY = 'pfm-llm-settings'

export function loadSettings(): LLMSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const s = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
      // preset inconnu (ex. ancien "custom") : on retombe sur OpenRouter sans toucher l'URL/modèle
      if (!PRESETS.some((p) => p.id === s.presetId)) s.presetId = DEFAULT_SETTINGS.presetId
      return s
    }
  } catch {
    // localStorage indisponible : réglages par défaut
  }
  return { ...DEFAULT_SETTINGS }
}

export function saveSettings(s: LLMSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    // ignore
  }
}

export function isConfigured(s: LLMSettings): boolean {
  return Boolean(s.baseUrl && s.model && s.apiKey)
}
