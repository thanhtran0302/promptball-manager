// Deux équipes fictives aux profils contrastés :
//  - AS Lumière          : technique, possession (passe courte, mental élevé)
//  - Sporting Atlantique : physique, direct (agressivité, duels)

import type { Player, PlayerAttributes, Team, Role } from '../engine/types'

type Attrs = Partial<PlayerAttributes> & {
  pace: number
  stamina: number
  technique: number
  passing: number
  shooting: number
  tackling: number
  agility: number
}

function mk(id: string, name: string, role: Role, position: string, a: Attrs): Player {
  return {
    id,
    name,
    role,
    position,
    attributes: {
      decisions: 60,
      vision: 60,
      composure: 60,
      aggression: 60,
      goalkeeper: 20,
      ...a,
    } as PlayerAttributes,
  }
}

// --- AS Lumière -----------------------------------------------------------

const lumiere: Player[] = [
  mk('h1', 'Marceau Vidal', 'GK', 'G', { pace: 52, stamina: 62, technique: 55, passing: 58, shooting: 25, tackling: 40, agility: 70, goalkeeper: 78, decisions: 68, vision: 55, composure: 72, aggression: 40 }),
  mk('h2', 'Théo Lambert', 'DF', 'DG', { pace: 80, stamina: 64, technique: 74, passing: 76, shooting: 48, tackling: 62, agility: 73, decisions: 66, vision: 70, composure: 68, aggression: 62 }), // latéral rapide mais fragile
  mk('h3', 'Idrissa Bâ', 'DF', 'DC', { pace: 66, stamina: 78, technique: 58, passing: 55, shooting: 35, tackling: 84, agility: 62, decisions: 70, vision: 58, composure: 72, aggression: 78 }),
  mk('h4', 'Samuel Kerr', 'DF', 'DC', { pace: 68, stamina: 76, technique: 55, passing: 56, shooting: 38, tackling: 81, agility: 60, decisions: 66, vision: 55, composure: 68, aggression: 80 }),
  mk('h5', 'Nolan Perrin', 'DF', 'DD', { pace: 76, stamina: 71, technique: 70, passing: 73, shooting: 44, tackling: 65, agility: 71, decisions: 68, vision: 66, composure: 70, aggression: 64 }),
  mk('h6', 'Hugo Ferreira', 'MD', 'MDC', { pace: 62, stamina: 82, technique: 80, passing: 85, shooting: 55, tackling: 74, agility: 70, decisions: 82, vision: 80, composure: 78, aggression: 60 }),
  mk('h7', 'Rémy Sissoko', 'MD', 'MC', { pace: 68, stamina: 88, technique: 75, passing: 79, shooting: 58, tackling: 70, agility: 72, decisions: 76, vision: 74, composure: 76, aggression: 58 }),
  mk('h8', 'Aurélien Delcourt', 'MD', 'MC', { pace: 62, stamina: 66, technique: 89, passing: 90, shooting: 66, tackling: 45, agility: 78, decisions: 80, vision: 88, composure: 85, aggression: 42 }), // le mètre étalon technique
  mk('h9', 'Yanis Charbonnier', 'MD', 'MG', { pace: 83, stamina: 72, technique: 82, passing: 78, shooting: 62, tackling: 48, agility: 80, decisions: 72, vision: 76, composure: 70, aggression: 50 }),
  mk('h10', 'Sacha Vermeer', 'MD', 'MD', { pace: 84, stamina: 73, technique: 79, passing: 77, shooting: 64, tackling: 50, agility: 79, decisions: 70, vision: 74, composure: 68, aggression: 52 }),
  mk('h11', 'Karim Zerhouni', 'AT', 'BU', { pace: 74, stamina: 70, technique: 83, passing: 68, shooting: 88, tackling: 30, agility: 82, decisions: 74, vision: 68, composure: 84, aggression: 55 }),
  mk('h12', 'Elias Fontaine', 'AT', 'AG', { pace: 88, stamina: 70, technique: 84, passing: 72, shooting: 76, tackling: 32, agility: 85, decisions: 68, vision: 72, composure: 70, aggression: 48 }),
  mk('h13', 'Djibril Traoré', 'AT', 'AD', { pace: 86, stamina: 72, technique: 80, passing: 70, shooting: 79, tackling: 34, agility: 83, decisions: 66, vision: 70, composure: 66, aggression: 50 }),
  mk('h14', 'Ewan Morvan', 'GK', 'G', { pace: 50, stamina: 60, technique: 52, passing: 55, shooting: 22, tackling: 38, agility: 64, goalkeeper: 68, decisions: 60, vision: 50, composure: 64, aggression: 38 }),
  mk('h15', 'Paulo Ribeiro', 'DF', 'DC', { pace: 63, stamina: 74, technique: 56, passing: 54, shooting: 33, tackling: 76, agility: 58, decisions: 64, vision: 52, composure: 66, aggression: 72 }),
  mk('h16', 'Louka Garnier', 'MD', 'MC', { pace: 66, stamina: 79, technique: 72, passing: 74, shooting: 56, tackling: 62, agility: 69, decisions: 68, vision: 66, composure: 68, aggression: 55 }),
]

