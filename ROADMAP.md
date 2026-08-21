# 🗺️ ROADMAP — De Prompt Foot Manager vers le niveau Football Manager

> Objectif : rapprocher le moteur et le jeu au maximum de la profondeur de **Football Manager**,
> en gardant notre identité : **un football manager qui se pilote au prompt**.
> Ce document est le contrat de route du projet. Chaque phase a des livrables et des
> critères mesurables (`npm run sim` / sim-bench) pour savoir où on en est.

**Principes non négociables** (à préserver dans toutes les contributions) :

1. **Le LLM n'est jamais le moteur** : il traduit du langage naturel en instructions
   JSON validées (schéma zod). La simulation est du code déterministe, seedée.
2. **Déterminisme** : même seed + mêmes instructions = même match (testé en CI).
3. **Un dial tactique = un point du moteur** + mesure au sim-bench avant fusion.
4. **Le jeu reste jouable sans clé LLM** (mode démo + éditeur manuel).

---

## 📍 Où on en est (v0.3 — « le moteur respire »)

- ✅ Moteur de match 10 Hz déterministe : 22 agents, positions 2D continues, blocs,
  pressing sur le porteur, transitions lissées
- ✅ Micro-décisions façon FM (« slices » tous les 0,3 s, 11 comportements)
- ✅ Règles : buts, hors-jeu géométrique, fautes, jaunes/2e jaune/rouges (équipe à 10),
  penalties, corners, touches, six mètres, arbitre avec personnalité, temps additionnel
- ✅ Physique : gestion de l'effort (marche/course/sprint), zone morte, interceptions
  sur ligne de passe, courses au ballon « homing »
- ✅ 16 attributs joueur (dont 4 mentaux), endurance avec malus, notes individuelles
- ✅ Prompting avant-match et en pause tactique (OpenAI / Grok / OpenRouter), coach
  assistant, mode démo par mots-clés, éditeur manuel
- ✅ Composition sur terrain cliquable, vue match 2D annotée, stats live, post-match
- ✅ Outils : sim-bench `--phase-sweep`, 16 tests, calibration continue
- 📊 Calibration actuelle : 2,6 buts/match, 84 % de passes, 15 touches, 7 corners,
  ~16,5 km/joueur (cible 10-12), ~0,2 rouge, ~0,3 penalty

---

## Phase 0 — Fondations open source 🌱 *(courte, à faire tôt)*

Objectif : que n'importe qui puisse cloner, comprendre, contribuer et vérifier.

- [ ] `CONTRIBUTING.md` : setup, conventions, processus de revue
- [ ] **CI GitHub Actions** : `tsc` + tests + build + smoke calibration (`npm run sim -- 5`)
      avec bornes de plausibilité automatisées (buts 2-4, passes 78-88 %…)
- [ ] Templates d'issues : `bug`, `gameplay/calibration`, `feature` + labels par zone
      (`engine`, `llm`, `ui`, `data`, `docs`)
- [ ] Liste **good first issue** balisée (voir « Contribuer » ci-dessous)
- [ ] Documentation d'architecture (`docs/ARCHITECTURE.md`) : espaces de coordonnées,
      boucle de tick, contrat d'instructions, slices
- [ ] i18n FR/EN (toutes les chaînes passent par `labels.ts` ou équivalent)
- [ ] Versionner les constantes de calibration (`MatchConfig` centralisée) + registre
      des valeurs avec leur justification

## Phase 1 — Réalisme du moteur de match ⚽ *(le cœur, la plus longue)*

Chaque item doit passer le sim-bench sans casser les bornes existantes.

### 1.1 Jeu aérien
- [ ] Axe z du ballon (trajectoires, rebonds, déviations)
- [ ] Attributs *détente* et *jeu de tête* ; duels aériens sur centres et longs ballons
- [ ] Vrais centres (choix premier/deuxième poteau, centre en retrait) — débloque
      enfin la tactique « deux attaquants + centres »
- [ ] Critère : centres tentés/match 15-25, tête = 20-30 % des buts (réel)

