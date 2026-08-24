# Perception & conscience du terrain — proposition de conception

> Objectif : donner à chaque joueur une **perception subjective** du jeu — ses coéquipiers,
> la géographie du terrain, la disponibilité de chaque partenaire, la notion de partenaire
> libre — au lieu de la connaissance divine de l'état complet qu'ils ont aujourd'hui.
>
> Statut : proposition issue de la recherche (voir sources en bas), pas encore implémentée.

## L'état actuel et sa limite

Le porteur choisit ses passes en évaluant tous les candidats avec une pression brute
(`pressureOn` : adversaires dans un rayon de 3,5 m du receveur). Il « sait » tout :
positions des 21 autres joueurs, hors de tout champ de vision, sans notion d'espace
contrôlé ni de ligne de passe dégagée. Conséquence : des passes vers des partenaires
marqués, pas de jeu sur le partenaire libre, pas d'appels dans l'espace.

## Les trois briques (issues de la recherche)

### Brique 1 — Registre d'équipe et vision (conscience des coéquipiers)

Ce que la recherche fait : les agents RoboCup 2D perçoivent le monde via un **cône de
vision** bruité — un agent ne voit que ce qui est devant lui ; le reste est déduit ou
ignoré. C'est le mécanisme qui rend les passes « humaines » : on ne passe pas à ce
qu'on ne voit pas.

Notre adaptation :

- **Cône de vision du porteur** : direction = but attaqué (mélangé à sa direction de
  course), demi-angle de base ~75°, élargi par l'attribut `vision` (55° à 100°),
  portée ~35 m.
- Un partenaire **hors cône** : poids de passe ×0,15 (conscience périphérique — le
  bruit du jeu, les appels — mais pas une option privilégiée).
- **Occlusion légère** : un adversaire à moins de 1,2 m de la ligne de vue la bloque
  (réutilisation symétrique de `pickLineInterceptor`, qui projette déjà sur les segments).
- `decisions` bas → le filtre est *bruité* : un mauvais décideur « lit mal » et peut
  ignorer un partenaire libre visible (poids aléatoire réduit, RNG seedée).

### Brique 2 — Champ de contrôle du terrain (conscience géographique)

Ce que la recherche fait : le modèle **pitch control** de Spearman (« Beyond Expected
Goals », 2018) calcule, pour chaque point du terrain, la probabilité que chaque équipe
y contrôle le ballon, en comparant les **temps d'interception** (temps pour atteindre le
point, fonction distance / vitesse max + retard de réaction). C'est aujourd'hui l'outil
standard des clubs pros pour mesurer l'espace et les structures.

Notre adaptation (simplifiée, déterministe, pas de données de tracking) :

- Grille de **15 × 10 cellules** (7 m), recalculée tous les 3 ticks.
- Pour chaque cellule et chaque joueur : `t = distance / vmax` (notre `maxSpeed`
  intègre déjà pace + fraîcheur) + retard de réaction fixe 0,3 s.
- Contrôle de la cellule pour une équipe : sigmoïde sur l'écart des meilleurs temps
  des deux camps — formule inspirée de Spearman :
  `control(cell) = σ((t_adverse_min − t_nôtre_min) / τ)`, τ ≈ 0,6 s.
- Sorties : `controlHome[]` / `controlAway[]` (Float32Array de 150).

Coût : 150 cellules × 22 joueurs ≈ 3 300 opérations tous les 3 ticks — négligeable.

### Brique 3 — Score de liberté du partenaire (disponibilité, partenaire libre)

Ce que la recherche fait : l'évaluation de passe RoboCup (CYRUS, WrightEagle…) combine
trois signaux — **ouverture du coéquipier** (distance à son marqueur), **lisibilité de
la ligne de passe** (adversaires proches de la trajectoire), **temps d'interception**
(en faveur du receveur ou du défenseur). C'est la définition opérationnelle du
« partenaire libre ».

Notre adaptation — pour chaque joueur de l'équipe en possession, calculé chaque tick
et stocké sur le `LivePlayer` :

