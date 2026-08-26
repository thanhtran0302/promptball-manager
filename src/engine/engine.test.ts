import { describe, expect, it } from 'vitest'
import { MatchEngine } from './sim'
import { defaultInstructions, validateInstructions } from './instructions'
import { attackTarget, type AttackSliceInput } from './slices'
import { TEAMS } from '../data/teams'
import { FORMATION_SLOTS } from './formations'
import { EXTRA_HALF_TICKS, HALF_TICKS, TICK_SEC, isBreak, isExtraTime, type Player, type Team } from './types'

const [home, away] = TEAMS

function runFullMatch(seed = 42) {
  const engine = new MatchEngine({
    home,
    away,
    homeInstructions: defaultInstructions(),
    awayInstructions: defaultInstructions(),
    seed,
  })
  let guard = 0
  while (engine.state.phase !== 'finished' && guard++ < 500) {
    engine.runTicks(500)
    if (engine.state.phase === 'halftime') engine.startNextPeriod()
  }
  return engine
}

/**
 * Le banc de teams.ts ne compte que quatre joueurs de champ : trop peu pour
 * éprouver le plafond de cinq remplacements. On l'étoffe avec des doublures
 * volontairement médiocres, qui ne peuvent donc pas prendre une place de
 * titulaire dans assignSlots.
 */
const deepHome: Team = (() => {
  const model = home.players.find((p) => p.role === 'MD')!
  const attributes = { ...model.attributes }
  for (const k of Object.keys(attributes) as (keyof typeof attributes)[]) {
    attributes[k] = Math.min(attributes[k], 35)
  }
  const extra: Player[] = Array.from({ length: 4 }, (_, i) => ({
    ...model,
    id: `hsub${i}`,
    name: `Doublure ${i}`,
    attributes,
  }))
  return { ...home, players: [...home.players, ...extra] }
})()

function subEngine() {
  return new MatchEngine({
    home: deepHome,
    away,
    homeInstructions: defaultInstructions(),
    awayInstructions: defaultInstructions(),
    seed: 5,
  })
}

/** Remplaçants de champ disponibles, dans l'ordre de l'effectif. */
function benchIds(engine: MatchEngine): string[] {
  return deepHome.players
    .filter((p) => !engine.state.home.lineup.includes(p.id) && p.role !== 'GK')
    .map((p) => p.id)
}

/** Notes de tous les titulaires sur plusieurs matchs, avec de quoi les qualifier. */
function ratingsOver(seeds: number[]) {
  const out: {
    rating: number
    goals: number
    assists: number
    shots: number
    sentOff: boolean
  }[] = []
  for (const seed of seeds) {
    const engine = runFullMatch(seed)
    for (const tms of [engine.state.home, engine.state.away]) {
      for (const id of tms.lineup) {
        const lp = engine.state.players[id]
        out.push({
          rating: lp.stats.rating,
          goals: lp.stats.goals,
          assists: lp.stats.assists,
          shots: lp.stats.shots,
          sentOff: lp.sentOff,
        })
      }
    }
  }
  return out
}

/**
 * Effectif au profil moyen de la Ligue 3, mesuré sur les 272 joueurs scrapés.
 * Les deux équipes fictives qui servent de référence au bench tournent à 68 de
 * technique et 67 de décisions ; la Ligue 3 réelle est à 51 et 57, et son
 * gardien est mieux noté que ses attaquants ne frappent. Le moteur doit
 * produire du football sur CE profil-là, pas seulement sur des joueurs d'élite.
 */
function ligue3Squad(id: string, name: string): Team {
  const slots = FORMATION_SLOTS['4-4-2'].map((s) => ({ role: s.role, position: s.label }))
  const bench = [
    { role: 'GK' as const, position: 'G' },
    { role: 'DF' as const, position: 'DC' },
    { role: 'MD' as const, position: 'MC' },
    { role: 'AT' as const, position: 'BU' },
    { role: 'DF' as const, position: 'DD' },
  ]
  const players: Player[] = [...slots, ...bench].map((r, i) => ({
    id: `${id}${i}`,
    name: `${name} ${i}`,
    role: r.role,
    position: r.position,
    attributes: {
      pace: 58,
      stamina: 52,
      technique: 51,
      passing: 53,
      agility: 52,
      decisions: 57,
      vision: 52,
      composure: 52,
      aggression: 52,
      shooting: r.role === 'AT' ? 52 : r.role === 'MD' ? 42 : 32,
      tackling: r.role === 'DF' ? 56 : 42,
      goalkeeper: r.role === 'GK' ? 58 : 20,
    },
  }))
  return { id, name, short: name.slice(0, 3).toUpperCase(), color: '#111', colorAlt: '#eee', players }
}