### 1.2 Rôles par poste × devoirs (le plus grand saut tactique)
- [ ] 4-6 rôles par ligne (sentinelle, relayeur, meneur reculé, piston, piston inversé,
      ailier inversé, faux 9, buteur de surface, défenseur-relanceur, libéro…)
- [ ] Chaque rôle = un jeu de pondérations de slices + cibles de position
- [ ] **Devoirs** à la FM (défensif / support / offensif) sur chaque rôle →
      5 rôles × 3 devoirs par poste = des dizaines de combinaisons par ligne
- [ ] Intégré au contrat d'instructions (promptable : « Delcourt en meneur reculé,
      Ferreira sentinelle avec devoir défensif »)
- [ ] Éditeur de rôle sur le terrain de composition

### 1.3 Phases arrêtées jouées
- [ ] Corner : routines (premier/deuxième poteau, court, long au point de penalty),
      marquages zone/homme dans la surface, timing de course
- [ ] Coup franc : mur à 9,15 m, tir direct avec tireur désigné, centre travaillé
- [ ] Touche travaillée (dégagement long / remise courte)
- [ ] 6 mètres : choix de relance (court / long / large) selon pressing adverse
- [ ] Critère : 25-35 % des buts sur phase arrêtée (réel)

### 1.4 Intelligence individuelle
- [ ] Décisions secondaires du porteur (option de repli si solution primaire marquée)
- [ ] Traits de joueurs (PPM : tir de loin, une-deux, appels dans le dos…) calculés
      depuis les attributs, modulables par le prompting
- [ ] Pied fort/faible (passes et tirs dégradés du mauvais pied)
- [ ] Vision réelle : les options hors du cône de vision du porteur sont ignorées

