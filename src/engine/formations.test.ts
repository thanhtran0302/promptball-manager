// Invariants de FORMATION_SLOTS. Le compilateur garantit qu'une formation
// déclarée dans FORMATIONS a une entrée ici — il ne garantit pas qu'elle
// aligne onze joueurs ni un seul gardien. Une coquille dans les coordonnées
// passerait sinon jusqu'en simulation.

import { describe, expect, it } from 'vitest'
import { FORMATION_SLOTS, assignSlots } from './formations'
import { FORMATIONS } from './types'
import { TEAMS } from '../data/teams'
import { mockTranslate } from '../llm/mock'
import { defaultInstructions } from './instructions'

describe('FORMATION_SLOTS', () => {
  it.each(FORMATIONS)('%s aligne onze joueurs dont un gardien', (f) => {
    const slots = FORMATION_SLOTS[f]
    expect(slots).toHaveLength(11)
    expect(slots.filter((s) => s.role === 'GK')).toHaveLength(1)
  })

  it.each(FORMATIONS)('%s tient dans les limites du terrain', (f) => {
    for (const s of FORMATION_SLOTS[f]) {
      expect(s.x).toBeGreaterThan(0)
      expect(s.x).toBeLessThan(1)
      expect(s.y).toBeGreaterThan(0)
      expect(s.y).toBeLessThan(1)
    }
  })

  it.each(FORMATIONS)('%s place le gardien devant sa propre ligne', (f) => {
    const gk = FORMATION_SLOTS[f].find((s) => s.role === 'GK')!
    expect(gk.x).toBeLessThan(0.12)
  })

  it.each(FORMATIONS)('%s est assignable depuis un groupe de 16', (f) => {
    const ids = assignSlots(TEAMS[0].players, f)
    expect(ids).toHaveLength(11)
    expect(new Set(ids).size).toBe(11) // aucun joueur sur deux postes
  })

  it('le nom du poste correspond au rôle', () => {
    const byRole: Record<string, string[]> = {
      GK: ['G'],
      DF: ['DG', 'DC', 'DD'],
      MD: ['MDC', 'MC', 'MG', 'MD'],
      AT: ['AG', 'AD', 'BU'],
    }
    for (const f of FORMATIONS) {
      for (const s of FORMATION_SLOTS[f]) {
        expect(byRole[s.role], `${f} / ${s.label}`).toContain(s.label)
      }
    }
  })
})

describe('reconnaissance des formations par le traducteur mock', () => {
  // mock.ts dérive sa liste de FORMATIONS : ce test garde le fait qu'ajouter
  // une formation la rend effectivement pilotable au prompt, et qu'aucun nom
  // n'en capte un autre par sous-chaîne.
  it.each(FORMATIONS)('« passe en %s » est compris', (f) => {
    const out = mockTranslate(`passe en ${f}`, TEAMS[0], TEAMS[1], defaultInstructions())
    expect(out.team.formation).toBe(f)
  })
})
