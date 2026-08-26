# Blessures et prolongation — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter la prolongation (avec 6e changement et 4e fenêtre) et un système de blessures léger (touché / sortant, remplacement forcé) au moteur de match.

**Architecture:** La prolongation réutilise le mécanisme de pause existant — `tick()` sort déjà tôt sur `halftime`, donc une pause est « une phase qui gèle le moteur jusqu'à un appel explicite ». Quatre phases s'ajoutent à l'union `MatchPhase`, gardées par deux prédicats `isBreak` / `isExtraTime`. Les compteurs de remplacement posés précédemment ne changent pas ; seuls leurs plafonds deviennent fonction de la phase. Les blessures réutilisent la machinerie de `sendOff` (joueur hors terrain, poste conservé dans `lineup`) avec une autre cause.

**Tech Stack:** TypeScript strict, React 18, Vite, Vitest. Aucune dépendance nouvelle.

**Spec:** `docs/superpowers/specs/2026-08-27-blessures-et-prolongation-design.md`

## Global Constraints

- Le moteur est **déterministe** : tout tirage passe par `this.rng` (`src/engine/rng.ts`). N'utiliser ni `Math.random()` ni `Date.now()` dans `src/engine/`.
- `npx tsc --noEmit` doit rester propre à chaque commit.
- `npm run sim -- 30 --check` doit rester à **8/8 bornes vertes**, et continuer à mesurer sur des matchs de **90 minutes** (`knockout` faux au bench).
- Les commentaires du code sont en **français**, comme tout le dépôt.
- Les constantes de calibration portent en commentaire **la valeur mesurée** qui les justifie, pas seulement leur intention.
- Cibles de blessure, toutes équipes confondues : **0,25 à 0,45 sortie par match**, **0,8 à 1,6 touchés par match**.
- La suite complète (`npx vitest run`) dure ~3,5 minutes. La lancer en arrière-plan, pas en avant-plan.

## Structure des fichiers

| Fichier | Responsabilité | Tâches |
|---|---|---|
| `src/engine/types.ts` | Union `MatchPhase`, prédicats `isBreak` / `isExtraTime`, `EXTRA_HALF_TICKS`, `periodEndTick`, `LivePlayer.injury`, type d'événement `'injury'` | 1, 2, 4, 5 |
| `src/engine/sim.ts` | Transitions de période, plafonds fonction de la phase, tirage et effets de blessure, remplacement forcé | 1-6 |
| `src/engine/autoSub.ts` | Rendez-vous du coach sur les pauses de prolongation | 2, 6 |
| `src/game/controller.ts` | Boucle temps réel et reprise sur n'importe quelle pause | 1, 7 |
| `src/ui/screens/MatchScreen.tsx` | Libellés de minute et de pause, marqueur de blessure | 7 |
| `src/ui/screens/SetupScreen.tsx`, `src/App.tsx` | Option « élimination directe » | 7 |
| `src/ui/screens/PostMatchScreen.tsx` | Filtre d'événements | 7 |
| `src/engine/engine.test.ts` | Tests de toutes les tâches | 1-6 |
| `scripts/sim.ts` | Bench : `knockout` faux, appel de reprise renommé | 1 |

**Note de séquencement** : les tâches 1 à 3 (prolongation) précèdent les tâches 4 à 6 (blessures) parce que les deux modifient `makeSub`. Les faire en parallèle produirait un conflit sur cette fonction.

---

### Task 1: Phases de pause génériques, sans changement de comportement

Refactor pur : l'union s'élargit, les prédicats apparaissent, tous les sites qui testaient `'halftime'` passent aux prédicats. Aucune prolongation n'est encore déclenchée, donc les 129 tests existants doivent passer **sans être modifiés** (hors renommage de `startSecondHalf`).

**Files:**
- Modify: `src/engine/types.ts` (union `MatchPhase`, ~ligne 300)
- Modify: `src/engine/sim.ts` (`tick`, `halftime`, `startSecondHalf`, `makeSub`, `opensSubWindow`, `canSub`)
- Modify: `src/engine/autoSub.ts` (test de phase)
- Modify: `src/game/controller.ts` (boucle, `resume`)
- Modify: `src/ui/screens/MatchScreen.tsx` (variable `halftime`)
- Modify: `scripts/sim.ts` (ligne 102)
- Test: `src/engine/engine.test.ts`

**Interfaces:**
- Consomme : rien (première tâche)
- Produit : `isBreak(p: MatchPhase): boolean`, `isExtraTime(p: MatchPhase): boolean`, `EXTRA_HALF_TICKS: number`, `MatchState.periodEndTick: number`, `MatchEngine.startNextPeriod(): void`

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter dans `src/engine/engine.test.ts`, à l'intérieur du `describe('MatchEngine', ...)` :

```ts
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
```

Compléter l'import en tête du fichier :

```ts
import { FORMATION_SLOTS } from './formations'
import { HALF_TICKS, TICK_SEC, isBreak, isExtraTime, type Player, type Team } from './types'
```

- [ ] **Step 2: Lancer le test, vérifier qu'il échoue**

Run: `npx vitest run -t "prédicats de phase"`
Expected: FAIL — `isBreak is not exported` / erreur de compilation TypeScript.

- [ ] **Step 3: Élargir l'union et ajouter les prédicats**

Dans `src/engine/types.ts`, remplacer la ligne `export type MatchPhase = ...` :

