// Génère src/data/national.generated.json : les clubs du Championnat National
// (rebaptisé Ligue 3 en 2026-27) avec de vrais joueurs, depuis la base FM26
// publiée par FMInside.
//
//   npm run fetch:national
//
// La collecte et la construction sont deux étapes séparées. La collecte se
// fait dans un navigateur (voir scripts/fminside-extract.js) et dépose un
// cache brut ; ce script-ci est pur et instantané. Ajuster les pondérations
// ci-dessous ne recoûte donc jamais une seule requête.
//
// FMInside est derrière Cloudflare et renvoie 403 à tout client automatisé,
// y compris un navigateur piloté à profil neuf : la collecte ne peut pas être
// scriptée depuis Node. Le script d'extraction se colle dans la console d'un
// onglet déjà ouvert sur le site, où la session a franchi le challenge.

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Player, PlayerAttributes, Role, Team } from '../src/engine/types'

const COMPETITION = 'https://fminside.net/competitions/7-fm-26/18-championnat-national'
const CACHE = '.cache/fminside/raw.json'
const OUT = 'src/data/national.generated.json'

/** La Ligue 3 aligne 18 clubs ; en compter moins signale un trou côté source. */
const EXPECTED_CLUBS = 18
const SQUAD_SIZE = 16

/**
 * Composition des 12 attributs du moteur à partir des attributs FM.
 *
 * FMInside publie déjà sur une échelle 1-99 (= attribut FM x 5) : aucune
 * conversion d'échelle n'est nécessaire, seulement des moyennes pondérées.
 *
 * Un attribut source absent de la fiche est retiré de la moyenne, qui est
 * renormalisée sur les poids restants. C'est ce qui fait tenir les fiches de
 * gardien, où tout le bloc Technical est remplacé par un bloc Goalkeeping.
 */
const WEIGHTS: Record<keyof PlayerAttributes, Record<string, number>> = {
  pace: { Pace: 0.6, Acceleration: 0.4 },
  stamina: { Stamina: 0.75, 'Natural Fitness': 0.25 },
  technique: { Technique: 1, 'First Touch': 1, Dribbling: 1 },
  passing: { Passing: 1 },
  shooting: { Finishing: 0.75, 'Long Shots': 0.25 },
  tackling: { Tackling: 0.5, Marking: 0.25, Anticipation: 0.25 },
  agility: { Agility: 0.6, Balance: 0.4 },
  goalkeeper: { Reflexes: 0.4, Handling: 0.3, 'One on Ones': 0.3 },
  decisions: { Decisions: 1 },
  vision: { Vision: 1 },
  composure: { Composure: 0.7, Concentration: 0.3 },
  aggression: { Aggression: 0.6, 'Work Rate': 0.4 },
}

/** Valeur retenue quand aucun attribut source n'est présent sur la fiche. */
const FALLBACK: Record<keyof PlayerAttributes, number> = {
  pace: 50, stamina: 50, technique: 50, passing: 50, shooting: 25, tackling: 40,
  agility: 50, goalkeeper: 15, decisions: 50, vision: 50, composure: 50, aggression: 50,
}

/**
 * Décalage entre familles d'attributs FM, appliqué après composition.
 *
 * Rien ne permet de comparer un « Reflexes 12 » à un « Finishing 12 » : chaque
 * attribut FM a son échelle implicite, calibrée pour que le jeu fonctionne, pas
 * pour être comparable aux autres. Mesuré sur les 425 joueurs collectés, poste
 * par poste : les attaquants sortent à 53,4 en composite shooting, les gardiens
 * à 56,3 en composite goalkeeper — un écart de −2,9 là où les équipes fictives,
 * écrites à la main sur une échelle unique, affichent +6,8.
 *
 * Le moteur compare directement ces deux composites (`conv = 0.26 +
 * (shooting - goalkeeper) / 150`) et a été calibré sur les +6,8 des équipes
 * fictives. L'offset réaligne les données réelles sur cette même relation,
 * faute de quoi la formule, pourtant relative, décroche.
 *
 * Valeur empirique : elle vaut ce que vaut sa mesure, et se recale avec
 * `npm run sim -- 30 --check --real`.
 */
const SCALE_OFFSET: Partial<Record<keyof PlayerAttributes, number>> = {
  goalkeeper: -10,
}

/**
 * Une fiche de gardien conserve les attributs mentaux (Anticipation,
 * Aggression…). La renormalisation ferait alors sortir `tackling` de la seule
 * Anticipation — un gardien à 70 en tacle. On force ces deux valeurs après
 * coup plutôt que de tordre les poids pour un cas particulier.
 */
const GK_OVERRIDES: Partial<Record<keyof PlayerAttributes, number>> = {
  shooting: 22,
  tackling: 38,
}

