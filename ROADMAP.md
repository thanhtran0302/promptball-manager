# 🗺️ ROADMAP — Prompt Foot Manager

> Un football manager qui se pilote au prompt. Cette roadmap suit une règle unique :
> **le cœur d'abord, et il doit être excellent** — tactiques, prompting, simulation,
> joueurs. Tout le reste (saisons, transferts, management, club) est **verrouillé**
> jusqu'à ce que le cœur soit certifié.

**Principes non négociables** (à préserver dans toutes les contributions) :

1. **Le LLM n'est jamais le moteur** : il traduit du langage naturel en instructions
   JSON validées (schéma zod). La simulation est du code déterministe, seedée.
2. **Déterminisme** : même seed + mêmes instructions = même match (testé en CI).
3. **Un dial tactique = un point du moteur** + mesure au sim-bench avant fusion.
4. **Le jeu reste jouable sans clé LLM** (mode démo + éditeur manuel).
5. **Règle du cœur** : aucune contribution aux phases déverrouillées tant que les six
   piliers du cœur ne sont pas au niveau « excellent » défini ci-dessous.

---

## 📍 Où on en est (v0.3)

- ✅ Moteur 10 Hz déterministe : 22 agents, slices de micro-décision (0,3 s),
  pressing sur le porteur, transitions lissées, gestion de l'effort
- ✅ Règles : hors-jeu géométrique, fautes (y compris sur tacle manqué), jaunes/rouges,
  penalties, corners, touches, six mètres, contres de tir, arbitre avec personnalité
- ✅ 16 attributs joueur (dont 4 mentaux), endurance, notes individuelles (barème `RATING`
  regroupé et pondéré sur ce qui décide le match)
- ✅ Compositions par poste réel (`assignSlots` lit `Player.position`, pas seulement le rôle)
- ✅ Prompting avant-match + pause tactique (OpenAI / Grok / OpenRouter), coach,
  mode démo, éditeur manuel, composition sur terrain cliquable
- ✅ Vue 2D annotée, stats live, post-match, sim-bench `--sweep` / `--check`, 124 tests
- ✅ **Les sept critères mesurables du Pilier A sont verts** — `KNOWN_BREACHES` est vide
- 📊 Calibration (30 matchs, neutre) : 2,6 buts/match, 85,9 % de passes, 26 touches,
  10,0 corners, 11,0 km/joueur, 19,3 fautes, 3,1 jaunes, 0,33 rouge, 0,23 penalty,
  33 % de temps morts, 3,9 hors-jeu

---

# 🫀 LE CŒUR — six piliers, un seul niveau d'exigence : excellent

Chaque pilier a une définition mesurable de « excellent ». Un pilier est **certifié**
quand tous ses critères sont verts au sim-bench / en tests.

## Pilier A — Simulation ultra réaliste 🎯

Le moteur doit ressembler à du football, pas à une approximation.

| Critère « excellent » | Cible mesurable | Mesuré (30 matchs) |
|---|---|---|
| Buts / match | 2,5 – 3,0 | ✅ 2,6 |
| Tirs / équipe | 11 – 15, cadrés 35 – 42 % | ✅ 11,5 · 35,7 % |
| Passes réussies | 82 – 86 % | ✅ 85,9 % |
| Distance / joueur | 9 – 12 km (profils par poste) | ✅ 11,0 (G 5,9 · D 9,7 · M 13,1 · A 9,2) |
| Sprint / temps de course | < 10 % | ✅ 6,4 % |
| Temps morts (sorties, arrêts) | ~30 % du temps | ✅ 33,2 % |
| Buts sur phase arrêtée | 25 – 35 % | ✅ 30,8 % |

Les sept critères sont verts au `--check` — qui en imprime huit lignes, séparant tirs et
tirs cadrés — et `KNOWN_BREACHES` est vide. Le pilier n'est pas certifié pour autant : ce
tableau mesure le **rendu statistique**, pas la richesse du jeu. Le jeu aérien et les
phases arrêtées jouées manquent toujours, et trois des bornes ci-dessus demandent d'être
revues contre les données réelles (chantier plus bas).

