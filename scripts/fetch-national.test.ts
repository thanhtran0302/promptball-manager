// Le mapping FMInside -> moteur est vérifié sur deux fiches réelles relevées
// sur le site (SM Caen, base FM26 26.2.0) : un milieu défensif et un gardien.
// Les attendus sont calculés à la main depuis les pondérations.

import { describe, expect, it } from 'vitest'
import type { Player, Role } from '../src/engine/types'
import {
  mapAttributes,
  mapPosition,
  selectSquad,
  shortCode,
  squadViolations,
} from './fetch-national'

/** Yann M'Vila, DM, SM Caen — relevé intégral de la fiche. */
const MVILA = {
  Crossing: 50, Dribbling: 50, Finishing: 35, 'First Touch': 65, Heading: 60,
  'Long Shots': 55, Marking: 70, Passing: 75, Tackling: 70, Technique: 65,
  Aggression: 75, Anticipation: 65, Bravery: 75, Composure: 75, Concentration: 65,
  Decisions: 60, Determination: 75, Flair: 45, Leadership: 70, 'Off the Ball': 50,
  Positioning: 65, Teamwork: 85, Vision: 60, 'Work Rate': 75,
  Acceleration: 45, Agility: 45, Balance: 70, 'Jumping Reach': 55,
  'Natural Fitness': 70, Pace: 55, Stamina: 60, Strength: 70,
}

/** Anthony Mandréa, GK, SM Caen — bloc Goalkeeping + Mental de la fiche. */
const MANDREA = {
  'Aerial Reach': 55, 'Command of Area': 50, Communication: 55, Eccentricity: 40,
  'First Touch': 40, Handling: 55, Kicking: 55, 'One on Ones': 60, Passing: 45,
  'Punching (Tendency)': 55, Reflexes: 70, 'Rushing Out (Tendency)': 50, Throwing: 60,
  Aggression: 60, Anticipation: 70, Bravery: 75, Composure: 55, Concentration: 40,
  Decisions: 75, Determination: 30, Flair: 15, Leadership: 50, 'Off the Ball': 5,
  Positioning: 50, Teamwork: 55, Vision: 50, 'Work Rate': 50,
}

describe('mapAttributes', () => {
  it('compose un joueur de champ depuis sa fiche', () => {
    const a = mapAttributes(MVILA, 'MD')
    expect(a.pace).toBe(51) // 0.6*55 + 0.4*45
    expect(a.stamina).toBe(63) // 0.75*60 + 0.25*70
    expect(a.technique).toBe(60) // (65 + 65 + 50) / 3
    expect(a.passing).toBe(75)
    expect(a.shooting).toBe(40) // 0.75*35 + 0.25*55
    expect(a.tackling).toBe(69) // 0.5*70 + 0.25*70 + 0.25*65
    expect(a.agility).toBe(55) // 0.6*45 + 0.4*70
    expect(a.composure).toBe(72) // 0.7*75 + 0.3*65
    expect(a.aggression).toBe(75) // 0.6*75 + 0.4*75
  })

  it("retombe sur la valeur par défaut quand aucune source n'est présente", () => {
    // Un joueur de champ n'a aucun attribut de gardien sur sa fiche.
    expect(mapAttributes(MVILA, 'MD').goalkeeper).toBe(15)
  })

  it('renormalise sur les poids présents', () => {
    // La fiche de gardien n'a ni Technique ni Dribbling : seul First Touch
    // subsiste dans le composite, qui vaut donc exactement First Touch.
    expect(mapAttributes(MANDREA, 'GK').technique).toBe(40)
  })

  it('compose les attributs de gardien, offset d\'échelle compris', () => {
    // 0.4*70 + 0.3*55 + 0.3*60 = 62.5, moins l'offset de famille (-10).
    expect(mapAttributes(MANDREA, 'GK').goalkeeper).toBe(53)
  })

  it("n'applique pas l'offset à une valeur de repli", () => {
    // Un joueur de champ n'a aucun attribut de gardien : le repli vaut 15 et
    // n'a pas d'échelle FM à corriger. Sans cette garde il tomberait à 5.
    expect(mapAttributes(MVILA, 'MD').goalkeeper).toBe(15)
  })

  it('réaligne le rapport tireur / gardien sur celui du moteur', () => {
    // Le moteur calcule conv = 0.26 + (shooting - goalkeeper) / 150 et a été
    // calibré sur les équipes fictives, où ce rapport est positif. Sur les
    // échelles FM brutes il s'inverse, et la formule décroche alors même
    // qu'elle est relative.
    const gk = mapAttributes(MANDREA, 'GK').goalkeeper
    const shooter = mapAttributes({ ...MVILA, Finishing: 55, 'Long Shots': 55 }, 'AT').shooting
    expect(shooter - gk).toBeGreaterThan(0)
  })

  it('neutralise les attributs de champ hérités du bloc mental du gardien', () => {
    // Sans cette correction, `tackling` se renormaliserait sur la seule
    // Anticipation (70) : un gardien meilleur tacleur que M'Vila.
    expect(mapAttributes(MANDREA, 'GK').tackling).toBe(38)
    expect(mapAttributes(MANDREA, 'GK').shooting).toBe(22)
  })
})

