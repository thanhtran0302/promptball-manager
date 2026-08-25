// Invariants de FORMATION_SLOTS. Le compilateur garantit qu'une formation
// déclarée dans FORMATIONS a une entrée ici — il ne garantit pas qu'elle
// aligne onze joueurs ni un seul gardien. Une coquille dans les coordonnées
// passerait sinon jusqu'en simulation.

import { describe, expect, it } from 'vitest'
import { FORMATION_SLOTS, assignSlots } from './formations'
import { FORMATIONS } from './types'
import type { Player, Role } from './types'
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

describe('assignSlots respecte le poste, pas seulement le rôle', () => {
  // Le score d'assignation ne lisait que `role` (GK/DF/MD/AT) et départageait
  // à `technique + pace` : un latéral rapide passait donc devant un défenseur
  // central pour un slot DC, et un ailier devant un avant-centre pour un slot
  // BU. `Slot.label` porte pourtant le poste exact, dans le même vocabulaire
  // que `Player.position`.
  const mk = (id: string, role: Role, position: string, tech: number, pace: number): Player => ({
    id,
    name: id,
    role,
    position,
    attributes: {
      pace, stamina: 60, technique: tech, passing: 60, shooting: 60, tackling: 60,
      agility: 60, goalkeeper: 40, decisions: 60, vision: 60, composure: 60, aggression: 60,
    },
  })

  it('place chaque joueur à son poste quand le groupe couvre la formation', () => {
    // Les joueurs de couloir sont les plus techniques et les plus rapides :
    // sous l'ancien score, ce sont eux qui raflaient les postes axiaux.
    const squad: Player[] = [
      mk('g', 'GK', 'G', 40, 40),
      mk('dg', 'DF', 'DG', 95, 95),
      mk('dc1', 'DF', 'DC', 50, 50),
      mk('dc2', 'DF', 'DC', 45, 45),
      mk('dd', 'DF', 'DD', 90, 90),
      mk('mg', 'MD', 'MG', 95, 95),
      mk('mc1', 'MD', 'MC', 50, 50),
      mk('mc2', 'MD', 'MC', 45, 45),
      mk('md', 'MD', 'MD', 90, 90),
      mk('bu1', 'AT', 'BU', 50, 50),
      mk('bu2', 'AT', 'BU', 45, 45),
    ]
    const ids = assignSlots(squad, '4-4-2')
    const posOf = new Map(squad.map((p) => [p.id, p.position]))
    FORMATION_SLOTS['4-4-2'].forEach((slot, i) => {
      expect(posOf.get(ids[i]), `slot ${i} (${slot.label})`).toBe(slot.label)
    })
  })

  it("ne laisse pas un slot servi tôt prendre le joueur d'un slot servi tard", () => {
    // 4-4-2 sert MG, MC, MC puis MD. Le seul MD du groupe est aussi le plus
    // fort au départage : servi en un seul passage, il partait au slot MC et
    // le couloir droit héritait d'un axial.
    const squad: Player[] = [
      mk('g', 'GK', 'G', 40, 40),
      ...['a', 'b', 'c', 'd'].map((s) => mk(`df${s}`, 'DF', 'DC', 50, 50)),
      mk('mg', 'MD', 'MG', 40, 40),
      mk('mc1', 'MD', 'MC', 40, 40),
      mk('mdc', 'MD', 'MDC', 40, 40),
      mk('md', 'MD', 'MD', 99, 99),
      ...['a', 'b'].map((s) => mk(`at${s}`, 'AT', 'BU', 50, 50)),
    ]
    const ids = assignSlots(squad, '4-4-2')
    const slots = FORMATION_SLOTS['4-4-2']
    expect(ids[slots.findIndex((s) => s.label === 'MD')]).toBe('md')
    expect(ids[slots.findIndex((s) => s.label === 'MG')]).toBe('mg')
  })

  it('garde le rôle prioritaire sur le poste', () => {
    // Un milieu étiqueté « DC » ne doit pas prendre la charnière à un vrai
    // défenseur : le bonus de poste se départage à l'intérieur d'un rôle, il
    // ne franchit pas les rôles.
    const squad: Player[] = [
      mk('g', 'GK', 'G', 40, 40),
      mk('imposteur', 'MD', 'DC', 99, 99),
      ...['a', 'b', 'c', 'd'].map((s) => mk(`df${s}`, 'DF', 'DD', 50, 50)),
      ...['a', 'b', 'c'].map((s) => mk(`md${s}`, 'MD', 'MC', 50, 50)),
      ...['a', 'b', 'c'].map((s) => mk(`at${s}`, 'AT', 'BU', 50, 50)),
    ]
    const ids = assignSlots(squad, '4-4-2')
    const dcSlots = FORMATION_SLOTS['4-4-2']
      .map((s, i) => (s.label === 'DC' ? i : -1))
      .filter((i) => i >= 0)
    for (const i of dcSlots) expect(ids[i]).not.toBe('imposteur')
  })
})
