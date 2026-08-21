// Traduction prompt → instructions JSON via LLM (OpenAI-compatible),
// avec validation zod, un retry, et fallback mock.

import { matchInstructionsSchema } from '../engine/instructions'
import type { MatchInstructions, Team } from '../engine/types'
import { LLMError, chatCompletion, extractJSON } from './client'
import type { LLMSettings } from './presets'
import { mockTranslate } from './mock'
import { analyzeInstructions } from './localCoach'

export interface TranslateResult {
  instructions: MatchInstructions
  coachNote: string
  warnings: string[]
  source: 'llm' | 'mock'
  errors: string[]
}

const ATTR_LABELS: Record<string, string> = {
  pace: 'vitesse',
  stamina: 'endurance',
  technique: 'technique',
  passing: 'passe',
  shooting: 'tir',
  tackling: 'tacle',
  agility: 'vivacite',
  goalkeeper: 'gardien',
  decisions: 'decisions',
  vision: 'vision',
  composure: 'sang-froid',
  aggression: 'agressivite',
}

function squadContext(team: Team, opponent: Team): string {
  const lines = team.players.map((p) => {
    const attrs = Object.entries(p.attributes)
      .filter(([k]) => k !== 'goalkeeper' || p.role === 'GK')
      .map(([k, v]) => `${ATTR_LABELS[k]}=${v}`)
      .join(', ')
    return `- id=${p.id} | ${p.name} (${p.position}, ${p.role === 'GK' ? 'gardien' : p.role === 'DF' ? 'défenseur' : p.role === 'MD' ? 'milieu' : 'attaquant'}) | ${attrs}`
  })
  const oppLines = opponent.players.map((p) => `- id=${p.id} | ${p.name} (${p.position})`)
  return `JOUEURS DE TON ÉQUIPE (ids à utiliser tels quels) :\n${lines.join('\n')}\n\nJOUEURS ADVERSES (cibles possibles pour man_mark) :\n${oppLines.join('\n')}`
}

const SYSTEM_PROMPT = `Tu es l'adjoint tactique d'un jeu de management football. Le manager te parle en langage naturel ; tu traduis ses consignes en JSON d'instructions STRICT, compris par le moteur de simulation.

Réponds UNIQUEMENT avec un objet JSON de la forme :
{"instructions": {...}, "coach_note": "..."}

Schéma de "instructions" :
{
  "team": {
    "formation": "4-4-2" | "4-3-3" | "4-2-3-1" | "3-5-2" | "5-3-2",
    "mentality": "tres_defensif" | "defensif" | "equilibre" | "offensif" | "tres_offensif",
    "pressing": "bas" | "moyen" | "haut",
    "tempo": "lent" | "moyen" | "rapide",
    "width": "etroit" | "normal" | "large",
    "defensiveLine": "basse" | "moyenne" | "haute"
  },
  "players": [
    { "playerId": "<id exact>", "instruction": "overlap" | "stay_back" | "cut_inside" | "man_mark" | "free_role" | "shoot_more" | "short_passes" | "long_passes", "targetPlayerId": "<id adverse, requis pour man_mark>", "intensity": "normale" | "elevee" (optionnel) }
  ],
  "substitutions": [ { "outPlayerId": "<id>", "inPlayerId": "<id banc>" } ],
  "lineup": ["<id gardien>", "<id>", ..., "<id>"]  (optionnel, exactement 11 ids)
}

Signification des instructions joueur :
- overlap : le joueur monte dans son couloir en attaque (épuisant pour l'endurance)
- stay_back : reste en position défensive, ne participe pas aux attaques
- cut_inside : l'ailier/latéral rentre dans l'axe avec le ballon
- man_mark : marquage individuel du joueur adverse ciblé (targetPlayerId obligatoire)
- free_role : liberté de mouvement, suit le jeu
- shoot_more : tire davantage dès qu'il peut
- short_passes / long_passes : privilégie le jeu court / les longs ballons

Règles impératives :
1. Utilise les ids EXACTS fournis (jamais le nom seul). Maximum UNE instruction par joueur.
2. Ne mets dans "players" et "substitutions" QUE ce que le manager demande explicitement.
3. Si le manager ne mentionne pas un réglage d'équipe, REPRENDS la valeur actuelle fournie.
4. "substitutions" : uniquement si le manager demande un remplacement explicite (max 3).
5. Le gardien ne peut recevoir que "stay_back".
6. "lineup" : NE le fournis QUE si le manager demande un changement de titulaires
   ("fais jouer X", "X titulaire à la place de Y"…). Ordre des postes : gardien d'abord,
   puis défenseurs de gauche à droite, milieux, attaquants — 11 ids exacts, uniques,
   le premier DOIT être un gardien. Si le manager ne touche pas aux titulaires, omet le champ.
7. "coach_note" : 2 phrases max en français, ton d'adjoint, avec un éventuel avertissement pertinent (ex : endurance faible d'un joueur à qui on demande des montées répétées).`

export async function translatePrompt(args: {
  prompt: string
  team: Team
  opponent: Team
  current: MatchInstructions
  settings: LLMSettings
  allowFallback?: boolean
}): Promise<TranslateResult> {
  const { prompt, team, opponent, current, settings } = args

  const warnings = (instr: MatchInstructions) => analyzeInstructions(team, opponent, instr)

  if (!settings.apiKey || !settings.baseUrl || !settings.model) {
    const instr = mockTranslate(prompt, team, opponent, current)
    return {
      instructions: instr,
      coachNote: 'Mode démo (sans clé API) : traduction par mots-clés. ' + warnings(instr).slice(0, 2).join(' '),
      warnings: warnings(instr),
      source: 'mock',
      errors: [],
    }
  }

  const user = `${squadContext(team, opponent)}

Instructions ACTUELLES (reprends ces valeurs si non mentionnées) :
${JSON.stringify(current, null, 1)}

Le manager dit :
« ${prompt} »`

  let lastError = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const messages: string[] = [SYSTEM_PROMPT, user]
    if (lastError) messages.push(`Ta réponse précédente était invalide : ${lastError}\nCorrige et renvoie le JSON valide.`)
    try {
      const raw = await chatCompletion(settings, {
        system: messages[0],
        user: messages.slice(1).join('\n\n'),
        temperature: 0.2,
      })
      const parsed = extractJSON(raw) as { instructions?: unknown; coach_note?: unknown }
      const result = matchInstructionsSchema.safeParse(parsed.instructions ?? parsed)
      if (!result.success) {
        lastError = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
        continue
      }
      const instr = result.data as MatchInstructions
      return {
        instructions: instr,
        coachNote: typeof parsed.coach_note === 'string' ? parsed.coach_note : '',
        warnings: warnings(instr),
        source: 'llm',
        errors: [],
      }
    } catch (e) {
      if (e instanceof LLMError) {
        lastError = e.message
        continue
      }
      throw e
    }
  }

  if (args.allowFallback !== false) {
    const instr = mockTranslate(prompt, team, opponent, current)
    return {
      instructions: instr,
      coachNote: `Le LLM n'a pas répondu correctement (${lastError.slice(0, 120)}). Traduction par mots-clés appliquée — vérifie le résultat.`,
      warnings: warnings(instr),
      source: 'mock',
      errors: [lastError],
    }
  }
  throw new LLMError(`Traduction impossible : ${lastError}`)
}
