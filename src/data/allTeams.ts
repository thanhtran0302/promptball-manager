/// <reference types="vite/client" />

// Source d'équipes de l'interface : les 17 clubs réels de Ligue 3 si le
// fichier a été généré (`npm run fetch:national`), sinon les deux équipes
// fictives de teams.ts.
//
// national.generated.json est gitignoré : un import statique casserait le
// build de quiconque n'a pas lancé la collecte. import.meta.glob est résolu
// par Vite à la compilation et rend un objet vide quand le motif ne
// correspond à aucun fichier — c'est la façon prévue de dépendre d'un fichier
// facultatif sans le rendre obligatoire.
//
// teams.ts reste inchangé et continue d'alimenter le moteur et les tests, qui
// ont besoin d'équipes stables et présentes en toutes circonstances.

import type { Team } from '../engine/types'
import { TEAMS } from './teams'

const generated = import.meta.glob<{ default: Team[] }>('./national.generated.json', {
  eager: true,
})

const real = Object.values(generated)[0]?.default

/** Vrai quand l'interface tourne sur les effectifs réels. */
export const USING_REAL_TEAMS = Array.isArray(real) && real.length > 0

export const ALL_TEAMS: Team[] = USING_REAL_TEAMS ? (real as Team[]) : TEAMS
