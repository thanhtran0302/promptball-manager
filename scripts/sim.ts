// Script de calibration : simule N matchs complets et imprime les stats
// moyennes pour vérifier le réalisme (buts, tirs, possession, endurance).
// Usage : npm run sim [nombre de matchs]

import { MatchEngine } from '../src/engine/sim'
import { defaultInstructions } from '../src/engine/instructions'
import type { MatchInstructions } from '../src/engine/types'
import { TEAMS } from '../src/data/teams'

const N = Number(process.argv[2] ?? 20)

function variant(base: MatchInstructions, name: string, mut: (mi: MatchInstructions) => void) {
  const copy = structuredClone(base)
  mut(copy)
  return { name, instr: copy }
}

const neutral = defaultInstructions()

const variants = [
  variant(neutral, 'neutre vs neutre', () => {}),
  variant(neutral, 'LUM pressing haut + tempo rapide', (mi) => {
    mi.team = { ...mi.team, pressing: 'haut', tempo: 'rapide', mentality: 'offensif' }
    mi.players = [{ playerId: 'h2', instruction: 'overlap', intensity: 'elevee' }]
  }),
  variant(neutral, 'SPA bloc bas + contre', (mi) => {
    mi.team = { ...mi.team, pressing: 'bas', mentality: 'tres_defensif', defensiveLine: 'basse', tempo: 'rapide' }
  }),
]

const [home, away] = TEAMS

for (const v of variants) {
  const agg = {
    homeGoals: 0, awayGoals: 0, homeShots: 0, awayShots: 0,
    homeSOT: 0, awaySOT: 0, homePoss: 0, homeCorners: 0, awayCorners: 0,
    homeFouls: 0, awayFouls: 0, homeYellows: 0, awayYellows: 0, homeOffsides: 0, awayOffsides: 0,
    h2Stamina: 0, minStamina: 100, avgStaminaHome: 0, avgStaminaAway: 0,
    passesHome: 0, passesAway: 0, passAccHome: 0, passAccAway: 0,
    goalsOver8: 0, eventsCount: 0,
  }

  for (let i = 0; i < N; i++) {
    const engine = new MatchEngine({
      home,
      away,
      homeInstructions: structuredClone(v.instr),
      awayInstructions: structuredClone(neutral),
      seed: 1000 + i * 7919,
    })
    // mi-temps : relance la 2e période
    let guard = 0
    while (engine.state.phase !== 'finished' && guard++ < 200) {
      engine.runTicks(500)
      if (engine.state.phase === 'halftime') engine.startSecondHalf()
    }
    const st = engine.state
    agg.homeGoals += st.score.home
    agg.awayGoals += st.score.away
    agg.homeShots += st.home.stats.shots
    agg.awayShots += st.away.stats.shots
    agg.homeSOT += st.home.stats.shotsOnTarget
    agg.awaySOT += st.away.stats.shotsOnTarget
    const totalPoss = st.home.stats.possessionTicks + st.away.stats.possessionTicks || 1
    agg.homePoss += (st.home.stats.possessionTicks / totalPoss) * 100
    agg.homeCorners += st.home.stats.corners
    agg.awayCorners += st.away.stats.corners
    agg.homeFouls += st.home.stats.fouls
    agg.awayFouls += st.away.stats.fouls
    agg.homeYellows += st.home.stats.yellowCards
    agg.awayYellows += st.away.stats.yellowCards
    agg.homeOffsides += st.home.stats.offsides
    agg.awayOffsides += st.away.stats.offsides
    agg.passesHome += st.home.stats.passes
    agg.passesAway += st.away.stats.passes
    agg.passAccHome += st.home.stats.passes ? (st.home.stats.passesOk / st.home.stats.passes) * 100 : 0
    agg.passAccAway += st.away.stats.passes ? (st.away.stats.passesOk / st.away.stats.passes) * 100 : 0
    agg.eventsCount += st.events.length
    if (st.score.home + st.score.away > 8) agg.goalsOver8++

    const onPitchHome = st.home.lineup.map((id) => st.players[id].stamina)
    const onPitchAway = st.away.lineup.map((id) => st.players[id].stamina)
    agg.avgStaminaHome += onPitchHome.reduce((a, b) => a + b, 0) / 11
    agg.avgStaminaAway += onPitchAway.reduce((a, b) => a + b, 0) / 11
    const h2 = st.players['h2'].stamina
    agg.h2Stamina += h2
    agg.minStamina = Math.min(agg.minStamina, h2)
  }

  const f = (n: number, d = 1) => (n / N).toFixed(d)
  console.log(`\n=== ${v.name} (${N} matchs) ===`)
  console.log(`buts/match      : LUM ${f(agg.homeGoals, 2)} - ${f(agg.awayGoals, 2)} SPA`)
  console.log(`tirs/match      : LUM ${f(agg.homeShots)} - ${f(agg.awayShots)}  | cadrés ${f(agg.homeSOT)} - ${f(agg.awaySOT)}`)
  console.log(`possession LUM  : ${f(agg.homePoss)}%`)
  console.log(`passes          : LUM ${f(agg.passesHome, 0)} (${f(agg.passAccHome)}%) - SPA ${f(agg.passesAway, 0)} (${f(agg.passAccAway)}%)`)
  console.log(`corners         : ${f(agg.homeCorners)} - ${f(agg.awayCorners)}`)
  console.log(`hors-jeu        : ${f(agg.homeOffsides)} - ${f(agg.awayOffsides)}`)
  console.log(`fautes [🟨]     : ${f(agg.homeFouls)} [${f(agg.homeYellows, 2)}] - ${f(agg.awayFouls)} [${f(agg.awayYellows, 2)}]`)
  console.log(`endurance 90'   : LUM ${f(agg.avgStaminaHome)}% - SPA ${f(agg.avgStaminaAway)}% | Lambert (h2): ${f(agg.h2Stamina)}% min ${agg.minStamina.toFixed(0)}%`)
  console.log(`matchs >8 buts  : ${agg.goalsOver8}/${N} | evts/match ${f(agg.eventsCount, 0)}`)
}
