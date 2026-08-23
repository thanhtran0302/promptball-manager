// Extraction des joueurs du Championnat National (Ligue 3) depuis FMInside.
//
// FMInside est derrière Cloudflare : toute requête automatisée — fetch(), curl,
// ou navigateur piloté à profil neuf — reçoit un 403 « Just a moment... ».
// Seul un vrai navigateur franchit le challenge. Ce script se colle donc dans
// la console d'un onglet déjà ouvert sur la page de la compétition : les
// fetch() qu'il lance sont same-origin et portent la session de l'onglet.
//
// Marche à suivre :
//   1. Ouvrir https://fminside.net/competitions/7-fm-26/18-championnat-national
//   2. DevTools (⌥⌘I) > Console, coller ce fichier entier, Entrée
//   3. Attendre ~5 min — la progression s'affiche club par club
//   4. Un fichier national-raw.json se télécharge en fin de course
//   5. mkdir -p .cache/fminside
//      mv ~/Downloads/national-raw.json .cache/fminside/raw.json
//   6. npm run fetch:national
//
// Le délai entre requêtes est délibéré : ~3 requêtes/seconde sur un site
// communautaire gratuit. Ne pas le baisser.

;(async () => {
  const DELAY_MS = 300
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  if (!location.pathname.includes('/competitions/')) {
    console.error('À lancer depuis la page de la compétition, pas depuis %s', location.pathname)
    return
  }

  const get = async (href) => {
    const r = await fetch(href, { credentials: 'same-origin' })
    if (!r.ok) throw new Error(`${r.status} sur ${href}`)
    return new DOMParser().parseFromString(await r.text(), 'text/html')
  }

  /** Attributs + identité d'une fiche joueur. */
  const readPlayer = (doc, href) => {
    const attrs = {}
    for (const td of doc.querySelectorAll('td.name')) {
      const key = td.textContent.trim()
      const value = parseInt(td.nextElementSibling?.textContent?.trim() ?? '', 10)
      if (key && Number.isFinite(value)) attrs[key] = value
    }
    // DOMParser ne rend pas la page : innerText est vide, textContent ne l'est pas.
    const text = doc.body.textContent
    const played = text.match(/plays as ([A-Z][A-Z, ]*?) and prefers/)
    const profile = text.match(/is an? \d+-year-old ([A-Z][A-Z, ]*?) for /)
    const ability = text.match(/ability rating of (\d+)/)
    return {
      uid: (href.split('/').pop() ?? '').split('-')[0],
      name: doc.title.split(' FM26')[0].trim(),
      positions: (played?.[1] ?? profile?.[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      ability: ability ? parseInt(ability[1], 10) : 0,
      attrs,
    }
  }

  const clubHrefs = [...new Set(
    [...document.querySelectorAll('a[href*="/clubs/"]')]
      .map((a) => a.getAttribute('href'))
      .filter((h) => h && /\/clubs\/[^/]+\/[\w-]+$/.test(h)),
  )]
  console.log(`${clubHrefs.length} clubs à traiter`)

  const clubs = []
  const warnings = []

  for (const href of clubHrefs) {
    const doc = await get(href)
    const name = doc.title.split(' FM26')[0].trim()
    // Le tableau d'effectif liste aussi la réserve et les jeunes : seule
    // l'équipe première nous intéresse (prêts entrants compris).
    const rows = [...doc.querySelectorAll('table.club-squad-table tbody tr')]
      .filter((tr) => tr.dataset.clubTeam === 'first-team')

    const players = []
    for (const tr of rows) {
      const playerHref = tr.querySelector('a[href*="/players/"]')?.getAttribute('href')
      if (!playerHref) continue
      await sleep(DELAY_MS)
      try {
        const player = readPlayer(await get(playerHref), playerHref)
        // Une fiche sans attribut signale un changement de structure du site :
        // mieux vaut un trou visible qu'un joueur rempli de valeurs par défaut.
        if (Object.keys(player.attrs).length === 0) {
          warnings.push(`aucun attribut : ${playerHref}`)
          continue
        }
        players.push(player)
      } catch (e) {
        warnings.push(e.message)
      }
    }

    clubs.push({ slug: href.split('/').pop(), name, players })
    console.log(`  ${name} — ${players.length} joueurs (${clubs.length}/${clubHrefs.length})`)
    await sleep(500)
  }

  const total = clubs.reduce((n, c) => n + c.players.length, 0)
  console.log(`\n${clubs.length} clubs, ${total} joueurs`)
  if (warnings.length) console.warn(`${warnings.length} avertissement(s)`, warnings)

  const blob = new Blob([JSON.stringify(clubs, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'national-raw.json'
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 5000)
  console.log('national-raw.json téléchargé — voir l\'en-tête du fichier pour la suite')
})()
