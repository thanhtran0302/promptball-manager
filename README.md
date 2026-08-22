# ⚽ Prompt Foot Manager

Un Football Manager où **toutes les tactiques passent par du prompting** : formation, mentalité,
instructions individuelles, remplacements — tout se dit en langage naturel, avant le match
et pendant (pause tactique).

Le LLM ne simule **jamais** le jeu : il traduit vos prompts en instructions JSON structurées.
Un moteur de simulation déterministe (TypeScript pur, RNG seedée) exécute ensuite le match
minute par minute, rendu en vue 2D façon FM.

Vos joueurs obéissent toujours — mais leurs attributs (vitesse, endurance, technique…)
décident de ce qu'ils peuvent *réellement* faire. Demandez à un latéral de monter le couloir
à chaque occasion : il le fera, et il s'effondrera vers la 55e si son endurance est de 64.
Vous prévoir, voir venir, et adapter : c'est ça, le jeu.

## Lancer

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # tests du moteur (déterminisme, plausibilité, règles)
npm run sim 20     # calibration : simule 20 matchs et imprime les stats moyennes
npm run sim -- 30 --sweep   # un dial tactique à la fois vs neutre
npm run sim -- 30 --check   # confronte les mesures aux bornes du Pilier A (sortie != 0 si franchies)
npm run build      # build production
```

## Le LLM (optionnel mais recommandé)

Réglages → choisissez un fournisseur compatible OpenAI :

| Preset | Base URL | Modèle par défaut |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| Grok (xAI) | `https://api.x.ai/v1` | `grok-3-mini` |
| OpenRouter | `https://openrouter.ai/api/v1` | n'importe quel `provider/modele` |
| Personnalisé | tout endpoint `/v1` | — |

La clé reste dans le localStorage du navigateur (OK pour un MVP ; prévoir un proxy backend
pour une version publique). **Sans clé, le jeu est entièrement jouable** : traduction par
mots-clés (mode démo) + éditeur manuel.

La traduction LLM produit le même JSON zod-validé que l'éditeur manuel — c'est le contrat
unique entre prompting et moteur :

```json
{
  "team": { "formation": "4-3-3", "mentality": "offensif", "pressing": "haut", "tempo": "rapide", "width": "normal", "defensiveLine": "moyenne" },
  "players": [{ "playerId": "h2", "instruction": "overlap", "intensity": "elevee" }],
  "substitutions": [{ "outPlayerId": "h2", "inPlayerId": "h15" }],
  "lineup": ["h1", "h2", "h3", "h4", "h5", "h6", "h7", "h8", "h9", "h10", "h11"]
}
```

La **composition** se règle sur un terrain interactif (écran tactique) : un clic sur un
poste ouvre la liste de l'effectif, choisir un titulaire l'échange de poste, choisir un
banculaire le fait entrer. Le champ `lineup` (11 ids, gardien en tête) fait partie du
contrat — on peut donc aussi demander « fais jouer Fontaine à la place de Zerhouni » au
prompt ; en cours de match, un changement de titulaires passe par les règles de
remplacement (3 max, comptés).

## Architecture

```
src/
  engine/          # moteur 100% pur et déterministe (aucune dépendance DOM)
    types.ts       # joueur, équipes, instructions, état de match
    rng.ts         # RNG seedée (mulberry32) — même seed = même match
    formations.ts  # positions de base par formation + assignment des rôles
    instructions.ts# schéma zod (le contrat) + tables d'effets tactiques
    stamina.ts     # réservoir d'endurance, drains par action, malus
    sim.ts         # boucle 10 Hz : positions, possession, événements, notes
  data/teams.ts    # 2 équipes fictives de 16 joueurs (technique vs physique)
  game/controller.ts # horloge temps réel → ticks, vitesses ×1-×8, IA adverse
  llm/             # client OpenAI-compatible, traduction+validation, coach, mock
  ui/              # écrans React + vue match Canvas 2D (interpolation 60 fps)
scripts/sim.ts     # calibration statistique
```

### Modèle de simulation (résumé)

- Terrain 105×68 m, tick de 0,1 s ; 90 min ≈ 54 000 ticks (rapide à simuler).
- Position cible d'un joueur = position de base formation + glissement du bloc (balle lissée,
  avec inertie) + offsets d'instruction (overlap, stay_back, cut_inside, man_mark, free_role)
  + bruit ; vitesse de déplacement = f(vitesse, fraîcheur).
- Le porteur décide toutes les 1,4-3,6 s (selon tempo) : tir / dribble / passe courte ou
  longue, pondéré par attributs, pression adverse et instructions.
- Tacles, fautes, cartons, corners, arrêts : probabilités par tick issues du marquage et du pressing.
- xG simplifié : `0.42·exp(-d/7.5)·angle`, modulé par tir vs gardien.
- Endurance : drains (déplacement, pressing, tempo, instructions) × profile du joueur ;
  malus de vitesse/technique sous 40 % puis 20 %, avec alertes dans le fil du match.
- Calibration visée (vérifiable via `npm run sim`) : ~1-3 buts/match, 10-15 tirs/équipe,
  possession 45-60 %, endurance finale ~70 % en instructions neutres, ~25 % en pressing
  haut + tempo rapide.

### L'IA adverse

Coach à règles fixes : à la 60e et 75e minute, si elle mène de 2 buts elle gère (mentalité -1),
si elle perd elle accélère (mentalité +1, pressing +1). Le reste du temps, elle joue son plan.

## Ce qui est volontairement hors MVP

Saison/championnat, transferts, entraînements, hors-jeu, blessures, ralenti vidéo, 3D.
Pistes suivantes : championnat simple, sauvegarde de partie, tactiques adverses variées
par match, commentateur LLM des temps forts.
