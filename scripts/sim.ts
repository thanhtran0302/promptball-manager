// Calibration et bench du moteur : simule N matchs et imprime les stats
// moyennes. Mode sweep (npm run sim -- 20 --sweep) : un réglage tactique à
// la fois contre un adversaire neutre — chaque dial doit bouger sa colonne.
// Usage : npm run sim [matchs] [--sweep]

import { MatchEngine } from '../src/engine/sim'
import { defaultInstructions } from '../src/engine/instructions'
import type { MatchInstructions } from '../src/engine/types'
import { TEAMS } from '../src/data/teams'

const args = process.argv.slice(2)
const N = Number(args.find((a) => !a.startsWith('--')) ?? 20)
const SWEEP = args.includes('--sweep')

const [home, away] = TEAMS
const neutral = defaultInstructions()

interface Agg {
  goals: [number, number]
  shots: [number, number]
  sot: [number, number]
  poss: number
  corners: [number, number]
  offsides: [number, number]
  fouls: [number, number]
  yellows: [number, number]
  reds: number
  pens: number
  goalsOver8: number
}

function run(matches: number, homeInstr: MatchInstructions, awayInstr: MatchInstructions): Agg {
  const agg: Agg = {
    goals: [0, 0], shots: [0, 0], sot: [0, 0], poss: 0, corners: [0, 0],
    offsides: [0, 0], fouls: [0, 0], yellows: [0, 0], reds: 0, pens: 0, goalsOver8: 0,
  }
  for (let i = 0; i < matches; i++) {
    const engine = new MatchEngine({
      home,
      away,
      homeInstructions: structuredClone(homeInstr),
      awayInstructions: structuredClone(awayInstr),
      seed: 1000 + i * 7919,
    })
    let guard = 0
    while (engine.state.phase !== 'finished' && guard++ < 200) {
      engine.runTicks(500)
      if (engine.state.phase === 'halftime') engine.startSecondHalf()
    }
    const st = engine.state
    agg.goals[0] += st.score.home
    agg.goals[1] += st.score.away
    agg.shots[0] += st.home.stats.shots
    agg.shots[1] += st.away.stats.shots
    agg.sot[0] += st.home.stats.shotsOnTarget
    agg.sot[1] += st.away.stats.shotsOnTarget
    const totalPoss = st.home.stats.possessionTicks + st.away.stats.possessionTicks || 1
    agg.poss += (st.home.stats.possessionTicks / totalPoss) * 100
    agg.corners[0] += st.home.stats.corners
    agg.corners[1] += st.away.stats.corners
    agg.offsides[0] += st.home.stats.offsides
    agg.offsides[1] += st.away.stats.offsides
    agg.fouls[0] += st.home.stats.fouls
    agg.fouls[1] += st.away.stats.fouls
    agg.yellows[0] += st.home.stats.yellowCards
    agg.yellows[1] += st.away.stats.yellowCards
    agg.reds += st.home.stats.redCards + st.away.stats.redCards
    agg.pens += st.home.stats.penalties + st.away.stats.penalties
    if (st.score.home + st.score.away > 8) agg.goalsOver8++
  }
  return agg
}

function row(name: string, agg: Agg, n: number) {
  const f = (v: number, d = 2) => (v / n).toFixed(d)
  console.log(
    name.padEnd(26) +
      `| buts ${f(agg.goals[0])}-${f(agg.goals[1])}` +
      ` | tirs ${f(agg.shots[0], 1)}-${f(agg.shots[1], 1)} (cad ${f(agg.sot[0], 1)}-${f(agg.sot[1], 1)})` +
      ` | poss ${f(agg.poss, 1)}%` +
      ` | HJ ${f(agg.offsides[0], 1)}-${f(agg.offsides[1], 1)}` +
      ` | CF [🟨] ${f(agg.fouls[0], 1)} [${f(agg.yellows[0], 1)}] - ${f(agg.fouls[1], 1)} [${f(agg.yellows[1], 1)}]` +
      ` | 🟥 ${f(agg.reds, 2)} | pens ${f(agg.pens, 2)}` +
      (agg.goalsOver8 ? ` | >8b ${agg.goalsOver8}/${n}` : ''),
  )
}

if (SWEEP) {
  console.log(`\n=== PHASE-SWEEP (${N} matchs, un dial à la fois vs neutre) ===`)
  const dials: { name: string; mut: (mi: MatchInstructions) => void }[] = [
    { name: 'neutre (baseline)', mut: () => {} },
    { name: 'pressing haut', mut: (mi) => (mi.team.pressing = 'haut') },
    { name: 'pressing bas', mut: (mi) => (mi.team.pressing = 'bas') },
    { name: 'mentalité offensive', mut: (mi) => (mi.team.mentality = 'offensif') },
    { name: 'mentalité très défensive', mut: (mi) => (mi.team.mentality = 'tres_defensif') },
    { name: 'tempo rapide', mut: (mi) => (mi.team.tempo = 'rapide') },
    { name: 'tempo lent', mut: (mi) => (mi.team.tempo = 'lent') },
    { name: 'largeur large', mut: (mi) => (mi.team.width = 'large') },
    { name: 'ligne haute', mut: (mi) => (mi.team.defensiveLine = 'haute') },
    { name: 'ligne basse', mut: (mi) => (mi.team.defensiveLine = 'basse') },
    { name: 'overlap Lambert élevé', mut: (mi) => mi.players.push({ playerId: 'h2', instruction: 'overlap', intensity: 'elevee' }) },
  ]
  for (const dial of dials) {
    const instr = structuredClone(neutral)
    dial.mut(instr)
    row(dial.name, run(N, instr, neutral), N)
  }
} else {
  console.log(`\n=== Calibration (${N} matchs) ===`)
  const variants: { name: string; mut: (mi: MatchInstructions) => void }[] = [
    { name: 'neutre vs neutre', mut: () => {} },
    {
      name: 'LUM pressing haut + tempo rapide',
      mut: (mi) => {
        mi.team = { ...mi.team, pressing: 'haut', tempo: 'rapide', mentality: 'offensif' }
        mi.players = [{ playerId: 'h2', instruction: 'overlap', intensity: 'elevee' }]
      },
    },
    {
      name: 'SPA bloc bas + contre',
      mut: (mi) => {
        mi.team = { ...mi.team, pressing: 'bas', mentality: 'tres_defensif', defensiveLine: 'basse', tempo: 'rapide' }
      },
    },
  ]
  for (const v of variants) {
    const instr = structuredClone(neutral)
    v.mut(instr)
    row(v.name, run(N, instr, neutral), N)
  }
}