// --- Sporting Atlantique --------------------------------------------------

const atlantique: Player[] = [
  mk('a1', 'Bastien Roux', 'GK', 'G', { pace: 54, stamina: 63, technique: 54, passing: 56, shooting: 24, tackling: 42, agility: 72, goalkeeper: 81, decisions: 70, vision: 58, composure: 74, aggression: 44 }),
  mk('a2', 'Amadou Diallo', 'DF', 'DG', { pace: 87, stamina: 76, technique: 66, passing: 66, shooting: 42, tackling: 68, agility: 80, decisions: 62, vision: 60, composure: 62, aggression: 85 }),
  mk('a3', 'Victor Escande', 'DF', 'DC', { pace: 64, stamina: 80, technique: 52, passing: 52, shooting: 34, tackling: 86, agility: 58, decisions: 66, vision: 54, composure: 68, aggression: 86 }),
  mk('a4', 'Mattias Orsato', 'DF', 'DC', { pace: 66, stamina: 79, technique: 54, passing: 55, shooting: 36, tackling: 83, agility: 61, decisions: 64, vision: 55, composure: 66, aggression: 82 }),
  mk('a5', 'Jimmy Cadiou', 'DF', 'DD', { pace: 78, stamina: 75, technique: 64, passing: 65, shooting: 40, tackling: 72, agility: 74, decisions: 64, vision: 58, composure: 64, aggression: 74 }),
  mk('a6', 'Isaac Noudoulèye', 'MD', 'MDC', { pace: 70, stamina: 86, technique: 68, passing: 72, shooting: 52, tackling: 81, agility: 71, decisions: 74, vision: 66, composure: 72, aggression: 80 }),
  mk('a7', 'Bruno Vasseur', 'MD', 'MC', { pace: 66, stamina: 84, technique: 70, passing: 76, shooting: 58, tackling: 73, agility: 68, decisions: 70, vision: 68, composure: 70, aggression: 68 }),
  mk('a8', 'Kevin Marajo', 'MD', 'MC', { pace: 82, stamina: 83, technique: 70, passing: 68, shooting: 64, tackling: 66, agility: 75, decisions: 62, vision: 62, composure: 60, aggression: 76 }),
  mk('a9', 'Steven Le Goff', 'MD', 'MG', { pace: 85, stamina: 77, technique: 73, passing: 70, shooting: 62, tackling: 52, agility: 78, decisions: 60, vision: 64, composure: 58, aggression: 66 }),
  mk('a10', 'Timothée Razafy', 'MD', 'MD', { pace: 83, stamina: 78, technique: 71, passing: 74, shooting: 60, tackling: 54, agility: 76, decisions: 62, vision: 64, composure: 62, aggression: 62 }),
  mk('a11', 'Moussa Konaté', 'AT', 'BU', { pace: 87, stamina: 72, technique: 74, passing: 62, shooting: 85, tackling: 28, agility: 81, decisions: 64, vision: 62, composure: 66, aggression: 70 }),
  mk('a12', 'Grégory Pinto', 'AT', 'BU', { pace: 70, stamina: 74, technique: 77, passing: 66, shooting: 81, tackling: 30, agility: 72, decisions: 68, vision: 64, composure: 74, aggression: 58 }),
  mk('a13', 'Enzo Belliard', 'AT', 'AG', { pace: 88, stamina: 73, technique: 76, passing: 68, shooting: 75, tackling: 30, agility: 84, decisions: 58, vision: 62, composure: 58, aggression: 64 }),
  mk('a14', 'Théo Millasseau', 'GK', 'G', { pace: 51, stamina: 60, technique: 50, passing: 52, shooting: 20, tackling: 36, agility: 62, goalkeeper: 66, decisions: 56, vision: 48, composure: 58, aggression: 40 }),
  mk('a15', 'Raphaël Duny', 'DF', 'DC', { pace: 62, stamina: 75, technique: 50, passing: 50, shooting: 30, tackling: 74, agility: 56, decisions: 60, vision: 50, composure: 62, aggression: 74 }),
  mk('a16', 'Farid Belkacem', 'AT', 'AD', { pace: 84, stamina: 74, technique: 75, passing: 66, shooting: 77, tackling: 32, agility: 79, decisions: 62, vision: 63, composure: 64, aggression: 66 }),
]

export const TEAMS: Team[] = [
  {
    id: 'lumiere',
    name: 'AS Lumière',
    short: 'LUM',
    color: '#3b82f6',
    colorAlt: '#dbeafe',
    players: lumiere,
  },
  {
    id: 'atlantique',
    name: 'Sporting Atlantique',
    short: 'SPA',
    color: '#ef4444',
    colorAlt: '#fee2e2',
    players: atlantique,
  },
]

export function teamById(id: string): Team {
  const t = TEAMS.find((t) => t.id === id)
  if (!t) throw new Error(`Équipe inconnue : ${id}`)
  return t
}