describe('MatchEngine', () => {
  it('est déterministe : même seed ⇒ même match', () => {
    const a = runFullMatch(1234)
    const b = runFullMatch(1234)
    expect(JSON.stringify(a.state.events)).toEqual(JSON.stringify(b.state.events))
    expect(a.state.score).toEqual(b.state.score)
    expect(JSON.stringify(a.state.players)).toEqual(JSON.stringify(b.state.players))
  })

  it('termine un match complet avec des stats plausibles', () => {
    const engine = runFullMatch(7)
    const st = engine.state
    expect(st.phase).toBe('finished')

    const totalGoals = st.score.home + st.score.away
    expect(totalGoals).toBeGreaterThanOrEqual(0)
    expect(totalGoals).toBeLessThanOrEqual(12)

    for (const tms of [st.home, st.away]) {
      expect(tms.stats.shots).toBeGreaterThanOrEqual(2)
      expect(tms.stats.shots).toBeLessThanOrEqual(45)
      expect(tms.stats.shotsOnTarget).toBeLessThanOrEqual(tms.stats.shots)
    }

    const totalPoss = st.home.stats.possessionTicks + st.away.stats.possessionTicks
    const homeShare = st.home.stats.possessionTicks / totalPoss
    expect(homeShare).toBeGreaterThan(0.2)
    expect(homeShare).toBeLessThan(0.8)

    // les titulaires sont fatigués en fin de match (chacun < 93 %, moyenne < 80 %)
    let staminaSum = 0
    let staminaCount = 0
    for (const lp of Object.values(st.players)) {
      const p = [...home.players, ...away.players].find((x) => x.id === lp.id)!
      if (p.role === 'GK' || lp.stats.distance < 6000) continue
      expect(lp.stamina).toBeLessThan(93)
      expect(lp.stamina).toBeGreaterThanOrEqual(0)
      staminaSum += lp.stamina
      staminaCount++
    }
    expect(staminaSum / Math.max(staminaCount, 1)).toBeLessThan(80)

    // chaque équipe a bien 11 joueurs sur le terrain
    expect(st.home.lineup).toHaveLength(11)
    expect(st.away.lineup).toHaveLength(11)

    // discipline plausible
    expect(st.home.stats.redCards + st.away.stats.redCards).toBeLessThanOrEqual(4)
    expect(st.home.stats.penalties + st.away.stats.penalties).toBeLessThanOrEqual(5)
  })

  it('le gardien est dans la composition initiale', () => {
    const engine = new MatchEngine({
      home,
      away,
      homeInstructions: defaultInstructions(),
      awayInstructions: defaultInstructions(),
      seed: 1,
    })
    const gk = engine.state.home.lineup.map((id) => home.players.find((p) => p.id === id)!)
    expect(gk.filter((p) => p.role === 'GK')).toHaveLength(1)
  })

  it('applique un changement de formation en cours de match', () => {
    const engine = new MatchEngine({
      home,
      away,
      homeInstructions: defaultInstructions(),
      awayInstructions: defaultInstructions(),
      seed: 3,
    })
    engine.runTicks(100)
    const instr = defaultInstructions()
    instr.team = { ...instr.team, formation: '3-5-2' }
    engine.applyInstructions('home', instr)
    expect(engine.state.home.instructions.team.formation).toBe('3-5-2')
    expect(engine.state.home.lineup).toHaveLength(11)
    // toujours 11 sur le terrain
    const onPitch = engine.state.home.lineup.filter((id) => engine.state.players[id].onPitch)
    expect(onPitch).toHaveLength(11)
  })

  it('gère les remplacements : 5 joueurs max, banc/terrain vérifiés', () => {
    const engine = subEngine()
    const lineup = [...engine.state.home.lineup]
    const bench = benchIds(engine)
    // cinq joueurs doivent tenir dans trois fenêtres : 2 + 2 + 1
    let n = 0
    for (const perWindow of [2, 2, 1]) {
      engine.runTicks(1) // un tick entre chaque groupe = une nouvelle fenêtre
      for (let k = 0; k < perWindow; k++, n++) {
        expect(engine.makeSub('home', lineup[n + 1], bench[n]).ok).toBe(true)
      }
    }
    expect(engine.state.home.subsUsed).toBe(5)
    expect(engine.state.home.subWindows).toBe(3)
    // 6e joueur refusé, même dans une fenêtre déjà ouverte
    expect(engine.makeSub('home', lineup[7], bench[5]).ok).toBe(false)
    // entrant déjà sur le terrain refusé
    expect(engine.makeSub('away', engine.state.away.lineup[0], engine.state.away.lineup[1]).ok).toBe(false)
  })

  it('plafonne à 3 fenêtres de remplacement', () => {
    const engine = subEngine()
    const lineup = [...engine.state.home.lineup]
    const bench = benchIds(engine)
    for (let i = 0; i < 3; i++) {
      engine.runTicks(1)
      expect(engine.makeSub('home', lineup[i + 1], bench[i]).ok).toBe(true)
    }
    expect(engine.state.home.subWindows).toBe(3)
    // 4e fenêtre refusée, alors qu'il reste deux joueurs remplaçables
    engine.runTicks(1)
    const r = engine.makeSub('home', lineup[5], bench[3])
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/fenêtre/)
    expect(engine.state.home.subsUsed).toBe(3)
  })

  it('plusieurs changements dans le même tick ne consomment qu\'une fenêtre', () => {
    const engine = subEngine()
    const lineup = [...engine.state.home.lineup]
    const bench = benchIds(engine)
    engine.runTicks(1)
    expect(engine.makeSub('home', lineup[1], bench[0]).ok).toBe(true)
    expect(engine.makeSub('home', lineup[2], bench[1]).ok).toBe(true)
    expect(engine.makeSub('home', lineup[3], bench[2]).ok).toBe(true)
    expect(engine.state.home.subsUsed).toBe(3)
    expect(engine.state.home.subWindows).toBe(1)
  })

  it('les changements de la mi-temps ne consomment aucune fenêtre', () => {
    const engine = subEngine()
    const lineup = [...engine.state.home.lineup]
    const bench = benchIds(engine)
    for (let i = 0; i < 3; i++) {
      engine.runTicks(1)
      expect(engine.makeSub('home', lineup[i + 1], bench[i]).ok).toBe(true)
    }
    let guard = 0
    while (engine.state.phase !== 'halftime' && guard++ < 100) engine.runTicks(1000)
    expect(engine.state.phase).toBe('halftime')
    // les trois fenêtres sont épuisées, et pourtant le changement passe
    expect(engine.makeSub('home', lineup[5], bench[3]).ok).toBe(true)
    expect(engine.state.home.subsUsed).toBe(4)
    expect(engine.state.home.subWindows).toBe(3)
    // la reprise n'hérite pas d'une fenêtre restée ouverte
    engine.startNextPeriod()
    engine.runTicks(1)
    expect(engine.makeSub('home', lineup[6], bench[4]).ok).toBe(false)
  })

  it('un joueur remplacé ne peut pas revenir en jeu', () => {
    const engine = subEngine()
    const outId = engine.state.home.lineup[3]
    const bench = benchIds(engine)
    engine.runTicks(1)
    expect(engine.makeSub('home', outId, bench[0]).ok).toBe(true)
    expect(engine.state.players[outId].subbedOff).toBe(true)
    engine.runTicks(1)
    const back = engine.makeSub('home', engine.state.home.lineup[4], outId)
    expect(back.ok).toBe(false)
    expect(back.error).toMatch(/déjà été remplacé/)
  })

  it('le coach automatique remplace ses joueurs émoussés, dans les limites', () => {
    const engine = new MatchEngine({
      home,
      away,
      homeInstructions: defaultInstructions(),
      awayInstructions: defaultInstructions(),
      seed: 5,
      autoSubSides: ['away'],
    })
    let guard = 0
    while (engine.state.phase !== 'finished' && guard++ < 500) {
      engine.runTicks(500)
      if (engine.state.phase === 'halftime') engine.startNextPeriod()
    }
    const ai = engine.state.away
    expect(ai.subsUsed).toBeGreaterThan(0)
    expect(ai.subsUsed).toBeLessThanOrEqual(5)
    expect(ai.subWindows).toBeLessThanOrEqual(3)
    // le camp humain n'est jamais touché par le coach automatique
    expect(engine.state.home.subsUsed).toBe(0)
    // et le gardien reste en place
    expect(engine.state.players[ai.lineup[0]].onPitch).toBe(true)
  })

  it('expose des prédicats de phase cohérents', () => {
    expect(isBreak('halftime')).toBe(true)
    expect(isBreak('break_before_extra')).toBe(true)
    expect(isBreak('extra_halftime')).toBe(true)
    expect(isBreak('first_half')).toBe(false)
    expect(isBreak('finished')).toBe(false)

    // la coupure d'avant-prolongation compte comme prolongation : l'IFAB y
    // ouvre déjà la substitution supplémentaire
    expect(isExtraTime('break_before_extra')).toBe(true)
    expect(isExtraTime('extra_first_half')).toBe(true)
    expect(isExtraTime('extra_second_half')).toBe(true)
    expect(isExtraTime('second_half')).toBe(false)
    expect(isExtraTime('halftime')).toBe(false)
  })

  it('pose periodEndTick sur la fin de la période courante', () => {
    const engine = subEngine()
    expect(engine.state.periodEndTick).toBe(HALF_TICKS)
    let guard = 0
    while (engine.state.phase !== 'halftime' && guard++ < 100) engine.runTicks(1000)
    engine.startNextPeriod()
    expect(engine.state.phase).toBe('second_half')
    expect(engine.state.periodEndTick).toBe(
      HALF_TICKS * 2 + Math.round(engine.state.addedTimeSec / TICK_SEC),
    )
  })

  it('les instructions d\'overlap accélèrent la perte d\'endurance', () => {
    const withOverlap = defaultInstructions()
    withOverlap.players = [{ playerId: 'h2', instruction: 'overlap', intensity: 'elevee' }]
    withOverlap.team = { ...withOverlap.team, pressing: 'haut', tempo: 'rapide' }

    const a = new MatchEngine({ home, away, homeInstructions: withOverlap, awayInstructions: defaultInstructions(), seed: 99 })
    const b = new MatchEngine({ home, away, homeInstructions: defaultInstructions(), awayInstructions: defaultInstructions(), seed: 99 })
    a.runTicks(27_000)
    b.runTicks(27_000)
    expect(a.state.players['h2'].stamina).toBeLessThan(b.state.players['h2'].stamina)
  })

  it('respecte la composition titulaire explicite', () => {
    const instr = defaultInstructions()
    instr.team = { ...instr.team, formation: '4-3-3' }
    instr.lineup = ['h14', 'h3', 'h15', 'h4', 'h5', 'h6', 'h7', 'h8', 'h13', 'h12', 'h11']
    expect(validateInstructions(instr, home, away).ok).toBe(true)
    const engine = new MatchEngine({
      home,
      away,
      homeInstructions: instr,
      awayInstructions: defaultInstructions(),
      seed: 11,
    })
    expect(engine.state.home.lineup).toEqual(instr.lineup)
    // le gardien titulaire (h14) démarre bien devant sa ligne de but
    expect(engine.state.players['h14'].x).toBeLessThan(10)
    expect(engine.state.players['h14'].onPitch).toBe(true)
    expect(engine.state.players['h1'].onPitch).toBe(false)
  })

  it('refuse une composition dont le premier poste n\'est pas le gardien', () => {
    const instr = defaultInstructions()
    instr.lineup = ['h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9', 'h10', 'h11', 'h12']
    const res = validateInstructions(instr, home, away)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.errors.join(' ')).toContain('gardien')
  })

  it('change les titulaires en cours de match via les règles de remplacement', () => {
    const engine = new MatchEngine({
      home,
      away,
      homeInstructions: defaultInstructions(),
      awayInstructions: defaultInstructions(),
      seed: 21,
    })
    engine.runTicks(500)
    const instr = structuredClone(engine.state.home.instructions)
    instr.lineup = [...engine.state.home.lineup]
    const outId = engine.state.home.lineup[10]
    instr.lineup[10] = 'h15'
    engine.applyInstructions('home', instr)
    expect(engine.state.home.lineup[10]).toBe('h15')
    expect(engine.state.home.subsUsed).toBe(1)
    expect(engine.state.players['h15'].onPitch).toBe(true)
    expect(engine.state.players[outId].onPitch).toBe(false)
  })

  it('gère une exclusion : équipe à 10, match mené à son terme', () => {
    const engine = new MatchEngine({
      home,
      away,
      homeInstructions: defaultInstructions(),
      awayInstructions: defaultInstructions(),
      seed: 31,
    })
    engine.runTicks(600)
    const victim = engine.state.away.lineup[5]
    ;(engine as unknown as { sendOff: (s: 'away', id: string, r: 'direct') => void }).sendOff(
      'away',
      victim,
      'direct',
    )
    expect(engine.state.players[victim].onPitch).toBe(false)
    expect(engine.state.players[victim].sentOff).toBe(true)
    expect(engine.state.away.stats.redCards).toBe(1)
    // la compo garde 11 postes (le poste exclu reste vacant)
    expect(engine.state.away.lineup).toHaveLength(11)
    // changement de formation refusé silencieusement en infériorité (mapping conservé)
    const instr = structuredClone(engine.state.away.instructions)
    instr.team = { ...instr.team, formation: '3-5-2' }
    engine.applyInstructions('away', instr)
    expect(engine.state.away.lineup).toHaveLength(11)
    // le match va au bout sans crash
    let guard = 0
    while (engine.state.phase !== 'finished' && guard++ < 500) {
      engine.runTicks(500)
      if (engine.state.phase === 'halftime') engine.startNextPeriod()
    }
    expect(engine.state.phase).toBe('finished')
    // l'exclu n'est jamais revenu
    expect(engine.state.players[victim].onPitch).toBe(false)
  })

  it('résout un penalty : événement, stat, issue cohérente', () => {
    const engine = new MatchEngine({
      home,
      away,
      homeInstructions: defaultInstructions(),
      awayInstructions: defaultInstructions(),
      seed: 41,
    })
    engine.runTicks(400)
    const before = engine.state.score.home
    ;(engine as unknown as { awardPenalty: (s: 'home') => void }).awardPenalty('home')
    expect(engine.state.home.stats.penalties).toBe(1)
    expect(engine.state.events.some((e) => e.type === 'penalty')).toBe(true)
    // laisse la frappe arriver
    engine.runTicks(60)
    const resolved = engine.state.events.some(
      (e) => e.type === 'goal' || e.type === 'save' || e.type === 'off_target',
    )
    expect(resolved).toBe(true)
    // but sur penalty bien compté
    const goalEv = engine.state.events.find((e) => e.type === 'goal' && e.message.includes('penalty'))
    if (goalEv) expect(engine.state.score.home).toBe(before + 1)
  })

  // Régression : le barème des notes payait la routine. Mesuré site par site,
  // un joueur dérivait de +2,15 par match depuis 6,0 — dont 93 % venus des
  // passes réussies, des récupérations et des passes coupées. La médiane
  // finissait à 7,98 et 9 % des joueurs tapaient 10,0 à CHAQUE match : dans le
  // haut de l'échelle la note ne distinguait plus rien.
  it('produit des notes qui ne saturent pas le plafond (6 matchs)', () => {
    const ratings = ratingsOver([11, 23, 37, 41, 59, 67]).map((r) => r.rating)
    const sorted = [...ratings].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    const capped = ratings.filter((r) => r >= 9.99).length / ratings.length

    // un plafond atteint reste possible (triplé), il ne doit pas être courant
    expect(capped).toBeLessThan(0.02)
    // et la note d'un titulaire ordinaire doit rester proche de la base
    expect(median).toBeGreaterThan(6)
    expect(median).toBeLessThan(7.2)
  })

  // Régression : le tir dans le jeu était noté à l'envers — rater rapportait
  // +0,1, marquer rapportait 0 — et le penalty marqué valait +1,8 contre +1,0
  // pour un but construit. La note doit suivre ce qui décide le match.
  it('note mieux les joueurs décisifs (6 matchs)', () => {
    const all = ratingsOver([11, 23, 37, 41, 59, 67])
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1)
    const scorers = all.filter((r) => r.goals >= 1).map((r) => r.rating)
    const quiet = all.filter((r) => r.goals === 0 && r.assists === 0).map((r) => r.rating)
    const sentOff = all.filter((r) => r.sentOff).map((r) => r.rating)

    expect(scorers.length).toBeGreaterThan(0)
    expect(mean(scorers)).toBeGreaterThan(mean(quiet) + 0.5)
    // une exclusion doit coûter, pas seulement priver de temps de jeu
    if (sentOff.length) expect(mean(sentOff)).toBeLessThan(6)
  })

  // Témoin de l'inversion : le tir dans le jeu rapportait +0,1 quand il ratait
  // et 0 quand il rentrait. Un joueur qui multipliait les tentatives sans rien
  // marquer montait donc dans le classement — sur ces six seeds, +0,73 de plus
  // que ceux qui n'ont pas tiré du tout.
  it('ne récompense pas les tirs stériles (6 matchs)', () => {
    const barren = ratingsOver([11, 23, 37, 41, 59, 67]).filter(
      (r) => r.goals === 0 && r.assists === 0,
    )
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1)
    const shooters = barren.filter((r) => r.shots >= 3).map((r) => r.rating)
    const abstainers = barren.filter((r) => r.shots === 0).map((r) => r.rating)

    expect(shooters.length).toBeGreaterThan(0)
    expect(mean(shooters)).toBeLessThan(mean(abstainers))
  })

  // Régression : les durées d'arrêt de jeu étaient environ deux fois trop
  // courtes (touche 10 s, six mètres 16 s, corner 14 s), et le moteur jouait
  // 74 minutes effectives contre ~55 dans un vrai match. Toutes les mesures
  // « par match » en héritaient — le taux de tir par minute de jeu effectif,
  // lui, était déjà juste (0,476 contre 0,473).
  it('laisse le ballon mort près d’un tiers du match (6 matchs)', () => {
    const seeds = [11, 23, 37, 41, 59, 67]
    let dead = 0
    let total = 0
    for (const seed of seeds) {
      const engine = runFullMatch(seed)
      dead += engine.state.deadTicks
      total += engine.state.tick
    }
    const ratio = dead / total
    expect(ratio).toBeGreaterThan(0.25)
    expect(ratio).toBeLessThan(0.38)
  })

  // Régression : `movePlayers` tournait pendant le gel des remises en jeu.
  // Les joueurs sprintaient ballon mort — la forme d'équipe se dissolvait
  // avant que le corner soit tiré, et l'arrêt comptait quand même dans les
  // kilomètres. 18,1 km par joueur de champ avant, 14,0 après.
  it('ne fait pas courir les joueurs ballon mort (6 matchs)', () => {
    const seeds = [11, 23, 37, 41, 59, 67]
    let metres = 0
    let count = 0
    for (const seed of seeds) {
      const engine = runFullMatch(seed)
      for (const tms of [engine.state.home, engine.state.away]) {
        for (const id of tms.lineup) {
          const player = tms.team.players.find((p) => p.id === id)!
          if (player.role === 'GK') continue
          metres += engine.state.players[id].stats.distance
          count++
        }
      }
    }
    const km = metres / count / 1000
    // Bornes du Pilier A, désormais tenues (11,6 km sur ces six seeds). La
    // borne haute était provisoirement à 16,5 tant que le chantier
    // « possessions réalistes » restait ouvert ; il l'est moins.
    expect(km).toBeLessThan(12.5)
    expect(km).toBeGreaterThan(9)
  })

  // Régression : `PlayerStats.saves` était déclaré, initialisé à 0, et
  // incrémenté nulle part dans le moteur. Les gardiens finissaient tous les
  // matchs à 0 arrêt alors que l'évènement `save` se déclenchait sept fois par
  // match, et leur note restait collée à la base — 6,16 de moyenne, quel que
  // soit le match joué.
  it('compte les arrêts du gardien et les porte à sa note (6 matchs)', () => {
    const seeds = [11, 23, 37, 41, 59, 67]
    let saves = 0
    let saveEvents = 0
    const clean: number[] = []
    const leaky: number[] = []
    for (const seed of seeds) {
      const engine = runFullMatch(seed)
      saveEvents += engine.state.events.filter((e) => e.type === 'save').length
      for (const [tms, otherSide] of [
        [engine.state.home, 'away'],
        [engine.state.away, 'home'],
      ] as const) {
        const keeperId = tms.lineup.find(
          (id) => tms.team.players.find((p) => p.id === id)!.role === 'GK',
        )!
        const keeper = engine.state.players[keeperId]
        saves += keeper.stats.saves
        const conceded = engine.state.score[otherSide]
        if (conceded === 0) clean.push(keeper.stats.rating)
        if (conceded >= 3) leaky.push(keeper.stats.rating)
      }
    }
    // la statistique existe et suit les évènements du match
    expect(saves).toBeGreaterThan(0)
    expect(saves).toBe(saveEvents)
    // et la note du gardien répond à ce qu'il a fait
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1)
    if (clean.length && leaky.length) expect(mean(clean)).toBeGreaterThan(mean(leaky))
  })

  // Régression : le moteur ne contrait que 4 % des tirs, contre ~28 % dans un
  // vrai match. `blocked` existait dans le type et n'était produit qu'en
  // deuxième rideau derrière le gardien : tout ce qu'un attaquant tentait
  // arrivait au but ou sortait, et se jeter dans une trajectoire ne servait à
  // rien. Le hors-cadre en héritait — 57 % des tirs contre ~37 % en vrai.
  it('fait contrer une part réaliste des tirs (12 matchs)', () => {
    // douze seeds : sur six, l'erreur d'échantillonnage du taux dépasse la
    // marge à la borne
    const seeds = [11, 23, 37, 41, 59, 67, 71, 73, 79, 83, 89, 97]
    let shots = 0
    let blocks = 0
    for (const seed of seeds) {
      const engine = runFullMatch(seed)
      shots += engine.state.home.stats.shots + engine.state.away.stats.shots
      blocks += engine.state.events.filter((e) => e.type === 'block').length
    }
    const share = blocks / shots
    // ~12 % mesuré, contre ~28 % dans un vrai match. Élargir la portée du
    // contreur y amène (21 % à 3,4 m), mais au prix des équipes faibles : leurs
    // tirs partent de plus loin, et le L3 synthétique retombe de 2,17 à 1,83
    // but par match. Le contre reste donc sous-calibré tant qu'il ne dépend pas
    // aussi de la qualité de la position de frappe.
    expect(share).toBeGreaterThan(0.06)
    // borne haute : un mur permanent devant chaque frappe étoufferait le jeu
    expect(share).toBeLessThan(0.35)
  })

  // Un contre laissait toujours le ballon au contreur : il était par
  // construction le plus proche du point d'impact. Le ballon est dévié, et
  // l'attaque en récupère une part.
  it('rend une partie des ballons contrés à l’attaque (6 matchs)', () => {
    const seeds = [11, 23, 37, 41, 59, 67]
    let blocks = 0
    let attackKeeps = 0
    for (const seed of seeds) {
      const engine = runFullMatch(seed)
      const events = engine.state.events
      for (let i = 0; i < events.length; i++) {
        if (events[i].type !== 'block') continue
        blocks++
        // le contreur est du camp qui défend : si le tir suivant vient de
        // l'autre camp dans la foulée, l'attaque a gardé le ballon
        const next = events.slice(i + 1, i + 4).find((e) => e.type === 'shot' || e.type === 'goal')
        if (next && next.side !== events[i].side) attackKeeps++
      }
    }
    expect(blocks).toBeGreaterThan(0)
    expect(attackKeeps).toBeGreaterThan(0)
  })

  // Régression : l'effort ne dépendait que du comportement choisi, jamais de
  // la distance restant à couvrir — un joueur s'élançait à fond pour trois
  // mètres. 14,3 km par joueur de champ et 10,6 % du temps de course passé
  // au-dessus de 7 m/s, contre ~10,5 km et ~3 % en vrai.
  //
  // Attention au piège : baisser les paliers d'effort au lieu d'ajouter la
  // rampe fait tomber le ratio de sprint à 0,00 % d'un coup. La vitesse
  // maximale plafonne à 8,2 m/s, donc un effort de 0,85 la ramène sous le
  // seuil de 7 m/s et PLUS PERSONNE ne sprinte jamais. Une borne basse est
  // donc aussi nécessaire que la haute.
  it('sprinte par bouffées, pas en continu ni jamais (6 matchs)', () => {
    const seeds = [11, 23, 37, 41, 59, 67]
    let running = 0
    let sprinting = 0
    for (const seed of seeds) {
      const engine = runFullMatch(seed)
      for (const tms of [engine.state.home, engine.state.away]) {
        for (const id of tms.lineup) {
          if (tms.team.players.find((p) => p.id === id)!.role === 'GK') continue
          running += engine.state.players[id].stats.runningTicks
          sprinting += engine.state.players[id].stats.sprintTicks
        }
      }
    }
    const ratio = sprinting / running
    expect(ratio).toBeGreaterThan(0.01)
    expect(ratio).toBeLessThan(0.1)
  })

  // Le gardien parcourait 9,5 km par match — presque autant qu'un défenseur —
  // parce que sa zone morte était de 50 cm : il suivait le ballon au mètre au
  // lieu de se replacer par paliers. Un vrai gardien couvre ~5,5 km.
  it('ne fait pas courir le gardien comme un milieu (6 matchs)', () => {
    const seeds = [11, 23, 37, 41, 59, 67]
    let metres = 0
    let count = 0
    for (const seed of seeds) {
      const engine = runFullMatch(seed)
      for (const tms of [engine.state.home, engine.state.away]) {
        const keeperId = tms.lineup.find(
          (id) => tms.team.players.find((p) => p.id === id)!.role === 'GK',
        )!
        metres += engine.state.players[keeperId].stats.distance
        count++
      }
    }
    expect(metres / count / 1000).toBeLessThan(8)
  })

  // La fatigue doit rester lisible : le Pilier A vise 65-75 % de fraîcheur en
  // fin de match sur instructions neutres. Diviser la course par 1,3 sans
  // retoucher le drain la faisait finir à 80 % — plus personne ne fatiguait,
  // et remplacer ne servait plus à rien.
  it('laisse les joueurs fatigués en fin de match (6 matchs)', () => {
    const seeds = [11, 23, 37, 41, 59, 67]
    let stamina = 0
    let count = 0
    for (const seed of seeds) {
      const engine = runFullMatch(seed)
      for (const tms of [engine.state.home, engine.state.away]) {
        for (const id of tms.lineup) {
          if (tms.team.players.find((p) => p.id === id)!.role === 'GK') continue
          stamina += engine.state.players[id].stamina
          count++
        }
      }
    }
    const mean = stamina / count
    expect(mean).toBeGreaterThan(62)
    expect(mean).toBeLessThan(78)
  })

  // Régression : une faute ne pouvait être sifflée QUE sur un tacle réussi.
  // Un tacle manqué renvoyait immédiatement et l'attaquant passait sans
  // conséquence — alors que le tacle mal ajusté est la première source de
  // fautes sur un terrain. L'arbitre sifflait 7,5 fautes par match contre ~22,
  // et 1,3 carton contre ~4.
  it('siffle un nombre réaliste de fautes et de cartons (6 matchs)', () => {
    const seeds = [11, 23, 37, 41, 59, 67]
    let fouls = 0
    let yellows = 0
    let reds = 0
    for (const seed of seeds) {
      const engine = runFullMatch(seed)
      for (const tms of [engine.state.home, engine.state.away]) {
        fouls += tms.stats.fouls
        yellows += tms.stats.yellowCards
        reds += tms.stats.redCards
      }
    }
    const n = seeds.length
    expect(fouls / n).toBeGreaterThan(14)
    expect(fouls / n).toBeLessThan(28)
    expect(yellows / n).toBeGreaterThan(1.5)
    expect(yellows / n).toBeLessThan(6)
    // une exclusion doit rester un évènement rare
    expect(reds / n).toBeLessThan(1)
  })

  // Régression : le moteur n'était calibré que pour des joueurs très au-dessus
  // de la moyenne, et le bench ne pouvait pas le voir puisqu'il mesure sur les
  // deux équipes fictives — lesquelles tournent à 68 de technique quand la
  // Ligue 3 réelle est à 51. Sur de vrais clubs le moteur tombait à 1,5 but par
  // match, avec un match sur cinq qui finissait 0-0.
  //
  // Dans la vraie vie toutes les divisions marquent autour de 2,5 buts : le
  // niveau des défenseurs suit celui des attaquants. Le rendement doit donc
  // dépendre de l'ÉCART entre les deux, pas du niveau absolu.
  it('produit du football sur un effectif de Ligue 3, pas seulement sur une élite', () => {
    // vingt seeds : un match compte deux ou trois buts, l'écart-type sur six
    // matchs dépasse l'effet mesuré (le sous-échantillon [11..67] donne 1,17
    // là où la moyenne est à 2,0)
    const seeds = [
      11, 23, 37, 41, 59, 67, 71, 73, 79, 83, 89, 97, 101, 103, 107, 109, 113, 127, 131, 137,
    ]
    const home = ligue3Squad('l3h', 'Est')
    const away = ligue3Squad('l3a', 'Ouest')
    let goals = 0
    let nilNil = 0
    for (const seed of seeds) {
      const engine = new MatchEngine({
        home,
        away,
        homeInstructions: defaultInstructions(),
        awayInstructions: defaultInstructions(),
        seed,
      })
      let guard = 0
      while (engine.state.phase !== 'finished' && guard++ < 500) {
        engine.runTicks(500)
        if (engine.state.phase === 'halftime') engine.startNextPeriod()
      }
      const total = engine.state.score.home + engine.state.score.away
      goals += total
      if (total === 0) nilNil++
    }
    const perMatch = goals / seeds.length
    expect(perMatch).toBeGreaterThan(1.6)
    expect(perMatch).toBeLessThan(3.6)
    // Les 0-0 existent, ils ne sont pas la norme. Borne large : à 2 buts par
    // match, Poisson en attend déjà 13 % avec un écart-type de ±1,5 sur vingt
    // matchs — c'est la moyenne de buts ci-dessus qui porte le test, pas ce
    // compteur, qui ne sert qu'à repérer un moteur qui ne marque plus du tout.
    expect(nilNil).toBeLessThan(seeds.length / 3)
  })

  // Le commentaire de `DUEL_OUT_*` donne 9-11 corners et 35-45 touches pour
  // cible. Les corners étaient à 12,6 : la ligne de but happait les duels
  // jusqu'à 10 m, là où la géométrie du terrain (105 m contre 68) en envoie
  // déjà beaucoup de ce côté. Les bornes ici sont larges à dessein — elles
  // gardent l'ordre de grandeur, pas le réglage fin, qui se mesure au bench.
  it('répartit les sorties de balle entre corner et touche (12 matchs)', () => {
    const seeds = [11, 23, 37, 41, 59, 67, 71, 73, 79, 83, 89, 97]
    let corners = 0
    let throwIns = 0
    for (const seed of seeds) {
      const engine = runFullMatch(seed)
      corners += engine.state.home.stats.corners + engine.state.away.stats.corners
      throwIns += engine.state.events.filter((e) => e.type === 'throw_in').length
    }
    const n = seeds.length
    expect(corners / n).toBeGreaterThan(6)
    expect(corners / n).toBeLessThan(13)
    // la touche reste la sortie la plus fréquente, de loin
    expect(throwIns / n).toBeGreaterThan(corners / n)
  })

  it('produit un taux de tirs cadrés plausible (moyenne sur 3 matchs)', () => {
    let sot = 0
    let shots = 0
    for (const seed of [71, 77, 83]) {
      const engine = runFullMatch(seed)
      sot += engine.state.home.stats.shotsOnTarget + engine.state.away.stats.shotsOnTarget
      shots += engine.state.home.stats.shots + engine.state.away.stats.shots
    }
    const ratio = sot / Math.max(shots, 1)
    expect(ratio).toBeGreaterThan(0.2)
    expect(ratio).toBeLessThan(0.6)
  })

  // Régression : le hors-jeu était géométriquement inatteignable. L'appel en
  // profondeur visait `ligne × facteur` avec un facteur < 1, donc toujours EN
  // DEÇÀ de la ligne, quand l'arbitre siffle au-delà de ligne + 0,03. Sur
  // 72 équipes-matchs, l'écart maximal atteint était de 0,0081 : zéro hors-jeu
  // sifflé, alors que la règle est implémentée et testée par ailleurs.
  it('siffle des hors-jeu à un taux plausible (6 matchs)', () => {
    // 3 matchs sur 12 n'ont aucun hors-jeu : la mesure n'a de sens qu'agrégée.
    const seeds = [11, 23, 37, 41, 59, 67]
    let offsides = 0
    for (const seed of seeds) {
      const engine = runFullMatch(seed)
      offsides += engine.state.home.stats.offsides + engine.state.away.stats.offsides
    }
    const perTeamPerMatch = offsides / seeds.length / 2

    // Bornes calées sur le réel (~2 hors-jeu par équipe et par match) plutôt
    // que sur ce que le moteur produisait. L'ancienne fenêtre 0,15-1,6 était
    // écrite quand la tolérance d'arbitrage valait 3,15 m et laissait passer
    // 0,25 hors-jeu par équipe : elle certifiait que la règle n'était pas
    // morte, pas qu'elle était juste.
    expect(perTeamPerMatch).toBeGreaterThan(1)
    // borne haute : un piège du hors-jeu permanent casserait le jeu
    expect(perTeamPerMatch).toBeLessThan(3.2)
  })

  it("un appel mal minuté franchit la ligne, un appel bien minuté reste en deçà", () => {
    // Le cœur du bug, isolé de la simulation : c'est le SENS du dépassement.
    const line = 0.75
    const inp = {
      ...({} as AttackSliceInput),
      attrs: home.players[10].attributes,
      role: 'AT' as const,
      ti: defaultInstructions().team,
      playerTx: 0.7,
      playerTy: 0.5,
      ballTx: 0.6,
      ballTy: 0.5,
      offsideLineTx: line,
      phaseBlend: 1,
      minute: 30,
      goalDiff: 0,
      stamina: 100,
    }
    const OFFSIDE_MARGIN = 0.03 // seuil de checkOffside dans sim.ts

    const mistimed = attackTarget('run_in_behind', { ...inp, runGamble: true }, 0.7, 0.5)
    expect(mistimed.tx).toBeGreaterThan(line + OFFSIDE_MARGIN)

    const timed = attackTarget('run_in_behind', { ...inp, runGamble: false }, 0.7, 0.5)
    expect(timed.tx).toBeLessThan(line)
  })
})