### 1.5 Arbitrage complet
- [ ] Avantage joué (pas de sifflet si l'attaque continue)
- [ ] Temps additionnel calculé sur les vrais arrêts (buts, changes, blessures)
- [ ] VAR optionnel (revue des buts/penalties, ton « drama »)
- [ ] Critère : temps morts réels ~30 % du temps de match

### 1.6 Condition, blessures, forme
- [ ] Distinction condition / fraîcheur / forme (courbes inter-matchs)
- [ ] Blessures : risque par action, gravité, remplacement forcé
- [ ] Suspensions (cumul de jaunes sur la saison, rouges)
- [ ] Fatigue cumulative sur la saison → rotation d'effectif obligatoire

### 1.7 Calibration physique fine
- [ ] 16,5 → 10-12 km/joueur (possessions plus longues, temps morts réels)
- [ ] Profils de distance par poste (latéraux > 11 km, DC ~9,5, BU ~10)
- [ ] Sprint < 10 % du temps de course (détectable : ratio vitesse/effort)

### 1.8 Vocabulaire tactique étendu 🎨 *(la créativité)*
Objectif : que deux prompts tactiques différents produisent **deux matchs visiblement
et statistiquement différents**. Tout passe par le contrat d'instructions (promptable).

**Instructions d'équipe :**
- [ ] Déclencheur de pressing (camp propre / milieu / camp adverse)
- [ ] **Contre-pressing immédiat** (règle des 5 s après perte) vs repli en bloc
- [ ] **Piège au hors-jeu** (la ligne monte d'un bloc sur le passe)
- [ ] Surcharge d'un côté (overload) + inversion de jeu
- [ ] Gestion du temps de fin de match (time-wasting)
- [ ] Hauteur/largeur/tempo différents en construction vs phase finale

**Instructions individuelles (~20 au total) :**
- [ ] Appel en profondeur, une-deux, plus/moins de dribbles, passes risquées
- [ ] Rester haut (défenseur), décrocher dans l'axe (ailier)
- [ ] Marquage au départ du jeu, fermer le pied fort de l'adversaire
- [ ] « Ne tire pas » / « tire de loin » pour les profiles spécialisés
- [ ] Instructions **contre un adversaire précis** (fermer Diallo côté droit…)

**Critère d'acceptation (l'empreinte tactique)** : au sim-bench, chaque style présumé
distinct doit produire une empreinte statistique distincte sur au moins 3 colonnes
(ex. tiki-taka : possession 62 %+ et passes courtes ; route one : 60 %+ de longues
balles et duels aériens ; gegenpress : récupérations dans le camp adverse).

### 1.9 Formations libres et asymétriques
- [ ] Éditeur de positions libres : glisser chaque poste où on veut sur le terrain
- [ ] Formations asymétriques (4-2-3-1 penché, 3-2-4-1, milieu en losange)
- [ ] Garder la compatibilité avec le contrat `lineup` et les rôles
- [ ] Bibliothèque communautaire de formations (import/export JSON)

### 1.10 Plans de match et automatismes 🤖
- [ ] **Plans de match multi-étapes** : « début prudent ; si mené à la 60', passe en
      4-2-4 ; si rouge reçu, 5-4-0 » — promptables et éditables avant match
- [ ] Déclencheurs : score, minute, carton, fatigue d'un joueur, adversaire qui change
- [ ] L'IA adverse a aussi des plans (coach avec répertoire de scénarios)
- [ ] Vérification pré-match du plan (le coach LLM avertit des incohérences)

### 1.11 Styles présets (bibliothèque promptable)
- [ ] 8-10 styles historiques comme points de départ modifiables : tiki-taka,
      gegenpressing, catenaccio, bus parking + contres, route one, jeu sur les ailes,
      total football, pressing tout-terrain
- [ ] Chaque préset = un jeu complet d'instructions + rôles suggérés
- [ ] Promptable en une phrase (« joue en gegenpressing comme Liverpool ») puis
      affinable (« mais avec Lambert qui reste en couverture »)

## Phase 2 — Saison & compétitions 🏆

- [ ] Générateur de championnat : 2 divisions de 18 équipes fictives, joueurs générés
      (noms, âges, attributs corrélés aux postes, potentiels cachés)
- [ ] Calendrier aller-retour, classement, forme glissante sur 5 matchs
- [ ] **Moteur instantané** : réutiliser le moteur complet en batch pour les matchs
      IA-vs-IA (objectif < 300 ms/match) avec les mêmes règles
- [ ] Fatigue/suspension persistantes entre les matchs → l'IA fait tourner son effectif
- [ ] Coupe à élimination directe (prolongations + tirs au but)
- [ ] IA de coach riche : répertoires tacticaux par profil d'équipe, adaptations
      mi-temps et 60/75/85', time-wasting en fin de match, park-the-bus
- [ ] Transferts simples entre saisons (IA) ; marché d'hiver
- [ ] Critère : une saison complète se joue ; l'IA termine avec des effectifs plausibles

## Phase 3 — Le métier de manager 💼

- [ ] **Transferts** : estimation, négociation (promptable !), contrats, salaires,
      budget, clauses ; besoins des IA concurrentes réalistes
- [ ] **Entraînement** : plans individuels par attribut, développement selon âge/potentiel,
      vieillissement, retraite, académie et jeunes
- [ ] **Staff** : adjoint (synthèses), recruteurs (rapports flous selon niveau),
      préparateur physique (baisse des blessures) — chacun avec effet mécanique réel
- [ ] **Scouting** : découverte progressive, connaissance partielle des attributs adverses
- [ ] **Moral & dynamique** : temps de jeu, résultats, vestiaire, pressions —
      influence directe sur les attributs effectifs en match
- [ ] Critère : chaque système a un effet mesurable au sim-bench (ex. bon préparateur
      = -20 % de blessures)

## Phase 4 — Analyses & immersion 📊

- [ ] **Mode temps forts** (façon FM) : saut automatique entre fenêtres d'action,
      réglable (intégral / étendu / clés) — la vraie réponse au rythme de visionnage
- [ ] Post-match : heatmap, carte de passes, chronologie xG, duels aériens
- [ ] Data hub ligue : buteurs, passeurs, notes moyennes, historiques
- [ ] Vue 2D améliorée (ombres portées, sens des regards, traînées de courses)
- [ ] Vue 3D optionnelle (three.js — seulement quand le 2D sera complet)
- [ ] Commentateur LLM des temps forts (optionnel, activable)
- [ ] Ambiance sonore (foule, sifflet) — optionnelle

## Phase 5 — Le prompting poussé à fond 🎙️ *(notre différenciateur)*

- [ ] Assistant coach conversationnel avec mémoire (contexte du club, des matchs,
      des joueurs) — discuter tactique comme avec un vrai adjoint
- [ ] **Plans de match** : voir 1.10 — la couche conversationnelle au-dessus des
      automatismes (« propose-moi un plan pour battre le bloc bas de demain »)
- [ ] Négociations par prompting (transferts, contrats, salaires)
- [ ] Conférences de presse et entretiens individuels (effet sur le moral)
- [ ] Requêtes en langage naturel sur les données : « montre-moi l'xG de Delcourt
      sur les 5 derniers matchs »
- [ ] Mode voix (STT/TTS) optionnel

## Phase 6 — Écosystème & multi 💜

- [ ] Backend optionnel (persistance cloud, comptes, saisons partagées)
- [ ] Multijoueur hot-seat (2+ joueurs humains, IA pour le reste)
- [ ] Éditeur d'équipes/ligues + import CSV + partage de bases de données
- [ ] Support mods (noms de fichiers de données, règles de ligue configurables)
- [ ] PWA / mobile

---

## 🤝 Contribuer (le projet est open source)

Le chemin est long : chaque phase a besoin de bras. Zones d'ownership :

| Zone | Contenu | Niveau |
|---|---|---|
| `engine/` | simulation, physique, règles | avancé (déterminisme + calibration exigés) |
| `llm/` | prompting, traduction, coach | intermédiaire |
| `ui/` | écrans, vue match, éditeur de compo | intermédiaire |
| `data/` | équipes, générateurs de joueurs/noms | **débutant friendly** |
| `scripts/` | sim-bench, outils de calibration | **débutant friendly** |
| `docs/` | architecture, guides, i18n | **débutant friendly** |

**Good first issues** (idées concrètes) : générateur de noms de joueurs par nationalité,
5e équipe fictive avec un style original, statistique « distance par poste » dans le
sim-bench, annotations terrain à étendre (touche, corner), thème clair du UI,
traduction EN, README bilingue.

**Règles d'or d'une PR gameplay** :
1. `tsc` + tests verts ;
2. `npm run sim -- 30` : aucune borne existante cassée (buts 2-4, passes 78-88 %…) ;
3. si un dial tactique change : `--phase-sweep` avant/après dans la description de PR ;
4. tout nouveau comportement joueur passe par les slices (jamais de hack de position) ;
5. toute nouvelle instruction passe par le schéma zod (contrat LLM/éditeur/moteur).

---

## Jalons versions

| Version | Contenu | Statut |
|---|---|---|
| v0.1 | MVP : match sandbox, prompting, vue 2D | ✅ |
| v0.2 | Réalisme : pressing, transitions, hors-jeu, lisibilité | ✅ |
| v0.3 | Slices FM, discipline complète, physique d'effort | ✅ |
| v0.4 | Phase 0 + jeu aérien (1.1) + rôles & devoirs (1.2) | ⬜ |
| v0.5 | Vocabulaire tactique étendu + formations libres + plans de match (1.8-1.11) | ⬜ |
| v0.6 | Phases arrêtées + intelligence individuelle (1.3-1.4) | ⬜ |
| v0.7 | Championnat + moteur instantané (Phase 2 cœur) | ⬜ |
| v0.8 | Transferts, entraînement, staff (Phase 3 cœur) | ⬜ |
| v0.9 | Analyses + mode temps forts | ⬜ |
| v1.0 | Prompting avancé + une saison complète, jouable, stable, documentée | ⬜ |

*Les estimations sont volontairement en jalons de contenu, pas en semaines : c'est un
projet open source, le rythme est celui des contributeurs.*
