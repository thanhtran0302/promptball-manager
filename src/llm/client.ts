// Client OpenAI-compatible unique : OpenAI, Grok (xAI), OpenRouter, custom.

import type { LLMSettings } from './presets'

export class LLMError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LLMError'
  }
}

interface ChatOptions {
  system: string
  user: string
  temperature?: number
  maxTokens?: number
}

export async function chatCompletion(settings: LLMSettings, opts: ChatOptions): Promise<string> {
  const base = settings.baseUrl.replace(/\/+$/, '')
  if (!base) throw new LLMError('URL du fournisseur manquante (réglages LLM).')
  if (!settings.apiKey) throw new LLMError('Clé API manquante (réglages LLM).')

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${settings.apiKey}`,
  }
  if (base.includes('openrouter')) {
    headers['HTTP-Referer'] = typeof location !== 'undefined' ? location.origin : 'https://localhost'
    headers['X-Title'] = 'Prompt Foot Manager'
  }

  let res: Response
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: settings.model,
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens ?? 1200,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.user },
        ],
      }),
    })
  } catch (e) {
    throw new LLMError(`Impossible de joindre ${base} (${(e as Error).message})`)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new LLMError(`Erreur ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 300)}` : ''}`)
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new LLMError('Réponse vide du modèle.')
  return content
}

/** Extrait le premier objet JSON d'un texte (tolère les balises markdown). */
export function extractJSON(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/g, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const start = cleaned.indexOf('{')
    let depth = 0
    for (let i = start; i < cleaned.length; i++) {
      if (cleaned[i] === '{') depth++
      if (cleaned[i] === '}') {
        depth--
        if (depth === 0) {
          return JSON.parse(cleaned.slice(start, i + 1))
        }
      }
    }
    throw new LLMError('Aucun JSON valide dans la réponse du modèle.')
  }
}
