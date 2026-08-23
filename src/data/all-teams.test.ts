// ALL_TEAMS alimente l'interface depuis deux sources possibles — les clubs
// réels si la collecte a été lancée, les équipes fictives sinon. Ces tests
// valent dans les deux cas : ils gardent le contrat dont l'UI dépend, sans
// présumer laquelle des deux sources est active.

import { describe, expect, it } from 'vitest'
import { ALL_TEAMS, USING_REAL_TEAMS } from './allTeams'
import { TEAMS } from './teams'

describe('ALL_TEAMS', () => {
  it('propose au moins deux équipes', () => {
    // App.tsx choisit un adversaire différent de l'équipe du joueur.
    expect(ALL_TEAMS.length).toBeGreaterThanOrEqual(2)
  })

  it('aligne des groupes de 16 joueurs', () => {
    for (const t of ALL_TEAMS) {
      expect(t.players, t.name).toHaveLength(16)
    }
  })

  it('donne un gardien à chaque équipe', () => {
    for (const t of ALL_TEAMS) {
      expect(t.players.filter((p) => p.role === 'GK').length, t.name).toBeGreaterThanOrEqual(1)
    }
  })

  it('garde des identifiants uniques', () => {
    const ids = ALL_TEAMS.flatMap((t) => t.players.map((p) => p.id))
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(ALL_TEAMS.map((t) => t.id)).size).toBe(ALL_TEAMS.length)
  })

  it('retombe sur les équipes fictives sans fichier généré', () => {
    if (!USING_REAL_TEAMS) expect(ALL_TEAMS).toBe(TEAMS)
    else expect(ALL_TEAMS.length).toBeGreaterThan(TEAMS.length)
  })
})
