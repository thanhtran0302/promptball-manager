// Calibration et bench du moteur : simule N matchs et imprime les stats
// moyennes. Mode sweep (npm run sim -- 20 --sweep) : un réglage tactique à
// la fois contre un adversaire neutre — chaque dial doit bouger sa colonne.
// Mode check (npm run sim -- 30 --check) : confronte les mesures aux bornes du
// Pilier A et sort en code non nul si l'une est franchie — c'est la règle d'or
// n°2 d'une PR, rendue exécutable.
// Mode real (npm run sim -- 30 --check --real) : rejoue le bench sur deux
// vrais clubs de Ligue 3 au lieu des équipes fictives.
// Usage : npm run sim [matchs] [--sweep|--check] [--real]

import { existsSync, readFileSync } from 'node:fs'
import { MatchEngine } from '../src/engine/sim'
import { defaultInstructions } from '../src/engine/instructions'
import type { MatchInstructions, Team } from '../src/engine/types'
import { TEAMS } from '../src/data/teams'

const args = process.argv.slice(2)
const N = Number(args.find((a) => !a.startsWith('--')) ?? 20)
const SWEEP = args.includes('--sweep')
const CHECK = args.includes('--check')
const REAL = args.includes('--real')

const GENERATED = 'src/data/national.generated.json'

/**
 * Équipes du bench. Par défaut les deux équipes fictives, et ce défaut compte :
 * le bench mesure le moteur, pas les joueurs. Ses bornes n'ont de sens que
 * mesurées sur une référence stable — les faire varier avec les effectifs
 * rendrait impossible d'attribuer une dérive à un changement de moteur.
 *
 * --real rejoue les mêmes mesures sur deux vrais clubs pour observer ce que le
 * moteur donne sur des joueurs de D3, qui passent et courent moins bien. Les
 * chiffres obtenus ne sont alors plus comparables aux bornes du Pilier A.
 */
function benchTeams(): [Team, Team] {
  if (!REAL) return [TEAMS[0], TEAMS[1]]
  if (!existsSync(GENERATED)) {
    console.error(`--real demande ${GENERATED} — lancer d'abord : npm run fetch:national`)
    process.exit(1)
  }
  const real = JSON.parse(readFileSync(GENERATED, 'utf8')) as Team[]
  if (real.length < 2) {
    console.error(`${GENERATED} ne contient que ${real.length} club(s)`)
    process.exit(1)
  }
  return [real[0], real[1]]
}

const [home, away] = benchTeams()
const MATCHUP = REAL ? `${home.name} vs ${away.name}` : 'neutre vs neutre'

/**
 * Latéral gauche de l'équipe à domicile, cible des variantes d'overlap. Résolu
 * par poste plutôt que codé en dur : sur les équipes fictives cela retombe sur
 * h2 (Théo Lambert), et les variantes gardent un sens avec de vrais clubs.
 */
const overlapBack = home.players.find((p) => p.position === 'DG') ?? home.players[1]

const neutral = defaultInstructions()

interface Agg {
  goals: [number, number]
  shots: [number, number]
  sot: [number, number]
  poss: number
  passesOk: number
  corners: [number, number]
  offsides: [number, number]
  fouls: [number, number]
  yellows: [number, number]
  reds: number
  pens: number
  km: number
  goalsOver8: number
  sprintTicks: number
  runningTicks: number
  deadTicks: number
  totalTicks: number
  setPieceGoals: number
}