describe('mapPosition', () => {
  it('retient le premier poste reconnu', () => {
    expect(mapPosition(['DM', 'MC'])).toEqual({ role: 'MD', position: 'MDC' })
    expect(mapPosition(['GK'])).toEqual({ role: 'GK', position: 'G' })
    expect(mapPosition(['AML', 'ST'])).toEqual({ role: 'AT', position: 'AG' })
    expect(mapPosition(['WBR'])).toEqual({ role: 'DF', position: 'DD' })
  })

  it('ignore un poste inconnu au profit du suivant', () => {
    expect(mapPosition(['SW', 'DC'])).toEqual({ role: 'DF', position: 'DC' })
  })

  it('rend null plutôt que de deviner', () => {
    expect(mapPosition([])).toBeNull()
    expect(mapPosition(['???'])).toBeNull()
  })
})

describe('shortCode', () => {
  it('ignore les préfixes de club', () => {
    expect(shortCode('SM Caen')).toBe('CAE')
    expect(shortCode('FC Rouen')).toBe('ROU')
    expect(shortCode('Stade Briochin')).toBe('BRI')
    expect(shortCode('Bourg en Bresse')).toBe('BOU')
    expect(shortCode('Le Puy Foot 43')).toBe('PUY')
  })
})

describe('squadViolations', () => {
  const mk = (role: Role, i: number): Player => ({
    id: `p${i}`,
    name: `J${i}`,
    role,
    position: 'MC',
    attributes: mapAttributes(MVILA, role),
  })
  const squad = (counts: Record<Role, number>): Player[] => {
    const out: Player[] = []
    for (const [role, n] of Object.entries(counts) as [Role, number][]) {
      for (let i = 0; i < n; i++) out.push(mk(role, out.length))
    }
    return out
  }

  it('accepte un groupe couvrant les cinq formations', () => {
    expect(squadViolations(squad({ GK: 2, DF: 5, MD: 5, AT: 4 }))).toEqual([])
  })

  it('signale une ligne trop courte', () => {
    const v = squadViolations(squad({ GK: 1, DF: 5, MD: 6, AT: 4 }))
    expect(v).toHaveLength(1)
    expect(v[0]).toContain('GK')
  })

  it('signale un effectif de taille incorrecte', () => {
    expect(squadViolations(squad({ GK: 2, DF: 5, MD: 5, AT: 3 }))[0]).toContain('15 joueurs')
  })
})

describe('selectSquad', () => {
  const mk = (role: Role, i: number): Player => ({
    id: `p${i}`,
    name: `${role}${i}`,
    role,
    position: 'MC',
    attributes: mapAttributes(MVILA, role),
  })
  /** Pool trié par qualité décroissante, gardiens en dernier. */
  const pool = (counts: [Role, number][]): Player[] => {
    const out: Player[] = []
    for (const [role, n] of counts) for (let i = 0; i < n; i++) out.push(mk(role, out.length))
    return out
  }

  it('sert les quotas avant le mérite', () => {
    // Configuration réelle en D3 : les gardiens ferment le classement. C'est
    // elle qui laissait Orléans sans aucun gardien.
    const squad = selectSquad(pool([['DF', 8], ['MD', 8], ['AT', 6], ['GK', 3]]))
    expect(squad).toHaveLength(16)
    expect(squadViolations(squad)).toEqual([])
    expect(squad.filter((p) => p.role === 'GK')).toHaveLength(2)
  })

  it('retient les meilleurs de chaque ligne', () => {
    // Pool inversé : gardiens en tête. Le quota prend p0 et p1, et la place
    // libre revient à p2 — le 3e gardien est ici le meilleur joueur restant.
    // Sur les données réelles ce cas ne se présente pas : les gardiens de D3
    // ferment le classement.
    const squad = selectSquad(pool([['GK', 3], ['DF', 8], ['MD', 8], ['AT', 6]]))
    expect(squad.filter((p) => p.role === 'DF').map((p) => p.id)).toEqual([
      'p3', 'p4', 'p5', 'p6', 'p7',
    ])
    expect(squad.map((p) => p.id)).not.toContain('p8')
  })

  it('remplit exactement les quotas, sans place discrétionnaire', () => {
    // Depuis l'ajout du 4-2-4, 2+5+5+4 = 16 : les quotas saturent le groupe.
    const squad = selectSquad(pool([['DF', 8], ['MD', 8], ['AT', 6], ['GK', 3]]))
    expect(squad).toHaveLength(16)
    expect(squad.filter((p) => p.role === 'DF')).toHaveLength(5)
    expect(squad.filter((p) => p.role === 'AT')).toHaveLength(4)
  })

  it('complète au mérite quand une ligne est trop courte', () => {
    // Cas Villefranche : trois attaquants seulement dans l'effectif. La place
    // laissée libre revient au meilleur joueur restant, et le manque remonte.
    const squad = selectSquad(pool([['DF', 9], ['MD', 8], ['AT', 3], ['GK', 3]]))
    expect(squad).toHaveLength(16)
    expect(squad.filter((p) => p.role === 'DF')).toHaveLength(6)
    expect(squadViolations(squad).some((v) => v.includes('AT'))).toBe(true)
  })

  it("laisse une ligne trop courte remonter au lieu de la masquer", () => {
    const squad = selectSquad(pool([['DF', 9], ['MD', 8], ['AT', 6], ['GK', 1]]))
    expect(squadViolations(squad).some((v) => v.includes('GK'))).toBe(true)
  })
})