Chantiers :
- [ ] **Jeu aérien** : axe z du ballon (trajectoires, rebonds), attributs *détente*
      et *jeu de tête*, duels aériens, vrais centres (premier/deuxième poteau, retrait)
- [ ] **Phases arrêtées jouées** : routines de corner, murs à 9,15 m, coups francs
      directs avec tireur, touches et relances travaillées
- [ ] **Arbitrage complet** : avantage joué, temps additionnel calculé sur les arrêts
      réels (aujourd'hui tiré au hasard entre 30 s et 3 min, sans lien avec le jeu)
      — les fautes, cartons et penalties sont eux au bon niveau
- [x] **Possessions réalistes** : temps morts 19 → 33 %, 18,0 → 11,0 km/joueur (la note
      d'origine de ce chantier disait 16,5, mesure d'une version antérieure), effort
      qui dépend de la distance à couvrir, joueurs qui marchent ballon mort
- [ ] **Tirs contrés sous-calibrés** : 12 % des tirs contre ~28 % en vrai. Élargir la
      portée du contreur y amène mais pénalise les équipes faibles, dont les tirs partent
      de plus loin — il faut faire dépendre le contre de la qualité de la position de frappe
- [ ] **Touches sous la cible** : 26 par match contre ~40. Bloqué par la borne de temps
      morts (voir le chantier des bornes) : plus de sorties = moins de jeu effectif
- [ ] **Décisions secondaires du porteur** (option de repli si solution marquée)
- [ ] **Blessures** (risque par action, gravité, remplacement forcé) — version légère,
      pas le système médical complet (déverrouillé)
- [ ] Mode **temps forts** (intégral / étendu / clés) — le rythme de visionnage FM

**Chantiers de méthode** (le bench lui-même) :
- [ ] **Revoir trois bornes contre le réel.** Elles sont aujourd'hui incompatibles entre
      elles ou avec le football réel : plancher `Tirs cadrés` à 35 % quand Opta mesure
      ~34 % (le viser force le taux d'arrêt du gardien 3 points au-dessus du réel) ;
      plafond `Temps morts` à 35 % quand un vrai match est à ~43 % (ce qui interdit les
      40 touches) ; fenêtre `Buts / match` large de 0,5 quand l'erreur d'échantillonnage
      à N=30 est de ±0,33, donc la mesure bat
- [ ] **Référence de bench neutre.** `--check` mesure sur les deux équipes fictives, qui
      tournent à 68 de technique et 67 de décisions quand la Ligue 3 réelle est à 51 et
      57 — alors que les formules du moteur s'ancrent sur 50 = joueur moyen. Un moteur
      vert au bench a longtemps produit 1,5 but/match sur de vrais clubs sans que rien ne
      le signale. Deux pistes : ramener les fictives au niveau d'ancrage, ou faire entrer
      un effectif au profil réel dans le `--check`

## Pilier B — Tactique d'équipe, stratégie & compositions 🧠

Deux tactiques différentes = deux matchs visiblement différents.

| Critère « excellent » | Cible mesurable |
|---|---|
| Empreinte tactique | chaque style distinct diffère sur ≥ 3 colonnes du sim-bench |
| Combinatoire | ≥ 100 configurations d'équipe réellement distinctes (rôles × devoirs × instructions) |
| Compo | éditeur de positions libres, formations asymétriques |

Chantiers :
- [ ] **Rôles par poste × devoirs** (défensif / support / offensif) : 4-6 rôles par
      ligne, chacun = pondérations de slices + cibles de position
- [ ] **Vocabulaire d'équipe étendu** : déclencheur de pressing (zone), contre-pressing
      immédiat (règle des 5 s), piège au hors-jeu, overloads, time-wasting, réglages
      construction vs phase finale
- [ ] **Formations libres et asymétriques** : glisser-déposer des postes, losange,
      3-2-4-1, import/export JSON
- [ ] **Plans de match multi-étapes** : « si mené à la 60', 4-2-4 ; si rouge, 5-4-0 »
      — déclencheurs score/minute/carton/fatigue, IA adverse avec ses propres plans.
      Devenu urgent : la fatigue mord désormais (fraîcheur ~70 en fin de match, jusqu'à
      60 pour les plus sollicités) et **aucun remplacement n'est jamais effectué** côté
      IA — zéro sur vingt matchs. Le plafond est aussi resté à 3 remplacements, contre 5
      au règlement moderne
- [ ] **Styles présets** : 8-10 styles historiques (tiki-taka, gegenpress, catenaccio,
      route one, bus + contres…) promptables en une phrase, affinables ensuite

## Pilier C — Tactique individuelle par joueur et par poste 🎮

Chaque joueur doit pouvoir recevoir sa propre mission.

| Critère « excellent » | Cible mesurable |
|---|---|
| Instructions individuelles | ≥ 20, chacune avec un effet mesurable au sim-bench |
| Contre-instructions | ciblage d'un adversaire précis (pied faible, côté à fermer) |
| Effet visible | chaque instruction modifie le comportement à l'écran |

Chantiers :
- [ ] Instructions étendues : appel en profondeur, une-deux, plus/moins de dribbles,
      passes risquées, rester haut, décrocher dans l'axe, marquage au départ…
- [ ] **Traits de joueurs (PPM)** calculés depuis les attributs (tir de loin,
      une-deux, appels dans le dos) — et modulables par prompting
- [ ] Pied fort / faible (passes et tirs dégradés du mauvais pied)
- [ ] Instructions contre un adversaire précis
- [ ] Éditeur individuel intégré au terrain de compo (clic joueur → mission)

## Pilier D — Caractéristiques des joueurs 📇

Des joueurs qui existent vraiment : chaque attribut doit peser.

| Critère « excellent » | Cible mesurable |
|---|---|
| Utilité des attributs | chaque attribut intervient dans ≥ 2 résolutions du moteur (registre documenté) |
| Profils distincts | un joueur lent-technique et un joueur rapide-brutal produisent des matchs différents |
| Écart de niveau | une équipe à +10 d'attribut moyen gagne ~2 fois sur 3 |

Chantiers :
- [ ] Registre documenté « attribut → points du moteur » (docs + tests par attribut)
- [ ] Ajustements du modèle : attributs qui manquent (détente, jeu de tête pour A ;
      concentration ?) et suppression de ceux qui ne servent à rien
- [ ] **Forme** (courbe courte inter-matchs, sans saison complète : historique de session)
- [ ] Corrélation attributs ↔ traits (Pilier C) et ↔ style de jeu
- [ ] Générateur de joueurs fictifs (noms, profils, écarts de niveau) pour enrichir
      les données au-delà des 2 équipes

## Pilier E — Stats des joueurs 📊

Tout ce qui se passe doit être mesuré, par joueur.

| Critère « excellent» | Cible mesurable |
|---|---|
| Couverture | chaque événement moteur a une statistique par joueur associée |
| Stats avancées | xG/passe décisive attendue (xA), récupérations, pressing (PPDA-like), duels |
| Lecture | écran joueur : fiche match, tendance sur session, comparaison |

Chantiers :
- [ ] Instrumentation complète : xG par tir, xA par passe, duels (au sol/aériens),
      récupérations, pertes de balle, pressing subi/exercé, km, sprints, touches.
      Fait depuis : arrêts du gardien (`PlayerStats.saves` était déclaré et incrémenté
      nulle part), km et sprints par joueur. Reste ouvert : les interceptions confondent
      encore passe coupée et récupération de ballon perdu, deux gestes différents
- [ ] Collecte de données pour heatmap et carte de passes (post-match)
- [ ] Écran joueur dédié (fiche + historique de session + comparaisons)
- [ ] Intégration sim-bench : stats de sortie par poste pour valider les profils
- [ ] Agrégats multi-matchs (session) — socle du futur historique de saison

## Pilier F — Prompting ultra qualité, avant / pendant / après 🎙️

C'est l'identité du jeu : parler au jeu comme à un staff réel.

| Critère « excellent » | Cible mesurable |
|---|---|
| Traduction | ≥ 95 % de prompts tactiques types correctement traduits (jeu de tests golden) |
| Latence | réponse du staff < 4 s au P95 |
| Robustesse | zéro crash LLM : toujours validation + retry + fallback démontré |
| Couverture | prompting utile aux 3 moments : avant, pendant, après |

Chantiers :
- [ ] **Avant** : conversation tactique multi-tours avec mémoire du club, plans de
      match, styles présets, attribution des rôles et missions en langage naturel
- [ ] **Pendant** : pause tactique riche (état du match résumé au LLM), suggestions
      contextuelles (« ils surchargent à gauche → ferme Diallo »), instructions
      conditionnelles
- [ ] **Après** : debrief conversationnel appuyé sur les stats du Pilier E
      (« pourquoi on a perdu », « qui a fatigué », « quoi changer la prochaine fois »)
- [ ] **Golden tests** de traduction : corpus de prompts français → JSON attendu,
      exécuté en CI (mode démo + replay LLM enregistré)
- [ ] Le coach LLM voit les stats live et raisonne dessus (pas du texte générique)

---

## 🔒 Déverrouillé seulement quand le cœur est certifié

Ces phases sont **gelées** tant que les six piliers ne sont pas « excellent ».
Elles restent décrites pour mémoire, sans ouvrir de chantier.

- 🏆 **Saison & compétitions** : championnat, calendrier, classement, moteur
  instantané IA-vs-IA, fatigue/suspensions persistantes, coupes, IA de coach riche
- 💼 **Métier de manager** : transferts, contrats, entraînement, staff, scouting,
  moral & dynamique de vestiaire
- 📈 **Analyses étendues** : data hub ligue, 3D optionnelle, commentateur
- 💜 **Écosystème** : backend, multi, éditeur de ligue, mods, mobile

*(Le détail complet de ces phases est dans l'historique git du fichier —
elles seront réintégrées au moment du déverrouillage.)*

---

## 🤝 Contribuer (le projet est open source)

Le cœur offre déjà des chantiers isolés et mesurables — le format idéal pour contribuer.

| Zone | Contenu | Niveau |
|---|---|---|
| `engine/` | simulation, physique, règles | avancé (déterminisme + calibration exigés) |
| `engine/slices.ts` | comportements et tactique | avancé |
| `llm/` | prompting, traduction, coach, golden tests | intermédiaire |
| `ui/` | écrans, vue match, éditeur de compo | intermédiaire |
| `data/` | équipes, générateurs de joueurs/noms | **débutant friendly** |
| `scripts/` | sim-bench, outils de calibration, stats | **débutant friendly** |
| `docs/` | architecture, registre des attributs, guides | **débutant friendly** |

**Good first issues** : générateur de noms par nationalité, 3e équipe fictive avec
style original, colonne « distance par poste » dans le sim-bench, registre des
attributs (doc), golden prompts pour le corpus F, thème clair, traduction EN.

**Règles d'or d'une PR** :
1. `tsc` + tests verts ;
2. `npm run sim -- 30 --check` : aucune borne du cœur cassée (sortie non nulle sinon) ;
3. dial tactique modifié → `--sweep` avant/après dans la PR ;
4. tout comportement joueur passe par les slices ;
5. toute instruction passe par le schéma zod (contrat LLM/éditeur/moteur).

---

## Jalons

| Version | Contenu | Statut |
|---|---|---|
| v0.1 | MVP : match sandbox, prompting, vue 2D | ✅ |
| v0.2 | Réalisme : pressing, transitions, hors-jeu, lisibilité | ✅ |
| v0.3 | Slices FM, discipline complète, physique d'effort | ✅ |
| v0.4 | Pilier D (attributs + registre) + Pilier E (stats joueurs) | ⬜ |
| v0.5 | Pilier A-1 : jeu aérien + calibration physique (10-12 km) | 🟡 calibration faite (11,0 km) |
| v0.6 | Pilier B-1 + C-1 : rôles & devoirs, instructions étendues | ⬜ |
| v0.7 | Pilier A-2 : phases arrêtées + arbitrage complet | 🟡 fautes et cartons au niveau |
| v0.8 | Pilier B-2 + C-2 : formations libres, plans de match, présets, PPM | ⬜ |
| v0.9 | Pilier F : prompting avant/pendant/après + golden tests | ⬜ |
| v1.0 | **Cœur certifié** — les six piliers « excellent » | ⬜ |
| v1.1+ | Déverrouillage : saisons, management, écosystème | 🔒 |

*Jalons en contenu, pas en semaines : rythme open source.*