```ts
export type MatchPhase =
  | 'first_half'
  | 'halftime'
  | 'second_half'
  | 'break_before_extra'
  | 'extra_first_half'
  | 'extra_halftime'
  | 'extra_second_half'
  | 'finished'

/**
 * Pause : le moteur est gelé jusqu'à un appel explicite à startNextPeriod().
 * Les trois pauses sont aussi les moments où un remplacement ne consomme
 * aucune fenêtre (règlement IFAB).
 */
export const isBreak = (p: MatchPhase): boolean =>
  p === 'halftime' || p === 'break_before_extra' || p === 'extra_halftime'

/**
 * Prolongation, coupure d'avant-prolongation comprise : l'IFAB ouvre la
 * substitution supplémentaire dès la coupure, pas au coup d'envoi.
 */
export const isExtraTime = (p: MatchPhase): boolean =>
  p === 'break_before_extra' ||
  p === 'extra_first_half' ||
  p === 'extra_halftime' ||
  p === 'extra_second_half'
```

Ajouter à côté de `HALF_TICKS` :

```ts
export const EXTRA_HALF_TICKS = 9_000 // 15 min
```

Ajouter le champ dans `MatchState`, sous `addedTimeSec` :

```ts
  /**
   * Tick de fin de la période en cours. Porté en état plutôt que recalculé :
   * la prolongation devrait sinon retrouver le temps additionnel de la
   * seconde mi-temps à chaque tick pour connaître son origine.
   */
  periodEndTick: number
```

- [ ] **Step 4: Poser periodEndTick et basculer les sites de phase**

