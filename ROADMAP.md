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
- ✅ Règles : hors-jeu géométrique, fautes, jaunes/rouges, penalties, corners,
  touches, six mètres, arbitre avec personnalité
- ✅ 16 attributs joueur (dont 4 mentaux), endurance, notes individuelles
- ✅ Prompting avant-match + pause tactique (OpenAI / Grok / OpenRouter), coach,
  mode démo, éditeur manuel, composition sur terrain cliquable
- ✅ Vue 2D annotée, stats live, post-match, sim-bench `--sweep` / `--check`, 19 tests
- 📊 Calibration : 2,6 buts/match, 84 % de passes, 15 touches, 7 corners,
  16,5 km/joueur (cible 10-12), ~0,2 rouge, ~0,3 penalty

---

# 🫀 LE CŒUR — six piliers, un seul niveau d'exigence : excellent

Chaque pilier a une définition mesurable de « excellent ». Un pilier est **certifié**
quand tous ses critères sont verts au sim-bench / en tests.

## Pilier A — Simulation ultra réaliste 🎯

Le moteur doit ressembler à du football, pas à une approximation.

| Critère « excellent » | Cible mesurable |
|---|---|
| Buts / match | 2,5 – 3,0 |
| Tirs / équipe | 11 – 15, cadrés 35 – 42 % |
| Passes réussies | 82 – 86 % |
| Distance / joueur | 9 – 12 km (profils par poste) |
| Sprint / temps de course | < 10 % |
| Temps morts (sorties, arrêts) | ~30 % du temps |
| Buts sur phase arrêtée | 25 – 35 % |

Chantiers :
- [ ] **Jeu aérien** : axe z du ballon (trajectoires, rebonds), attributs *détente*
      et *jeu de tête*, duels aériens, vrais centres (premier/deuxième poteau, retrait)
- [ ] **Phases arrêtées jouées** : routines de corner, murs à 9,15 m, coups francs
      directs avec tireur, touches et relances travaillées
- [ ] **Arbitrage complet** : avantage joué, temps additionnel sur arrêts réels
- [ ] **Possessions réalistes** : chaînes plus longues, temps morts, 16,5 → 10-12 km
- [ ] **Décisions secondaires du porteur** (option de repli si solution marquée)
- [ ] **Blessures** (risque par action, gravité, remplacement forcé) — version légère,
      pas le système médical complet (déverrouillé)
- [ ] Mode **temps forts** (intégral / étendu / clés) — le rythme de visionnage FM

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
      — déclencheurs score/minute/carton/fatigue, IA adverse avec ses propres plans
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
      récupérations, pertes de balle, pressing subi/exercé, km, sprints, touches
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
| v0.5 | Pilier A-1 : jeu aérien + calibration physique (10-12 km) | ⬜ |
| v0.6 | Pilier B-1 + C-1 : rôles & devoirs, instructions étendues | ⬜ |
| v0.7 | Pilier A-2 : phases arrêtées + arbitrage complet | ⬜ |
| v0.8 | Pilier B-2 + C-2 : formations libres, plans de match, présets, PPM | ⬜ |
| v0.9 | Pilier F : prompting avant/pendant/après + golden tests | ⬜ |
| v1.0 | **Cœur certifié** — les six piliers « excellent » | ⬜ |
| v1.1+ | Déverrouillage : saisons, management, écosystème | 🔒 |

*Jalons en contenu, pas en semaines : rythme open source.*