function run(matches: number, homeInstr: MatchInstructions, awayInstr: MatchInstructions): Agg {
  const agg: Agg = {
    goals: [0, 0], shots: [0, 0], sot: [0, 0], poss: 0, passesOk: 0, corners: [0, 0],
    offsides: [0, 0], fouls: [0, 0], yellows: [0, 0], reds: 0, pens: 0, km: 0, goalsOver8: 0,
    sprintTicks: 0, runningTicks: 0, deadTicks: 0, totalTicks: 0, setPieceGoals: 0,
  }
  for (let i = 0; i < matches; i++) {
    const engine = new MatchEngine({
      home,
      away,
      homeInstructions: structuredClone(homeInstr),
      awayInstructions: structuredClone(awayInstr),
      seed: 1000 + i * 7919,
      // les deux camps sont pilotés par le moteur : sans coach automatique, la
      // fatigue de fin de match mesurée ici ne correspond à aucun vrai match
      autoSubSides: ['home', 'away'],
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
    const totalPasses = st.home.stats.passes + st.away.stats.passes || 1
    agg.passesOk += ((st.home.stats.passesOk + st.away.stats.passesOk) / totalPasses) * 100
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
    // km par poste de champ sur l'ensemble du match (cible réaliste : 9-12 km).
    // On somme tous les joueurs ayant foulé la pelouse, remplaçants compris, puis
    // on divise par les dix postes de champ. Compter les joueurs de tms.lineup
    // mesurerait ceux qui ont FINI le match : makeSub y écrit l'entrant, si bien
    // qu'un remplaçant de la 75e (3 km) y figure pendant que le titulaire qu'il
    // remplace (9 km) en disparaît. La métrique n'était juste que tant que
    // personne ne remplaçait jamais.
    let kmSum = 0
    let slots = 0
    for (const tms of [st.home, st.away]) {
      for (const p of tms.team.players) {
        if (p.role === 'GK') continue
        kmSum += st.players[p.id].stats.distance
        agg.sprintTicks += st.players[p.id].stats.sprintTicks
        agg.runningTicks += st.players[p.id].stats.runningTicks
      }
      slots += 10
    }
    agg.km += kmSum / slots
    agg.deadTicks += st.deadTicks
    agg.totalTicks += st.tick
    agg.setPieceGoals += st.home.stats.setPieceGoals + st.away.stats.setPieceGoals
    if (st.score.home + st.score.away > 8) agg.goalsOver8++
  }
  return agg
}

/** Part en pourcentage, sûre quand le dénominateur est nul. */
function pct(num: number, den: number, d = 0): string {
  return den > 0 ? `${((num / den) * 100).toFixed(d)}%` : 'n/a'
}

function row(name: string, agg: Agg, n: number) {
  const f = (v: number, d = 2) => (v / n).toFixed(d)
  console.log(
    name.padEnd(26) +
      `| buts ${f(agg.goals[0])}-${f(agg.goals[1])}` +
      ` | tirs ${f(agg.shots[0], 1)}-${f(agg.shots[1], 1)} (cad ${f(agg.sot[0], 1)}-${f(agg.sot[1], 1)})` +
      ` | poss ${f(agg.poss, 1)}%` +
      ` | passes ${f(agg.passesOk, 1)}%` +
      ` | HJ ${f(agg.offsides[0], 1)}-${f(agg.offsides[1], 1)}` +
      ` | CF [🟨] ${f(agg.fouls[0], 1)} [${f(agg.yellows[0], 1)}] - ${f(agg.fouls[1], 1)} [${f(agg.yellows[1], 1)}]` +
      ` | 🟥 ${f(agg.reds, 2)} | pens ${f(agg.pens, 2)}` +
      ` | km/j ${f(agg.km / 1000, 1)}` +
      ` | sprint ${pct(agg.sprintTicks, agg.runningTicks)}` +
      ` | morts ${pct(agg.deadTicks, agg.totalTicks)}` +
      ` | CPA ${pct(agg.setPieceGoals, agg.goals[0] + agg.goals[1])}` +
      (agg.goalsOver8 ? ` | >8b ${agg.goalsOver8}/${n}` : ''),
  )
}

/**
 * Les bornes du Pilier A, telles qu'écrites dans la ROADMAP. Rendre ce tableau
 * exécutable est tout l'objet du mode --check : jusqu'ici le bench imprimait
 * des chiffres que personne ne confrontait à quoi que ce soit.
 */
interface Criterion {
  name: string
  /** valeur mesurée, dans l'unité de la borne */
  value: (agg: Agg, n: number) => number
  min: number
  max: number
  unit: string
}

const CRITERIA: Criterion[] = [
  { name: 'Buts / match', value: (a, n) => (a.goals[0] + a.goals[1]) / n, min: 2.5, max: 3.0, unit: '' },
  { name: 'Tirs / équipe', value: (a, n) => (a.shots[0] + a.shots[1]) / (2 * n), min: 11, max: 15, unit: '' },
  { name: 'Tirs cadrés', value: (a) => ((a.sot[0] + a.sot[1]) / Math.max(a.shots[0] + a.shots[1], 1)) * 100, min: 35, max: 42, unit: '%' },
  { name: 'Passes réussies', value: (a, n) => a.passesOk / n, min: 82, max: 86, unit: '%' },
  { name: 'Distance / poste', value: (a, n) => a.km / n / 1000, min: 9, max: 12, unit: ' km' },
  { name: 'Sprint / temps de course', value: (a) => (a.sprintTicks / Math.max(a.runningTicks, 1)) * 100, min: 0, max: 10, unit: '%' },
  // la ROADMAP dit « ~30 % » : lu comme 25-35
  { name: 'Temps morts', value: (a) => (a.deadTicks / Math.max(a.totalTicks, 1)) * 100, min: 25, max: 35, unit: '%' },
  { name: 'Buts sur phase arrêtée', value: (a) => (a.setPieceGoals / Math.max(a.goals[0] + a.goals[1], 1)) * 100, min: 25, max: 35, unit: '%' },
]

/**
 * Bornes connues comme franchies, avec le chantier de la ROADMAP qui les
 * refermera. Elles s'affichent mais ne font pas échouer le run : le check reste
 * ainsi utilisable comme garde-fou dès aujourd'hui, et retirer une ligne d'ici
 * est ce qui matérialise l'avancement d'un chantier.
 *
 * La table est vide : les huit critères du Pilier A tiennent dans leurs bornes.
 * Toute ligne rajoutée ici est une dette, pas un ajustement — elle doit nommer
 * le chantier qui la refermera.
 */
const KNOWN_BREACHES = new Map<string, string>([])

if (CHECK) {
  console.log(`\n=== CHECK Pilier A (${N} matchs, ${MATCHUP}) ===`)
  if (REAL) {
    console.log(
      'Les bornes du Pilier A ont été calibrées sur les équipes fictives : ' +
        'les écarts ci-dessous mesurent le niveau des joueurs autant que le moteur.',
    )
  }
  const agg = run(N, structuredClone(neutral), neutral)
  let failed = 0
  let tolerated = 0
  for (const c of CRITERIA) {
    const v = c.value(agg, N)
    const ok = v >= c.min && v <= c.max
    const known = KNOWN_BREACHES.get(c.name)
    const mark = ok ? '✅' : known ? '⚠️ ' : '❌'
    if (!ok) known ? tolerated++ : failed++
    console.log(
      `${mark} ${c.name.padEnd(26)} ${(v.toFixed(1) + c.unit).padStart(8)}` +
        `   cible ${c.min}-${c.max}${c.unit}` +
        (ok ? '' : known ? `   toléré — ${known}` : '   HORS BORNES'),
    )
  }
  console.log(
    `\n${failed} borne(s) franchie(s), ${tolerated} tolérée(s) (chantier ROADMAP ouvert).`,
  )
  if (failed > 0) {
    console.log("Retirez la régression, ou déplacez la borne dans KNOWN_BREACHES avec le chantier qui la porte.")
    process.exitCode = 1
  }
} else if (SWEEP) {
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
    { name: `overlap ${overlapBack.name} élevé`, mut: (mi) => mi.players.push({ playerId: overlapBack.id, instruction: 'overlap', intensity: 'elevee' }) },
  ]
  for (const dial of dials) {
    const instr = structuredClone(neutral)
    dial.mut(instr)
    row(dial.name, run(N, instr, neutral), N)
  }
} else {
  console.log(`\n=== Calibration (${N} matchs, ${MATCHUP}) ===`)
  const variants: { name: string; mut: (mi: MatchInstructions) => void }[] = [
    { name: 'neutre vs neutre', mut: () => {} },
    {
      name: `${home.short} pressing haut + tempo rapide`,
      mut: (mi) => {
        mi.team = { ...mi.team, pressing: 'haut', tempo: 'rapide', mentality: 'offensif' }
        mi.players = [{ playerId: overlapBack.id, instruction: 'overlap', intensity: 'elevee' }]
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