describe('prolongation', () => {
  /** Joue jusqu'à la fin en franchissant chaque pause. */
  function playOut(engine: MatchEngine) {
    let guard = 0
    while (engine.state.phase !== 'finished' && guard++ < 2000) {
      engine.runTicks(500)
      if (isBreak(engine.state.phase)) engine.startNextPeriod()
    }
    return engine
  }

  /**
   * Cherche, sur 12 seeds au plus, un nul et une victoire à 90' (sans
   * prolongation). Mémoïsé : les deux tests qui en ont besoin partagent la
   * recherche au lieu de rejouer chacun jusqu'à 60 matchs complets — un nul
   * arrive environ une fois sur quatre, 12 seeds suffisent très largement.
   */
  let seeds: { drawSeed: number; winSeed: number } | null = null
  function findSeeds() {
    if (seeds) return seeds
    let drawSeed = -1
    let winSeed = -1
    for (let s = 1; s <= 12 && (drawSeed < 0 || winSeed < 0); s++) {
      const probe = playOut(
        new MatchEngine({
          home,
          away,
          homeInstructions: defaultInstructions(),
          awayInstructions: defaultInstructions(),
          seed: s,
        }),
      )
      if (probe.state.score.home === probe.state.score.away) {
        if (drawSeed < 0) drawSeed = s
      } else if (winSeed < 0) {
        winSeed = s
      }
    }
    if (drawSeed < 0) throw new Error("aucun nul à 90' trouvé parmi les 12 premiers seeds")
    if (winSeed < 0) throw new Error("aucune victoire à 90' trouvée parmi les 12 premiers seeds")
    seeds = { drawSeed, winSeed }
    return seeds
  }

  it('ne joue pas de prolongation en match de championnat', () => {
    const engine = playOut(
      new MatchEngine({
        home,
        away,
        homeInstructions: defaultInstructions(),
        awayInstructions: defaultInstructions(),
        seed: 5,
      }),
    )
    expect(engine.state.phase).toBe('finished')
    expect(engine.state.tick).toBeLessThan(HALF_TICKS * 2 + 2000)
  })

  it('joue la prolongation en élimination directe si le score est nul à 90', () => {
    const { drawSeed } = findSeeds()
    const engine = playOut(
      new MatchEngine({
        home,
        away,
        homeInstructions: defaultInstructions(),
        awayInstructions: defaultInstructions(),
        seed: drawSeed,
        knockout: true,
      }),
    )
    expect(engine.state.phase).toBe('finished')
    // 120 minutes jouées : la prolongation a bien eu lieu
    expect(engine.state.tick).toBeGreaterThan(HALF_TICKS * 2 + EXTRA_HALF_TICKS * 2 - 10)
    const types = engine.state.events.map((e) => e.type)
    expect(types.filter((t) => t === 'halftime').length).toBeGreaterThanOrEqual(3)
  })

  it('ne joue pas de prolongation en élimination directe si un camp mène à 90', () => {
    const { winSeed } = findSeeds()
    const engine = playOut(
      new MatchEngine({
        home,
        away,
        homeInstructions: defaultInstructions(),
        awayInstructions: defaultInstructions(),
        seed: winSeed,
        knockout: true,
      }),
    )
    expect(engine.state.phase).toBe('finished')
    expect(engine.state.tick).toBeLessThan(HALF_TICKS * 2 + 2000)
  })
})