/** Postes FMInside vers le couple (rôle moteur, libellé de poste). */
const POSITIONS: Record<string, { role: Role; position: string }> = {
  GK: { role: 'GK', position: 'G' },
  DL: { role: 'DF', position: 'DG' },
  DC: { role: 'DF', position: 'DC' },
  DR: { role: 'DF', position: 'DD' },
  WBL: { role: 'DF', position: 'DG' },
  WBR: { role: 'DF', position: 'DD' },
  DM: { role: 'MD', position: 'MDC' },
  MC: { role: 'MD', position: 'MC' },
  ML: { role: 'MD', position: 'MG' },
  MR: { role: 'MD', position: 'MD' },
  AMC: { role: 'MD', position: 'MC' },
  AML: { role: 'AT', position: 'AG' },
  AMR: { role: 'AT', position: 'AD' },
  ST: { role: 'AT', position: 'BU' },
}

/**
 * FMInside ne publie pas les couleurs des clubs. À défaut, une teinte stable
 * est dérivée du slug. Remplis cette table pour les clubs qui comptent.
 */
const CLUB_COLORS: Record<string, [string, string]> = {
  // '877-sm-caen': ['#c8102e', '#fde2e5'],
}

export interface RawPlayer {
  uid: string
  name: string
  positions: string[]
  ability: number
  attrs: Record<string, number>
}

export interface RawClub {
  slug: string
  name: string
  players: RawPlayer[]
}

// --- Mapping (pur, testable sans réseau) ------------------------------------

function clamp99(v: number): number {
  return Math.max(1, Math.min(99, Math.round(v)))
}

export function composeAttribute(
  key: keyof PlayerAttributes,
  attrs: Record<string, number>,
): number {
  let sum = 0
  let weight = 0
  for (const [source, w] of Object.entries(WEIGHTS[key])) {
    const v = attrs[source]
    if (typeof v === 'number' && Number.isFinite(v)) {
      sum += v * w
      weight += w
    }
  }
  // L'offset ne s'applique qu'à une valeur réellement composée : un repli
  // n'a pas d'échelle FM à corriger.
  if (weight === 0) return FALLBACK[key]
  return clamp99(sum / weight + (SCALE_OFFSET[key] ?? 0))
}

export function mapAttributes(attrs: Record<string, number>, role: Role): PlayerAttributes {
  const out = {} as PlayerAttributes
  for (const key of Object.keys(WEIGHTS) as (keyof PlayerAttributes)[]) {
    out[key] = composeAttribute(key, attrs)
  }
  if (role === 'GK') Object.assign(out, GK_OVERRIDES)
  return out
}

/** Premier poste reconnu de la liste FMInside, ou null si aucun ne l'est. */
export function mapPosition(positions: string[]): { role: Role; position: string } | null {
  for (const p of positions) {
    const hit = POSITIONS[p.trim().toUpperCase()]
    if (hit) return hit
  }
  return null
}

const NAME_NOISE = /^(FC|SC|SM|AS|US|AJ|RC|SO|CS|Stade|Le|La|Les|En)$/i

/** Trigramme d'affichage : « SM Caen » -> CAE, « Bourg en Bresse » -> BOU. */
export function shortCode(name: string): string {
  const words = name.split(/[\s-]+/).filter((w) => w && !NAME_NOISE.test(w))
  const base = (words[0] ?? name).replace(/[^A-Za-zÀ-ÿ]/g, '')
  return (base.slice(0, 3) || 'CLB').toUpperCase()
}

function hslHex(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100)
  const channel = (n: number): string => {
    const k = (n + h / 30) % 12
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(255 * c).toString(16).padStart(2, '0')
  }
  return `#${channel(0)}${channel(8)}${channel(4)}`
}

export function clubColors(slug: string): [string, string] {
  const override = CLUB_COLORS[slug]
  if (override) return override
  const hue = parseInt(createHash('sha1').update(slug).digest('hex').slice(0, 4), 16) % 360
  return [hslHex(hue, 62, 45), hslHex(hue, 70, 90)]
}

// --- Sélection du groupe ----------------------------------------------------

/**
 * Plancher imposé par les onze formations de FORMATION_SLOTS : la plus
 * gourmande de chaque ligne demande 5 DF (5-3-2, 5-4-1), 5 MD (4-2-3-1, 3-5-2,
 * 4-1-4-1, 4-4-1-1, 4-5-1) et 4 AT (4-2-4).
 *
 * Avec un gardien remplaçant : 2 + 5 + 5 + 4 = 16, soit exactement la taille du
 * groupe. Les quotas le déterminent donc entièrement — la boucle au mérite de
 * selectSquad ne sert plus qu'aux clubs dont une ligne est trop courte à la
 * source.
 */
const MIN_BY_ROLE: Record<Role, number> = { GK: 2, DF: 5, MD: 5, AT: 4 }

/** Liste vide = groupe conforme. */
export function squadViolations(squad: Player[]): string[] {
  const out: string[] = []
  if (squad.length !== SQUAD_SIZE) {
    out.push(`${squad.length} joueurs au lieu de ${SQUAD_SIZE}`)
  }
  for (const [role, min] of Object.entries(MIN_BY_ROLE) as [Role, number][]) {
    const n = squad.filter((p) => p.role === role).length
    if (n < min) out.push(`${n} ${role} pour ${min} minimum`)
  }
  return out
}