```
liberté = 0,35 · lisibilitéLigne      // distance minimale des adversaires au segment porteur→partenaire
        + 0,30 · espaceAutour         // distance au plus proche adversaire, plafonnée à 8 m
        + 0,20 · avantageTemps        // (d_adversaire/v_adversaire − d_partenaire/v_partenaire) vers le point de réception
        + 0,15 · contrôleZone         // brique 2 : contrôle de mon équipe dans la cellule du partenaire
        − pénalités                   // hors-jeu imminent, trop loin (> 45 m), dos au jeu
```

Score 0..1 ; **« libre » = liberté > 0,7**.

## Intégration au moteur

1. **Choix de passe** (`decide()`) : le poids de chaque candidat remplace `openness`
   brut par `liberté` (filtrée par le cône de vision de la brique 1). Le jeu cherche
   naturellement l'homme libre.
2. **Comportements hors-ballon** (slices) : `run_in_behind` et `come_short` ciblent les
   cellules à haut contrôle + progression (brique 2) ; nouveau comportement
   `find_space` — se démarquer dans l'espace le plus libre à portée de passe.
3. **Appel de balle** : partenaire avec liberté > 0,8 non servi depuis ~3 s → événement
   « X demande le ballon » (ticker +未来的 annotation), et le LLM en pause tactique en
   est informé.
4. **Contrat d'instructions** : « joue sur le partenaire libre » devient une vraie
   instruction (biaise les poids vers liberté) ; les rôles (v0.6) l'affinent.
5. **Stats (Pilier E)** : % de passes vers partenaire libre, cartes de contrôle moyen
   du terrain — mesurables au sim-bench.

## Garde-fous

- **Déterminisme** : tout est fonction pure de l'état (grilles et scores recalculés,
  pas de caches inter-ticks non seedés).
- **Calibration** : la réussite des passes va monter (vers l'homme libre) → compenser
  la base de probabilité et re-vérifier toutes les bornes au sim-bench.
- **Perf** : négligeable (voir coûts ci-dessus) ; la grille peut aussi alimenter plus
  tard les heatmaps du Pilier E.

## Plan d'implémentation proposé

| Phase | Contenu | Effet visible |
|---|---|---|
| 1 | Score de liberté + cône de vision dans `decide()` | les passes cherchent l'homme libre ; le porteur ignore ce qu'il ne voit pas |
| 2 | Grille de contrôle + `find_space` dans les slices | appels dans les espaces contrôlés ; structure d'équipe lisible |
| 3 | Bruit de lecture (`decisions`), appels de balle, exposition LLM/stats | le mauvais décideur loupe l'homme libre ; « demande le ballon » au ticker |

## Sources

- William Spearman, *Beyond Expected Goals* (2018) — modèle pitch control probabiliste,
  temps d'interception : [PDF ResearchGate](https://www.researchgate.net/publication/327139841_Beyond_Expected_Goals)
- A History of Pitch Control — [Get Goalside Analytics](https://www.getgoalsideanalytics.com/everything-you-need-to-know-about-pitch-control/)
- Implémentation pédagogique (formule TTI complète, `tti_sigma`) —
  [Tony ElHabr](https://tonyelhabr.rbind.io/posts/soccer-pitch-control-r/) ;
  variante motion model — [SFU](https://www.sfu.ca/~tswartz/papers/pitch_control.pdf) ;
  formalisation — [arXiv 2501.05870](https://arxiv.org/html/2501.05870v1)
- Évaluation de passe RoboCup 2D (ouverture + ligne + interception) :
  CYRUS, champions 2021 — [arXiv 2401.03410](https://arxiv.org/html/2401.03410v1) ;
  introduction SS2D — [WrightEagle](https://wrighteagle2d.github.io/robocup/0_related/Khashabi-An_Introduction_to_RoboCup_and_Soccer_Simulation_2D.pdf)
- Décision de passe pro (interception + EPV) —
  [arXiv 2605.25696](https://arxiv.org/html/2605.25696) ;
  Dick & Uematsu (2022) — [EconStor](https://www.econstor.eu/bitstream/10419/310999/1/s10182-022-00435-x.pdf)