Dans `src/engine/sim.ts`, importer `isBreak` et `EXTRA_HALF_TICKS` depuis `./types` (l'import de `HALF_TICKS` existe déjà, ligne ~29).

Dans le constructeur, initialiser à côté de `addedTimeSec` :

```ts
      periodEndTick: HALF_TICKS,
```

Dans `tick()`, remplacer les deux tests de borne :

```ts
  tick(): void {
    const st = this.state
    if (st.phase === 'finished' || isBreak(st.phase)) return
    st.tick++

    if (st.tick >= st.periodEndTick) {
      this.endOfPeriod()
      return
    }
    this.runAutoSubs()
```

Remplacer `halftime()` et `startSecondHalf()` par :

```ts
  /** Fin de période : pause, ou coup de sifflet final. */
  private endOfPeriod() {
    const st = this.state
    st.ball.carrierId = null
    st.ball.transit = null
    if (st.phase === 'first_half') {
      st.phase = 'halftime'
      this.log(
        'halftime',
        `Mi-temps : ${st.home.team.short} ${st.score.home} - ${st.score.away} ${st.away.team.short}.`,
      )
      this.runAutoSubs()
      return
    }
    this.fulltime()
  }

  /** Reprise après une pause : enchaîne sur la période suivante. */
  startNextPeriod() {
    const st = this.state
    if (!isBreak(st.phase)) return
    if (st.phase === 'halftime') {
      st.phase = 'second_half'
      st.periodEndTick = HALF_TICKS * 2 + Math.round(st.addedTimeSec / TICK_SEC)
      this.resetPositions('away')
    }
  }
```

`fulltime()` reste inchangé pour l'instant.

Remplacer les tests de phase restants :
- `src/engine/sim.ts`, `opensSubWindow` : `this.state.phase !== 'halftime'` → `!isBreak(this.state.phase)`
- `src/engine/sim.ts`, `makeSub` : `if (st.phase !== 'halftime') tms.lastSubTick = st.tick` → `if (!isBreak(st.phase)) tms.lastSubTick = st.tick`
- `src/engine/sim.ts`, `makeSub` : `const free = ...` s'il subsiste, aligner sur `isBreak`
- `src/engine/autoSub.ts` : `if (st.phase === 'halftime') trigger = 'ht'` → `if (isBreak(st.phase)) trigger = 'ht'` (importer `isBreak`)
- `src/game/controller.ts` : les deux `=== 'halftime'` (boucle `update`, et `resume`) → `isBreak(...)`, et `this.engine.startSecondHalf()` → `this.engine.startNextPeriod()`
- `src/ui/screens/MatchScreen.tsx` : `const halftime = st.phase === 'halftime'` → `const halftime = isBreak(st.phase)`
- `scripts/sim.ts:102` et tous les sites de `engine.test.ts` : `startSecondHalf()` → `startNextPeriod()`

- [ ] **Step 5: Lancer les tests, vérifier qu'ils passent**

Run: `npx tsc --noEmit && npx vitest run src/engine/engine.test.ts` (en arrière-plan)
Expected: PASS, 131 tests (129 existants + 2 nouveaux).

- [ ] **Step 6: Vérifier que le bench n'a pas bougé**

Run: `npm run sim -- 30 --check`
Expected: 8/8 bornes vertes, distance ~11,0 km.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor : phases de pause génériques (isBreak / isExtraTime)"
```

---

### Task 2: Déclenchement et déroulé de la prolongation

**Files:**
- Modify: `src/engine/sim.ts` (`MatchOptions`, `endOfPeriod`, `startNextPeriod`, `fulltime`)
- Test: `src/engine/engine.test.ts`

**Interfaces:**
- Consomme : `isBreak`, `isExtraTime`, `EXTRA_HALF_TICKS`, `periodEndTick`, `startNextPeriod()` (tâche 1)
- Produit : `MatchOptions.knockout?: boolean`

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
  /** Joue jusqu'à la fin en franchissant chaque pause. */
  function playOut(engine: MatchEngine) {
    let guard = 0
    while (engine.state.phase !== 'finished' && guard++ < 2000) {
      engine.runTicks(500)
      if (isBreak(engine.state.phase)) engine.startNextPeriod()
    }
    return engine
  }

  it('ne joue pas de prolongation en match de championnat', () => {
    const engine = playOut(
      new MatchEngine({
        home, away,
        homeInstructions: defaultInstructions(),
        awayInstructions: defaultInstructions(),
        seed: 5,
      }),
    )
    expect(engine.state.phase).toBe('finished')
    expect(engine.state.tick).toBeLessThan(HALF_TICKS * 2 + 2000)
  })

  it('joue la prolongation en élimination directe si le score est nul à 90', () => {
    // on cherche un seed qui donne un nul à 90' sans prolongation
    let drawSeed = -1
    for (let s = 1; s < 60 && drawSeed < 0; s++) {
      const probe = playOut(
        new MatchEngine({
          home, away,
          homeInstructions: defaultInstructions(),
          awayInstructions: defaultInstructions(),
          seed: s,
        }),
      )
      if (probe.state.score.home === probe.state.score.away) drawSeed = s
    }
    expect(drawSeed).toBeGreaterThan(0)

    const engine = playOut(
      new MatchEngine({
        home, away,
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
    let winSeed = -1
    for (let s = 1; s < 60 && winSeed < 0; s++) {
      const probe = playOut(
        new MatchEngine({
          home, away,
          homeInstructions: defaultInstructions(),
          awayInstructions: defaultInstructions(),
          seed: s,
        }),
      )
      if (probe.state.score.home !== probe.state.score.away) winSeed = s
    }
    expect(winSeed).toBeGreaterThan(0)
    const engine = playOut(
      new MatchEngine({
        home, away,
        homeInstructions: defaultInstructions(),
        awayInstructions: defaultInstructions(),
        seed: winSeed,
        knockout: true,
      }),
    )
    expect(engine.state.phase).toBe('finished')
    expect(engine.state.tick).toBeLessThan(HALF_TICKS * 2 + 2000)
  })
```

Ajouter `EXTRA_HALF_TICKS` à l'import de `./types` dans le fichier de test.

- [ ] **Step 2: Lancer les tests, vérifier qu'ils échouent**

Run: `npx vitest run -t "prolongation"`
Expected: FAIL — `knockout` n'existe pas dans `MatchOptions`.

- [ ] **Step 3: Implémenter**

Dans `MatchOptions` (`src/engine/sim.ts`) :

```ts
  /**
   * Match à élimination directe : une égalité à la fin du temps réglementaire
   * envoie en prolongation. Faux par défaut, et faux au sim-bench — sinon les
   * bornes du Pilier A se mesureraient sur des matchs de 120 minutes.
   */
  knockout?: boolean
```

Champ de classe, posé dans le constructeur à côté de `autoSubSides` :

```ts
  private readonly knockout: boolean
  // ...
    this.knockout = opts.knockout ?? false
```

Compléter `endOfPeriod()` :

```ts
  private endOfPeriod() {
    const st = this.state
    st.ball.carrierId = null
    st.ball.transit = null

    if (st.phase === 'first_half') {
      st.phase = 'halftime'
      this.log('halftime', `Mi-temps : ${st.home.team.short} ${st.score.home} - ${st.score.away} ${st.away.team.short}.`)
      this.runAutoSubs()
      return
    }

    if (st.phase === 'second_half') {
      if (this.knockout && st.score.home === st.score.away) {
        st.phase = 'break_before_extra'
        this.log('halftime', `Fin du temps réglementaire, ${st.score.home} - ${st.score.away} : on joue la prolongation.`)
        this.runAutoSubs()
        return
      }
      this.fulltime()
      return
    }

    if (st.phase === 'extra_first_half') {
      st.phase = 'extra_halftime'
      this.log('halftime', `Mi-temps de la prolongation : ${st.home.team.short} ${st.score.home} - ${st.score.away} ${st.away.team.short}.`)
      this.runAutoSubs()
      return
    }

    this.fulltime()
  }
```

Compléter `startNextPeriod()` :

```ts
  startNextPeriod() {
    const st = this.state
    if (!isBreak(st.phase)) return
    if (st.phase === 'halftime') {
      st.phase = 'second_half'
      st.periodEndTick = HALF_TICKS * 2 + Math.round(st.addedTimeSec / TICK_SEC)
      this.resetPositions('away')
      return
    }
    if (st.phase === 'break_before_extra') {
      st.phase = 'extra_first_half'
      st.periodEndTick += EXTRA_HALF_TICKS
      this.resetPositions('home')
      return
    }
    // extra_halftime
    st.phase = 'extra_second_half'
    st.periodEndTick += EXTRA_HALF_TICKS
    this.resetPositions('away')
  }
```

Dans `fulltime()`, distinguer le nul après prolongation :

```ts
  private fulltime() {
    const st = this.state
    const wasExtra = isExtraTime(st.phase)
    st.phase = 'finished'
    st.ball.carrierId = null
    st.ball.transit = null
    this.log(
      'fulltime',
      wasExtra && st.score.home === st.score.away
        ? // pas de séance de tirs au but dans le moteur : on le dit plutôt que de le masquer
          `Fin de la prolongation : ${st.home.team.short} ${st.score.home} - ${st.score.away} ${st.away.team.short}, toujours dos à dos.`
        : `Coup de sifflet final ! ${st.home.team.short} ${st.score.home} - ${st.score.away} ${st.away.team.short}.`,
    )
  }
```

- [ ] **Step 4: Lancer les tests, vérifier qu'ils passent**

Run: `npx tsc --noEmit && npx vitest run src/engine/engine.test.ts` (arrière-plan)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat : prolongation en match a elimination directe"
```

---

### Task 3: Sixième changement et quatrième fenêtre en prolongation

**Files:**
- Modify: `src/engine/sim.ts` (`makeSub`, `canSub`, nouveaux `maxSubs` / `maxSubWindows`)
- Test: `src/engine/engine.test.ts`

**Interfaces:**
- Consomme : `isExtraTime` (tâche 1), `knockout` (tâche 2), `MAX_SUBS`, `MAX_SUB_WINDOWS`, `subEngine()`, `benchIds()`
- Produit : rien de nouveau pour les tâches suivantes

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
  /** Amène un match d'élimination directe jusqu'à la coupure d'avant-prolongation. */
  function atExtraTimeBreak(): MatchEngine {
    for (let s = 1; s < 80; s++) {
      const engine = new MatchEngine({
        home: deepHome, away,
        homeInstructions: defaultInstructions(),
        awayInstructions: defaultInstructions(),
        seed: s,
        knockout: true,
      })
      let guard = 0
      while (engine.state.phase !== 'finished' && engine.state.phase !== 'break_before_extra' && guard++ < 2000) {
        engine.runTicks(500)
        if (engine.state.phase === 'halftime') engine.startNextPeriod()
      }
      if (engine.state.phase === 'break_before_extra') return engine
    }
    throw new Error('aucun seed ne produit de nul a 90 minutes')
  }

  it('accorde un 6e changement et une 4e fenêtre en prolongation', () => {
    const engine = atExtraTimeBreak()
    const bench = benchIds(engine)
    const onPitch = () => engine.state.home.lineup.filter((id) => engine.state.players[id].onPitch)

    // épuiser 5 joueurs et 3 fenêtres pendant le temps réglementaire est déjà
    // couvert ailleurs : ici on part de la coupure et on vérifie les plafonds
    expect(engine.state.phase).toBe('break_before_extra')
    // la coupure est gratuite : cinq changements possibles sans fenêtre
    let used = 0
    for (let i = 0; i < 5 && used < 5; i++) {
      const out = onPitch().find((id) => id !== engine.state.home.lineup[0])!
      if (engine.makeSub('home', out, bench[used]).ok) used++
    }
    expect(engine.state.home.subsUsed).toBe(5)
    expect(engine.state.home.subWindows).toBe(0)

    // le 6e passe : la prolongation en accorde un de plus
    const out6 = onPitch().find((id) => id !== engine.state.home.lineup[0])!
    expect(engine.makeSub('home', out6, bench[5]).ok).toBe(true)
    expect(engine.state.home.subsUsed).toBe(6)

    // le 7e est refusé
    const out7 = onPitch().find((id) => id !== engine.state.home.lineup[0])!
    const r = engine.makeSub('home', out7, bench[6])
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/6\/6/)
  })

  it('refuse le 6e changement pendant le temps réglementaire', () => {
    const engine = subEngine()
    const lineup = [...engine.state.home.lineup]
    const bench = benchIds(engine)
    let n = 0
    for (const perWindow of [2, 2, 1]) {
      engine.runTicks(1)
      for (let k = 0; k < perWindow; k++, n++) {
        expect(engine.makeSub('home', lineup[n + 1], bench[n]).ok).toBe(true)
      }
    }
    expect(engine.state.home.subsUsed).toBe(5)
    const r = engine.makeSub('home', lineup[7], bench[5])
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/5\/5/)
  })
```

- [ ] **Step 2: Lancer les tests, vérifier qu'ils échouent**

Run: `npx vitest run -t "6e changement"`
Expected: FAIL — le 6e changement est refusé en prolongation.

- [ ] **Step 3: Implémenter**

Dans `src/engine/sim.ts`, ajouter à côté de `opensSubWindow` :

```ts
  /**
   * Plafonds réglementaires. L'IFAB accorde en prolongation un remplacement
   * supplémentaire — que les cinq soient épuisés ou non — et une fenêtre de
   * plus. isExtraTime couvre la coupure d'avant-prolongation, où le droit est
   * déjà ouvert.
   */
  private maxSubs(): number {
    return isExtraTime(this.state.phase) ? MAX_SUBS + 1 : MAX_SUBS
  }

  private maxSubWindows(): number {
    return isExtraTime(this.state.phase) ? MAX_SUB_WINDOWS + 1 : MAX_SUB_WINDOWS
  }
```

Dans `canSub`, remplacer les deux constantes par les méthodes :

```ts
  canSub(side: Side): boolean {
    const tms = this.tms(side)
    if (this.state.phase === 'finished') return false
    if (tms.subsUsed >= this.maxSubs()) return false
    return !this.opensSubWindow(tms) || tms.subWindows < this.maxSubWindows()
  }
```

Dans `makeSub`, idem :

```ts
    const maxSubs = this.maxSubs()
    const maxWindows = this.maxSubWindows()
    if (tms.subsUsed >= maxSubs)
      return { ok: false, error: `Plus de remplacements disponibles (${maxSubs}/${maxSubs}).` }
    if (newWindow && tms.subWindows >= maxWindows)
      return {
        ok: false,
        error: `Plus de fenêtre de remplacement disponible (${maxWindows}/${maxWindows}) — attendez la mi-temps.`,
      }
```

- [ ] **Step 4: Lancer les tests, vérifier qu'ils passent**

Run: `npx tsc --noEmit && npx vitest run src/engine/engine.test.ts` (arrière-plan)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat : 6e changement et 4e fenetre en prolongation"
```

---

### Task 4: État de blessure et effet « touché »

**Files:**
- Modify: `src/engine/types.ts` (`LivePlayer.injury`, `MatchEventType`)
- Modify: `src/engine/sim.ts` (initialisation, boucle de déplacement ~ligne 1666)
- Test: `src/engine/engine.test.ts`

**Interfaces:**
- Consomme : rien des tâches 1-3
- Produit : `LivePlayer.injury: 'none' | 'knock' | 'out'`, `INJURY_SPEED_MUL`, `INJURY_ENDURANCE_MUL`, type d'événement `'injury'`

- [ ] **Step 1: Écrire le test qui échoue**

```ts
  it('un joueur touché court moins vite et se vide plus vite', () => {
    const run = (knock: boolean) => {
      const engine = subEngine()
      const id = engine.state.home.lineup[6] // un milieu, pas le gardien
      if (knock) engine.state.players[id].injury = 'knock'
      engine.runTicks(9000) // 15 minutes
      return {
        distance: engine.state.players[id].stats.distance,
        stamina: engine.state.players[id].stamina,
      }
    }
    const sain = run(false)
    const touche = run(true)
    expect(touche.distance).toBeLessThan(sain.distance)
    expect(touche.stamina).toBeLessThan(sain.stamina)
  })
```

- [ ] **Step 2: Lancer le test, vérifier qu'il échoue**

Run: `npx vitest run -t "joueur touché"`
Expected: FAIL — `injury` n'existe pas sur `LivePlayer`.

- [ ] **Step 3: Implémenter**

Dans `src/engine/types.ts`, `LivePlayer`, sous `subbedOff` :

```ts
  /**
   * 'knock' : reste en jeu, diminué jusqu'à la fin du match — un knock ne
   * guérit pas. 'out' : a dû quitter le terrain, son poste reste dans lineup.
   * Un joueur déjà 'knock' peut passer à 'out' ; l'inverse est impossible.
   */
  injury: 'none' | 'knock' | 'out'
```

Ajouter `'injury'` à `MatchEventType`, à côté de `'sub'`.

Dans `src/engine/sim.ts`, à l'initialisation des `LivePlayer` (à côté de `subbedOff: false`) :

```ts
          injury: 'none',
```

Constantes, à côté de `MAX_SUBS` :

```ts
/**
 * Effet d'un joueur touché qui reste en jeu : il perd de la vitesse de pointe
 * et se vide plus vite. Le coach automatique le sortira donc de lui-même au
 * prochain rendez-vous, sans règle dédiée.
 */
const INJURY_SPEED_MUL = 0.85
const INJURY_ENDURANCE_MUL = 0.8
```

Dans la boucle de déplacement, `src/engine/sim.ts:1650`, remplacer :

```ts
      const vmaxFull = maxSpeed(p.attributes.pace, lp.stamina)
```

par :

```ts
      const knocked = lp.injury === 'knock'
      const vmaxFull = maxSpeed(p.attributes.pace, lp.stamina) * (knocked ? INJURY_SPEED_MUL : 1)
```

Puis, à l'appel de `updateStamina` (`src/engine/sim.ts:1694`), remplacer le
seul argument d'endurance — `p.attributes.stamina` devient conditionnel, tout
le reste de l'appel est inchangé :

```ts
      updateStamina(
        lp,
        TICK_SEC,
        {
          speedRatio,
          pressing: ti.pressing,
          tempo: ti.tempo,
          extraWork,
          intensityElevee: pi?.intensity === 'elevee',
        },
        knocked ? p.attributes.stamina * INJURY_ENDURANCE_MUL : p.attributes.stamina,
        p.role === 'GK',
      )
```

- [ ] **Step 4: Lancer le test, vérifier qu'il passe**

Run: `npx tsc --noEmit && npx vitest run -t "joueur touché"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat : etat de blessure et effet touche"
```

---

### Task 5: Tirage du risque de blessure

**Files:**
- Modify: `src/engine/sim.ts` (tirage sur faute ~ligne 1524, sur sprint ~ligne 1682, méthode `injure`)
- Create: `scripts/probe-injuries.ts` (script de calibration, supprimé au step 6)
- Test: `src/engine/engine.test.ts`

**Interfaces:**
- Consomme : `LivePlayer.injury` (tâche 4)
- Produit : `private injure(side: Side, playerId: string, cause: 'contact' | 'muscle'): void`

- [ ] **Step 1: Écrire le test qui échoue**

```ts
  it('produit un taux de blessures réaliste (20 matchs)', () => {
    let out = 0
    let knocks = 0
    for (let s = 0; s < 20; s++) {
      const engine = playOut(
        new MatchEngine({
          home, away,
          homeInstructions: defaultInstructions(),
          awayInstructions: defaultInstructions(),
          seed: 300 + s * 131,
        }),
      )
      for (const lp of Object.values(engine.state.players)) {
        if (lp.injury === 'out') out++
        else if (lp.injury === 'knock') knocks++
      }
    }
    // cibles UEFA (~8 blessures / 1000 h de match) : 0,25-0,45 sortie/match
    expect(out / 20).toBeGreaterThanOrEqual(0.25)
    expect(out / 20).toBeLessThanOrEqual(0.45)
    expect(knocks / 20).toBeGreaterThanOrEqual(0.8)
    expect(knocks / 20).toBeLessThanOrEqual(1.6)
  })
```

- [ ] **Step 2: Lancer le test, vérifier qu'il échoue**

Run: `npx vitest run -t "taux de blessures"`
Expected: FAIL — 0 blessure, aucun tirage n'existe.

- [ ] **Step 3: Implémenter le tirage, avec des constantes provisoires**

Dans `src/engine/sim.ts`, constantes à côté de `INJURY_SPEED_MUL` :

```ts
/**
 * Risque de blessure. Deux sources, les deux dominantes en vrai : le contact
 * (faute subie) et la lésion musculaire (sprint sur des jambes vides).
 * Valeurs calibrées par mesure — voir le commentaire de mesure ci-dessous.
 */
const INJURY_ON_FOUL = 0.02
const INJURY_ON_CLEAN_TACKLE = 0.003
/** Risque par tick de sprint, nul au-dessus de INJURY_FATIGUE_FROM. */
const INJURY_SPRINT_BASE = 0.00004
const INJURY_FATIGUE_FROM = 70
/** Part des blessures qui obligent à sortir ; le reste laisse un joueur diminué. */
const INJURY_SEVERE = 0.3
```

Méthode, à placer près de `sendOff` :

```ts
  /**
   * Blessure. La gravité est un tirage séparé du déclenchement : le taux de
   * sorties et le taux de touchés se calibrent alors indépendamment.
   * Un joueur déjà 'out' n'est plus concerné ; un 'knock' peut s'aggraver.
   */
  private injure(side: Side, playerId: string, cause: 'contact' | 'muscle') {
    const st = this.state
    const lp = st.players[playerId]
    if (!lp || !lp.onPitch || lp.injury === 'out') return

    const severe = this.rng.chance(INJURY_SEVERE)
    const how = cause === 'contact' ? 'touché sur l’action' : 'se tient la cuisse'
    if (!severe) {
      if (lp.injury === 'knock') return // déjà diminué, rien de neuf à dire
      lp.injury = 'knock'
      this.log('injury', `🤕 ${this.nameOf(playerId)} ${how} — il reste sur le terrain, diminué.`, side, playerId)
      return
    }

    lp.injury = 'out'
    lp.onPitch = false
    this.sliceTargets.delete(playerId)
    this.presserRanks.delete(playerId)
    if (st.ball.carrierId === playerId) {
      st.ball.carrierId = null
      const winner = this.nearestTo(st.ball.x, st.ball.y)
      if (winner) {
        st.ball.carrierId = winner.id
        st.possession = winner.side
      }
    }
    this.log('injury', `🚑 ${this.nameOf(playerId)} ne peut pas continuer, il quitte le terrain.`, side, playerId)
    this.forcedSub(side, playerId)
  }

  /**
   * Vide à ce stade : la sortie forcée est traitée en tâche 6. Les noms de
   * paramètres sont préfixés d'un souligné, seule forme acceptée par
   * `noUnusedParameters` (activé dans tsconfig.json).
   */
  private forcedSub(_side: Side, _playerId: string) {}
```

Accroche contact : dans la branche `if (this.rng.chance(foulProb)) { ... }`, juste après le `this.log('foul', ...)` :

```ts
      // le fauté encaisse le contact : première source de blessure en vrai
      if (this.rng.chance(INJURY_ON_FOUL)) this.injure(carrier.side, carrier.id, 'contact')
```

Et sur le tacle propre, juste après `this.log('tackle', ...)` :

```ts
      if (this.rng.chance(INJURY_ON_CLEAN_TACKLE)) this.injure(carrier.side, carrier.id, 'contact')
```

Accroche musculaire : dans la boucle de déplacement, dans le bloc
`if (mps > SPRINT_SPEED) { lp.stats.sprintTicks++ }` :

```ts
          if (mps > SPRINT_SPEED) {
            lp.stats.sprintTicks++
            // lésion musculaire : le risque n'existe que sur des jambes déjà
            // entamées, et croît à mesure que la fraîcheur tombe
            if (lp.stamina < INJURY_FATIGUE_FROM) {
              const fatigue = (INJURY_FATIGUE_FROM - lp.stamina) / INJURY_FATIGUE_FROM
              if (this.rng.chance(INJURY_SPRINT_BASE * fatigue)) this.injure(lp.side, lp.id, 'muscle')
            }
          }
```

- [ ] **Step 4: Calibrer par mesure**

Créer `scripts/probe-injuries.ts` :

```ts
import { MatchEngine } from '../src/engine/sim'
import { defaultInstructions } from '../src/engine/instructions'
import { isBreak } from '../src/engine/types'
import { TEAMS } from '../src/data/teams'

const [home, away] = TEAMS
const N = 40
let out = 0
let knocks = 0
let contact = 0
for (let s = 0; s < N; s++) {
  const e = new MatchEngine({
    home, away,
    homeInstructions: defaultInstructions(),
    awayInstructions: defaultInstructions(),
    seed: 300 + s * 131,
  })
  let g = 0
  while (e.state.phase !== 'finished' && g++ < 2000) {
    e.runTicks(500)
    if (isBreak(e.state.phase)) e.startNextPeriod()
  }
  for (const lp of Object.values(e.state.players)) {
    if (lp.injury === 'out') out++
    else if (lp.injury === 'knock') knocks++
  }
  contact += e.state.events.filter((ev) => ev.type === 'injury' && ev.message.includes('touché sur')).length
}
console.log(`sorties/match  = ${(out / N).toFixed(2)}   cible 0,25-0,45`)
console.log(`touchés/match  = ${(knocks / N).toFixed(2)}   cible 0,80-1,60`)
console.log(`dont contact   = ${(contact / N).toFixed(2)}`)
```

Run: `npx tsx scripts/probe-injuries.ts`

Ajuster `INJURY_ON_FOUL`, `INJURY_SPRINT_BASE` et `INJURY_SEVERE` jusqu'à
tomber dans les deux cibles, puis **écrire les valeurs mesurées dans le
commentaire des constantes**, sous la forme utilisée ailleurs dans le fichier
(« mesuré : 0,34 sortie/match et 1,2 touchés/match sur 40 matchs »).

- [ ] **Step 5: Lancer le test, vérifier qu'il passe**

Run: `npx vitest run -t "taux de blessures"`
Expected: PASS.

- [ ] **Step 6: Supprimer la sonde et commiter**

```bash
rm scripts/probe-injuries.ts
git add -A
git commit -m "feat : risque de blessure sur contact et sur sprint"
```

---

### Task 6: Sortie sur blessure et remplacement forcé

**Files:**
- Modify: `src/engine/sim.ts` (`makeSub` garde du sortant, `forcedSub`)
- Modify: `src/engine/autoSub.ts` (exposer la sélection d'un entrant)
- Test: `src/engine/engine.test.ts`

**Interfaces:**
- Consomme : `injure` et `forcedSub` (tâche 5), `canSub` / `makeSub` (tâches 1-3), `autoSubSides`
- Produit : `pickReplacement(engine, side, outId): string | null` exporté depuis `autoSub.ts`

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
  it('permet de remplacer un blessé sorti, jamais un exclu', () => {
    const engine = subEngine()
    engine.runTicks(1)
    const bench = benchIds(engine)
    const injured = engine.state.home.lineup[4]
    engine.state.players[injured].injury = 'out'
    engine.state.players[injured].onPitch = false
    expect(engine.makeSub('home', injured, bench[0]).ok).toBe(true)

    const excluded = engine.state.home.lineup[5]
    engine.state.players[excluded].sentOff = true
    engine.state.players[excluded].onPitch = false
    engine.runTicks(1)
    expect(engine.makeSub('home', excluded, bench[1]).ok).toBe(false)
  })

  it('le coach automatique remplace immédiatement un blessé sorti', () => {
    const engine = new MatchEngine({
      home, away,
      homeInstructions: defaultInstructions(),
      awayInstructions: defaultInstructions(),
      seed: 5,
      autoSubSides: ['away'],
    })
    engine.runTicks(600)
    const victim = engine.state.away.lineup.find(
      (id) => engine.state.players[id].onPitch && away.players.find((p) => p.id === id)!.role !== 'GK',
    )!
    const before = engine.state.away.subsUsed
    // @ts-expect-error accès direct à la méthode privée pour le test
    engine.injure('away', victim, 'contact')
    if (engine.state.players[victim].injury === 'out') {
      expect(engine.state.away.subsUsed).toBe(before + 1)
      expect(engine.state.away.lineup).not.toContain(victim)
    }
  })

  it('finit à dix quand le quota est épuisé au moment de la blessure', () => {
    const engine = subEngine()
    const lineup = [...engine.state.home.lineup]
    const bench = benchIds(engine)
    let n = 0
    for (const perWindow of [2, 2, 1]) {
      engine.runTicks(1)
      for (let k = 0; k < perWindow; k++, n++) engine.makeSub('home', lineup[n + 1], bench[n])
    }
    expect(engine.state.home.subsUsed).toBe(5)
    const victim = engine.state.home.lineup.find(
      (id) => engine.state.players[id].onPitch && deepHome.players.find((p) => p.id === id)!.role !== 'GK',
    )!
    // @ts-expect-error accès direct à la méthode privée pour le test
    engine.injure('home', victim, 'muscle')
    if (engine.state.players[victim].injury === 'out') {
      const onPitch = engine.state.home.lineup.filter((id) => engine.state.players[id].onPitch).length
      expect(onPitch).toBe(10)
    }
  })
```

- [ ] **Step 2: Lancer les tests, vérifier qu'ils échouent**

Run: `npx vitest run -t "blessé sorti"`
Expected: FAIL — `makeSub` refuse un sortant hors terrain.

- [ ] **Step 3: Implémenter**

Dans `makeSub` (`src/engine/sim.ts`), remplacer la garde du sortant :

```ts
    // un blessé qui a quitté le terrain reste remplaçable — c'est même le seul
    // cas où le sortant n'est pas sur la pelouse. L'exclu, lui, ne l'est pas.
    if (!out || (!out.onPitch && out.injury !== 'out'))
      return { ok: false, error: `${this.nameOf(outId)} n'est pas sur le terrain.` }
```

Dans `src/engine/autoSub.ts`, extraire la sélection d'un entrant :

```ts
/**
 * Remplaçant retenu pour un sortant donné : doublure au poste si elle existe,
 * sinon le meilleur restant. Laisser un poste vacant coûte plus cher qu'un
 * poste approximatif.
 */
export function pickReplacement(engine: MatchEngine, side: Side, outId: string): string | null {
  const st = engine.state
  const tms = st[side]
  const outRole = tms.team.players.find((p) => p.id === outId)?.role
  const pool = tms.team.players.filter((p) => {
    const lp = st.players[p.id]
    return lp && !lp.onPitch && !lp.sentOff && !lp.subbedOff && lp.injury === 'none' && p.role !== 'GK'
  })
  if (pool.length === 0) return null
  return (pool.find((p) => p.role === outRole) ?? pool[0]).id
}
```

Réutiliser `pickReplacement` dans la boucle de `runAutoSub` à la place de la
sélection en ligne, pour que les deux chemins partagent la même règle.

Remplacer le placeholder `forcedSub` dans `src/engine/sim.ts` :

```ts
  /**
   * Sortie sur blessure : le camp auto-coaché remplace immédiatement, hors
   * rendez-vous. Une blessure consomme un joueur et une fenêtre — le règlement
   * ne prévoit aucune exemption. Le camp humain décide lui-même, y compris de
   * finir à dix. Quota épuisé ou banc vide : l'équipe joue en infériorité.
   */
  private forcedSub(side: Side, playerId: string) {
    const tms = this.tms(side)
    const short = () =>
      this.log(
        'info',
        `${tms.team.short} n'a plus de solution sur le banc : l'équipe finit à ${tms.lineup.filter((id) => this.state.players[id].onPitch).length}.`,
        side,
      )
    if (!this.autoSubSides.includes(side)) return
    if (!this.canSub(side)) return short()
    const inId = pickReplacement(this, side, playerId)
    if (!inId) return short()
    if (!this.makeSub(side, playerId, inId).ok) short()
  }
```

Importer `pickReplacement` depuis `./autoSub` en tête de `sim.ts`.

Note : `makeSub` remet `lineup[idx] = inId`, donc le blessé quitte bien la
composition ; le test `not.toContain(victim)` en dépend.

- [ ] **Step 4: Lancer les tests, vérifier qu'ils passent**

Run: `npx tsc --noEmit && npx vitest run src/engine/engine.test.ts` (arrière-plan)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat : sortie sur blessure et remplacement force"
```

---

### Task 7: Interface

**Files:**
- Modify: `src/ui/screens/MatchScreen.tsx` (libellés, marqueur de blessure)
- Modify: `src/ui/screens/SetupScreen.tsx` (case « élimination directe »)
- Modify: `src/App.tsx` (état `knockout`, passage au moteur)
- Modify: `src/ui/screens/PostMatchScreen.tsx` (filtre d'événements)

**Interfaces:**
- Consomme : `isBreak`, `isExtraTime` (tâche 1), `knockout` (tâche 2), `LivePlayer.injury` (tâche 4)
- Produit : rien

- [ ] **Step 1: Libellé de minute et de pause**

Dans `src/ui/screens/MatchScreen.tsx`, remplacer le calcul de `minuteLabel` :

```ts
  const minute = Math.floor((st.tick * 0.1) / 60)
  // 90+n en fin de temps réglementaire, puis 91-105 / 105+n / 106-120 en
  // prolongation : la minute brute suffit, seuls les dépassements se nomment
  const regulationEnd = 90
  const extraFirstEnd = 105
  const minuteLabel = isExtraTime(st.phase)
    ? minute > extraFirstEnd && st.phase === 'extra_first_half'
      ? `105+${minute - extraFirstEnd}'`
      : `${minute}'`
    : minute >= regulationEnd
      ? `90+${minute - regulationEnd}'`
      : `${minute}'`

  const breakLabel =
    st.phase === 'halftime' ? 'MT' : st.phase === 'break_before_extra' ? 'Fin 90’' : 'MT prol.'
  const resumeLabel =
    st.phase === 'halftime'
      ? '▶ Coup d’envoi de la seconde période'
      : st.phase === 'break_before_extra'
        ? '▶ Coup d’envoi de la prolongation'
        : '▶ Seconde période de la prolongation'
```

Utiliser `breakLabel` à la place du `'MT'` littéral (ligne ~110) et
`resumeLabel` à la place du texte du bouton de reprise (ligne ~136).

- [ ] **Step 2: Marqueur de blessure et remplacement d'un blessé**

Dans la liste d'endurance, la ligne qui exclut les joueurs hors terrain
(`if (!lp.onPitch && lp.sentOff) return null`) laisse déjà passer le blessé
sorti. Ajouter le marqueur dans le nom :

```ts
                    <span className="st-name" title={p.name}>
                      {lp.injury === 'out' ? '🚑 ' : lp.injury === 'knock' ? '🤕 ' : ''}
                      {p.position} {p.name.split(' ').slice(-1)[0]}
                    </span>
```

Le bouton de remplacement est déjà piloté par `canSub`, donc il reste actif
sur un blessé sorti — rien à changer là.

- [ ] **Step 3: Option élimination directe**

Dans `src/App.tsx`, ajouter l'état et le passer au moteur :

```ts
  const [knockout, setKnockout] = useState(false)
```

Ajouter `knockout,` aux deux appels `new MatchEngine({ ... })`, à côté de
`autoSubSides`. Passer `knockout` et `onToggleKnockout={setKnockout}` au
`SetupScreen`.

Dans `src/ui/screens/SetupScreen.tsx`, étendre `Props` :

```ts
  knockout: boolean
  onToggleKnockout: (v: boolean) => void
```

et ajouter la case dans `setup-actions` :

```tsx
        <label className="muted small">
          <input type="checkbox" checked={knockout} onChange={(e) => onToggleKnockout(e.target.checked)} />{' '}
          Élimination directe (prolongation si nul)
        </label>
```

- [ ] **Step 4: Filtre d'événements**

Dans `src/ui/screens/PostMatchScreen.tsx:24`, ajouter `'injury'` à la liste.

- [ ] **Step 5: Vérifier la compilation et le rendu**

Run: `npx tsc --noEmit && npm run build`
Expected: build propre.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat : interface prolongation et blessures"
```

---

### Task 8: Vérification d'ensemble et ROADMAP

**Files:**
- Modify: `ROADMAP.md`

- [ ] **Step 1: Suite complète**

Run: `npx vitest run` (arrière-plan, ~3,5 min)
Expected: tous les tests verts.

- [ ] **Step 2: Bench**

Run: `npm run sim -- 30 --check`
Expected: 8/8 bornes vertes, et les matchs mesurés font toujours 90 minutes.

- [ ] **Step 3: Mettre à jour la ROADMAP**

Cocher le chantier **Blessures** (ligne ~81) en y portant les taux mesurés.
Ajouter une ligne sur la prolongation et le 6e changement à côté du chantier
des remplacements. Mentionner la limite assumée : pas de séance de tirs au
but, donc un match à élimination directe peut finir sur un nul.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs : ROADMAP blessures et prolongation"
```