/**
 * Retient les 16 joueurs du groupe parmi les ~25 de l'effectif FM.
 * `players` arrive trié par ability FMInside décroissante.
 *
 * Règle : les quotas de MIN_BY_ROLE sont servis d'abord, chaque ligne prenant
 * ses meilleurs éléments ; la place restante va au meilleur joueur encore
 * disponible, quel que soit son poste.
 *
 * Trier par qualité et couper à 16 ne suffit pas : en D3 les gardiens sont
 * systématiquement moins bien notés que les joueurs de champ, donc ils sortent
 * toujours en dernier au classement brut — c'est ainsi qu'Orléans se
 * retrouvait sans aucun gardien. Servir les quotas d'abord coûte quelques
 * points de qualité moyenne et garantit un groupe jouable dans les cinq
 * formations.
 *
 * Une ligne trop courte à la source est laissée telle quelle : le manque
 * ressort alors dans squadViolations() au lieu d'être masqué.
 */
export function selectSquad(players: Player[]): Player[] {
  const squad: Player[] = []
  for (const [role, quota] of Object.entries(MIN_BY_ROLE) as [Role, number][]) {
    squad.push(...players.filter((p) => p.role === role).slice(0, quota))
  }
  const taken = new Set(squad.map((p) => p.id))
  for (const p of players) {
    if (squad.length >= SQUAD_SIZE) break
    if (!taken.has(p.id)) squad.push(p)
  }
  return squad
}

// --- Construction -----------------------------------------------------------

const ROLE_ORDER: Record<Role, number> = { GK: 0, DF: 1, MD: 2, AT: 3 }

export function buildTeam(club: RawClub): { team: Team; skipped: string[] } {
  const skipped: string[] = []
  const players: Player[] = []

  for (const raw of [...club.players].sort((a, b) => b.ability - a.ability)) {
    const pos = mapPosition(raw.positions)
    if (!pos) {
      skipped.push(`${raw.name} (${raw.positions.join('/') || 'poste absent'})`)
      continue
    }
    players.push({
      id: `fm-${raw.uid}`,
      name: raw.name,
      role: pos.role,
      position: pos.position,
      attributes: mapAttributes(raw.attrs, pos.role),
    })
  }

  // Le tri est stable : à rôle égal, l'ordre par ability est conservé.
  const squad = selectSquad(players).sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role])
  const [color, colorAlt] = clubColors(club.slug)

  return {
    team: {
      id: club.slug,
      name: club.name,
      short: shortCode(club.name),
      color,
      colorAlt,
      players: squad,
    },
    skipped,
  }
}

// --- Entrée -----------------------------------------------------------------

async function readCache(): Promise<RawClub[] | null> {
  try {
    return JSON.parse(await readFile(CACHE, 'utf8')) as RawClub[]
  } catch {
    return null
  }
}

const MISSING_CACHE = `Cache absent : ${CACHE}

FMInside renvoie 403 à tout client automatisé : la collecte se fait à la main,
depuis un navigateur où la session a franchi le challenge Cloudflare.

  1. Ouvrir ${COMPETITION}
  2. DevTools > Console, coller scripts/fminside-extract.js, Entrée
  3. Attendre ~5 min — un national-raw.json se télécharge
  4. mkdir -p ${dirname(CACHE)}
     mv ~/Downloads/national-raw.json ${CACHE}
  5. Relancer cette commande
`

async function main(): Promise<void> {
  const clubs = await readCache()
  if (!clubs) {
    console.error(MISSING_CACHE)
    process.exit(1)
  }

  console.log(`Cache : ${CACHE} (${clubs.length} clubs)`)
  if (clubs.length < EXPECTED_CLUBS) {
    console.warn(
      `⚠️  ${clubs.length} clubs alors que la Ligue 3 en compte ${EXPECTED_CLUBS} — ` +
        `il manque ${EXPECTED_CLUBS - clubs.length} club(s) côté FMInside.`,
    )
  }

  const teams: Team[] = []
  let problems = 0

  for (const club of clubs) {
    const { team, skipped } = buildTeam(club)
    teams.push(team)

    if (skipped.length > 0) {
      console.warn(`⚠️  ${team.name} — poste non reconnu : ${skipped.join(', ')}`)
      problems++
    }
    const violations = squadViolations(team.players)
    if (violations.length > 0) {
      console.warn(`⚠️  ${team.name} — groupe non conforme : ${violations.join(' ; ')}`)
      problems++
    }
  }

  await mkdir(dirname(OUT), { recursive: true })
  await writeFile(OUT, JSON.stringify(teams, null, 2))

  const total = teams.reduce((n, t) => n + t.players.length, 0)
  console.log(`\n${OUT} — ${teams.length} clubs, ${total} joueurs`)
  if (problems > 0) console.log(`${problems} avertissement(s) ci-dessus.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