describe('sorties de balle', () => {
  // Régression : aucun duel ne mettait le ballon dehors. 142 interceptions et
  // 25 tacles par match transféraient tous la possession sur place, et les
  // seules sorties venaient des passes ratées — d'où 12,8 touches par match
  // contre 35-45 réelles, et 0,9 % de temps mort contre ~30 %.
  // Bandes volontairement larges : elles verrouillent la structure (le ballon
  // sort, le jeu s'arrête) sans casser au moindre réglage de calibration.
  const seeds = [101, 202, 303, 404]
  const counts = { throw_in: 0, corner: 0, goal_kick: 0 }
  let deadTicks = 0
  let totalTicks = 0
  for (const seed of seeds) {
    const engine = runFullMatch(seed)
    for (const e of engine.state.events) {
      if (e.type in counts) counts[e.type as keyof typeof counts]++
    }
    deadTicks += engine.state.deadTicks
    totalTicks += engine.state.tick
  }

  it('produit des touches à une fréquence plausible', () => {
    const perMatch = counts.throw_in / seeds.length
    expect(perMatch).toBeGreaterThan(15)
    expect(perMatch).toBeLessThan(60)
  })

  it('produit des corners et des six mètres', () => {
    expect(counts.corner / seeds.length).toBeGreaterThan(3)
    expect(counts.corner / seeds.length).toBeLessThan(20)
    expect(counts.goal_kick / seeds.length).toBeGreaterThan(3)
  })

  it('arrête réellement le jeu sur chaque remise en jeu', () => {
    // les durées d'arrêt étaient écrites en ticks au lieu de secondes : une
    // touche reprenait en 1 s, et le temps mort tombait sous 1 % du match
    const share = deadTicks / totalTicks
    expect(share).toBeGreaterThan(0.05)
    expect(share).toBeLessThan(0.45)
  })
})

