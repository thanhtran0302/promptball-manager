# Blessures et prolongation — design

*27 août 2026 — branche `feat/remplacements-5-3`*

Deux chantiers liés par le même quota de remplacements, posé la veille
(5 joueurs, 3 fenêtres, mi-temps hors quota) :

- **Prolongation** avec le 6e changement et la 4e fenêtre.
- **Blessures**, version légère : deux gravités, remplacement forcé.

Le lien n'est pas cosmétique. Une blessure sans remplacement disponible fait
jouer à dix ; le sixième changement n'existe qu'en prolongation. Les deux
chantiers lisent et modifient les mêmes compteurs.

## Cycle de match

### Phases

`tick()` sort déjà tôt sur `halftime` : une pause est donc, dans ce moteur,
« une phase qui gèle la simulation jusqu'à un appel explicite ». La
prolongation réutilise ce mécanisme plutôt que d'en introduire un autre.

```ts
export type MatchPhase =
  | 'first_half' | 'halftime' | 'second_half'
  | 'break_before_extra' | 'extra_first_half' | 'extra_halftime' | 'extra_second_half'
  | 'finished'

export const isBreak = (p: MatchPhase): boolean =>
  p === 'halftime' || p === 'break_before_extra' || p === 'extra_halftime'

export const isExtraTime = (p: MatchPhase): boolean =>
  p === 'break_before_extra' || p === 'extra_first_half' ||
  p === 'extra_halftime' || p === 'extra_second_half'
```

L'alternative écartée était une phase générique `break` doublée d'un compteur
`period`. Elle raccourcit l'union mais oblige chaque site à lire deux champs
pour savoir où il en est, et fait perdre son sens à `'halftime'`, que la
douzaine de sites existants teste nommément.

Les sites en `phase === 'halftime'` deviennent `isBreak(phase)`. La
transformation est mécanique : `controller.ts` (boucle et `resume`),
`MatchScreen.tsx`, `autoSub.ts`, `sim.ts` (`tick`, `makeSub`), les tests et le
bench.

`startSecondHalf()` devient `startNextPeriod()` — six sites d'appel.

### Bornes de temps

`EXTRA_HALF_TICKS = 9_000` (15 minutes à 10 Hz).

`MatchState.periodEndTick` porte le tick de fin de la période en cours et est
posé à chaque transition. Sans lui, chaque tick de prolongation devrait
recalculer le temps additionnel de la seconde mi-temps pour retrouver son
origine.

Les périodes de prolongation n'ont pas de temps additionnel propre :
`addedTimeSec` reste la seule valeur tirée, et elle ne concerne que la
seconde mi-temps. C'est une simplification assumée, pas un oubli.

### Déclencheur

`MatchOptions.knockout?: boolean`, faux par défaut.

À `periodEndTick` de la seconde mi-temps : si `knockout` et
`score.home === score.away`, la phase passe à `break_before_extra` ; sinon à
`finished`. Une case « élimination directe » au `SetupScreen` porte l'option
côté interface.

Le sim-bench garde `knockout` à faux. Sinon les huit bornes du Pilier A se
mesureraient sur des matchs de 120 minutes, ce qui les rendrait
incomparables à toute mesure antérieure.

**Limite connue et acceptée** : sans séance de tirs au but, un match à
élimination directe peut se terminer sur un nul après 120 minutes. Le moteur
le journalise explicitement plutôt que de le masquer.

## Quotas en prolongation

Les compteurs (`subsUsed`, `subWindows`, `lastSubTick`) ne changent pas. Seuls
les plafonds deviennent fonction de la phase :

```ts
private maxSubs()       { return isExtraTime(this.state.phase) ? MAX_SUBS + 1 : MAX_SUBS }
private maxSubWindows() { return isExtraTime(this.state.phase) ? MAX_SUB_WINDOWS + 1 : MAX_SUB_WINDOWS }
```

Six joueurs et quatre fenêtres en prolongation. `isExtraTime` inclut
`break_before_extra` : l'IFAB ouvre la substitution supplémentaire dès la
coupure précédant la prolongation, pas au coup d'envoi de celle-ci.

