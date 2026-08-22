// Régression : le popup « choisir un joueur » passait sous les postes voisins.
//
// .pl-slot crée un contexte d'empilement (transform + z-index), donc le
// z-index de .pl-pop est confiné à l'intérieur du poste et ne peut pas
// franchir ses frères. Tous les postes étant à z-index égal, l'ordre du DOM
// décidait : les postes suivants se peignaient par-dessus le popup et
// interceptaient les clics sur la liste.
//
// Le correctif soulève le poste *ouvert* lui-même. Ces tests verrouillent les
// deux moitiés du contrat (la classe posée par le composant, la règle CSS qui
// la rend efficace) — la seule vérification possible sans navigateur réel.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// commentaires retirés : ils s'intercalent entre les règles et fausseraient
// l'ancrage « fin de la règle précédente » du sélecteur recherché
const css = readFileSync(join(import.meta.dirname, '../index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const tsx = readFileSync(join(import.meta.dirname, 'components/PitchLineup.tsx'), 'utf8')

/** z-index déclaré par la règle exactement égale à `selector` (null si absente). */
function zIndexOf(selector: string): number | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const rule = css.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`))
  if (!rule) return null
  const z = rule[1].match(/z-index:\s*(-?\d+)/)
  return z ? Number(z[1]) : null
}

describe('PitchLineup — empilement du popup de composition', () => {
  it('le poste ouvert se peint au-dessus des autres postes', () => {
    const base = zIndexOf('.pl-slot')
    const open = zIndexOf('.pl-slot.open')

    expect(base, '.pl-slot doit garder un z-index explicite').not.toBeNull()
    expect(open, 'règle .pl-slot.open manquante : le popup repassera sous les postes voisins').not.toBeNull()
    expect(open!).toBeGreaterThan(base!)
  })

  it('le popup reste au-dessus du jeton et du libellé de son propre poste', () => {
    expect(zIndexOf('.pl-pop')!).toBeGreaterThan(zIndexOf('.pl-slot')!)
  })

  it('le composant pose la classe .open sur le poste ouvert', () => {
    // openSlot === i pilote déjà la classe `active` du jeton ; le poste doit
    // suivre la même condition, sinon la règle CSS ne s'applique jamais.
    expect(tsx).toMatch(/className=\{`pl-slot \$\{openSlot === i \? 'open' : ''\}`\}/)
  })
})
