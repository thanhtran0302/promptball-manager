import { describe, expect, it } from 'vitest'
import { MatchEngine } from './sim'
import { defaultInstructions, validateInstructions } from './instructions'
import { attackTarget, type AttackSliceInput } from './slices'
import { TEAMS } from '../data/teams'

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
    if (engine.state.phase === 'halftime') engine.startSecondHalf()
  }
  return engine
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

  it('gère les remplacements : 3 max, banc/terrain vérifiés', () => {
    const engine = new MatchEngine({
      home,
      away,
      homeInstructions: defaultInstructions(),
      awayInstructions: defaultInstructions(),
      seed: 5,
    })
    const lineup = engine.state.home.lineup
    const bench = home.players
      .filter((p) => !lineup.includes(p.id) && p.role !== 'GK')
      .map((p) => p.id)
    expect(engine.makeSub('home', lineup[3], bench[0]).ok).toBe(true)
    expect(engine.makeSub('home', lineup[4], bench[1]).ok).toBe(true)
    expect(engine.makeSub('home', lineup[5], bench[2]).ok).toBe(true)
    // 4e refusé
    const r = engine.makeSub('home', lineup[6], bench[3] ?? bench[0])
    expect(r.ok).toBe(false)
    // entrant déjà sur le terrain refusé
    expect(engine.makeSub('away', engine.state.away.lineup[0], engine.state.away.lineup[1]).ok).toBe(false)
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
      if (engine.state.phase === 'halftime') engine.startSecondHalf()
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

    // borne basse : la règle doit produire des décisions, pas rester décorative
    expect(perTeamPerMatch).toBeGreaterThan(0.15)
    // borne haute : un piège du hors-jeu permanent casserait le jeu
    expect(perTeamPerMatch).toBeLessThan(1.6)
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