`opensSubWindow` teste `isBreak(phase)` au lieu de `phase === 'halftime'` :
les trois pauses — mi-temps, coupure avant prolongation, mi-temps de
prolongation — ne consomment aucune fenêtre.

## Blessures

### État

```ts
/** 'knock' = diminué mais en jeu ; 'out' = a dû quitter le terrain */
injury: 'none' | 'knock' | 'out'
```

**`knock`** — le joueur reste sur le terrain, dégradé sur deux axes, dans la
boucle de déplacement : vitesse maximale multipliée par `INJURY_SPEED_MUL`
(~0,85) et endurance effective multipliée par `INJURY_ENDURANCE_MUL` (~0,8)
avant l'appel à `updateStamina`. Il ralentit et se vide plus vite, donc le
coach automatique le sortira de lui-même au prochain rendez-vous : aucune
règle dédiée n'est nécessaire pour ça.

**`out`** — le joueur quitte immédiatement le terrain. `onPitch` passe à faux,
le poste reste dans `lineup` pour ne pas casser l'assignation des slots. C'est
exactement la machinerie de `sendOff`, avec une autre cause. L'équipe joue à
dix tant que personne ne remplace.

### Correction requise dans `makeSub`

`makeSub` refuse aujourd'hui un sortant qui n'est pas sur le terrain. Le
blessé sorti l'est précisément. La garde devient :

```ts
if (!out || (!out.onPitch && out.injury !== 'out')) return { ok: false, error: ... }
```

L'exclu reste refusé : lui n'est pas remplaçable.

### Risque

| Source | Accroche | Modulation |
|---|---|---|
| Contact | faute sifflée sur tacle (`sim.ts:1524`) | agressivité du tacleur ; risque nettement plus faible sur tacle propre |
| Musculaire | tick de sprint (`sim.ts:1682`) | fraîcheur : négligeable au-dessus de 70, fort en dessous de 40 |

La gravité est un tirage séparé du déclenchement, pour que le taux de sorties
et le taux de touchés se calibrent indépendamment.

**Cibles**, tirées des études d'exposition UEFA (~8 blessures pour 1000 heures
de match, soit ~0,26 sortie par match) :

- **0,25 à 0,45 sortie sur blessure par match**, toutes équipes confondues
- **0,8 à 1,6 touchés par match**

Les constantes sont calibrées par mesure, et les valeurs obtenues consignées
dans le commentaire qui les porte — comme les seuils du coach automatique.

### Remplacement forcé

Côté auto-coaché : remplacement immédiat au moment de la blessure, hors
rendez-vous, via `makeSub`. Une blessure consomme un joueur et une fenêtre —
le règlement ne prévoit aucune exemption. Quota épuisé ou banc vide :
l'équipe finit à dix, avec un log explicite.

Côté humain : un événement `'injury'` est journalisé et le joueur apparaît
sorti dans la liste d'endurance. La décision lui revient, y compris celle de
finir à dix.

`'injury'` s'ajoute à `MatchEventType` et au filtre de
`PostMatchScreen.tsx:24`.

## Interface

- Libellé de minute étendu : 91-105 en première période de prolongation,
  `105+n` en temps additionnel, 106-120 en seconde.
- Libellé de pause propre à chaque coupure, à la place du `MT` unique.
- Bouton de reprise piloté par `isBreak`.
- Marqueur de blessure dans la liste d'endurance ; le bouton de remplacement
  reste actif sur un blessé sorti.
- Case « élimination directe » au `SetupScreen`.

## Vérifications

Tests moteur :

- prolongation déclenchée seulement si `knockout` et score nul à 90'
- match à élimination directe non nul à 90' : `finished`, pas de prolongation
- 6e changement refusé à 90', accepté en prolongation
- 4e fenêtre refusée à 90', acceptée en prolongation
- les trois pauses ne consomment aucune fenêtre
- blessé sorti remplaçable ; exclu non remplaçable
- équipe à dix quand le quota est épuisé au moment d'une blessure
- taux de blessures dans les bornes annoncées, mesuré sur N matchs

Plus `npm run sim -- 30 --check` vert, et toujours mesuré sur 90 minutes.