describe('instrumentation des critères du Pilier A', () => {
  // Un compteur débranché lit 0 sans rien signaler, et `sim --check` affiche
  // alors « 0.0% » comme s'il avait mesuré. Ces invariants attrapent le
  // débranchement, ce qu'une borne de calibration ne peut pas faire.
  const engine = runFullMatch(4242)
  const st = engine.state

  it('compte du temps de course et du sprint, le sprint étant un sous-ensemble', () => {
    const outfield = st.home.lineup
      .map((id) => st.players[id])
      .filter((lp) => home.players.find((p) => p.id === lp.id)!.role !== 'GK')

    const running = outfield.reduce((n, lp) => n + lp.stats.runningTicks, 0)
    const sprint = outfield.reduce((n, lp) => n + lp.stats.sprintTicks, 0)

    expect(running).toBeGreaterThan(0)
    expect(sprint).toBeGreaterThan(0)
    expect(sprint).toBeLessThanOrEqual(running)
  })

  it('compte du temps mort, borné par la durée du match', () => {
    expect(st.deadTicks).toBeGreaterThan(0)
    expect(st.deadTicks).toBeLessThan(st.tick)
  })

  it("n'impute jamais plus de buts sur phase arrêtée que de buts marqués", () => {
    expect(st.home.stats.setPieceGoals).toBeLessThanOrEqual(st.score.home)
    expect(st.away.stats.setPieceGoals).toBeLessThanOrEqual(st.score.away)
  })
})

describe('validateInstructions', () => {
  it('rejette un joueur inconnu', () => {
    const instr = defaultInstructions()
    instr.players = [{ playerId: 'inconnu', instruction: 'overlap' }]
    const res = validateInstructions(instr, home, away)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.errors[0]).toContain('inconnu')
  })

  it('rejette un doublon d\'instruction pour un même joueur', () => {
    const instr = defaultInstructions()
    instr.players = [
      { playerId: 'h2', instruction: 'overlap' },
      { playerId: 'h2', instruction: 'stay_back' },
    ]
    expect(validateInstructions(instr, home, away).ok).toBe(false)
  })

  it('rejette un marquage individuel sans cible adverse', () => {
    const instr = defaultInstructions()
    instr.players = [{ playerId: 'h3', instruction: 'man_mark', targetPlayerId: 'h5' }]
    expect(validateInstructions(instr, home, away).ok).toBe(false)
  })

  it('accepte des instructions valides', () => {
    const instr = defaultInstructions()
    instr.team = { ...instr.team, formation: '4-3-3', pressing: 'haut' }
    instr.players = [
      { playerId: 'h2', instruction: 'overlap', intensity: 'elevee' },
      { playerId: 'h3', instruction: 'man_mark', targetPlayerId: 'a11' },
    ]
    expect(validateInstructions(instr, home, away).ok).toBe(true)
  })
})
