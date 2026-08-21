import type { MatchEngine } from '../../engine/sim'
import type { Team } from '../../engine/types'

interface Props {
  engine: MatchEngine
  userTeam: Team
  opponent: Team
  onReplay: () => void
  onNewMatch: () => void
}

export function PostMatchScreen({ engine, userTeam, opponent, onReplay, onNewMatch }: Props) {
  const st = engine.state
  const result =
    st.score.home > st.score.away ? 'Victoire !' : st.score.home < st.score.away ? 'Défaite' : 'Match nul'

  const ratings = (team: Team) =>
    team.players
      .map((p) => ({ p, lp: st.players[p.id] }))
      .filter(({ lp }) => lp.stats.distance > 0)
      .sort((a, b) => b.lp.stats.rating - a.lp.stats.rating)

  const timeline = st.events.filter((ev) =>
    ['goal', 'yellow_card', 'red_card', 'penalty', 'sub', 'halftime', 'fulltime', 'info'].includes(ev.type),
  )

  return (
    <div className="screen post">
      <div className="post-hero">
        <h1>
          {userTeam.short} {st.score.home} – {st.score.away} {opponent.short}
        </h1>
        <p className={`result ${st.score.home > st.score.away ? 'win' : st.score.home < st.score.away ? 'loss' : 'draw'}`}>
          {result}
        </p>
      </div>

      <div className="post-actions">
        <button className="btn primary" onClick={onReplay}>
          🔁 Rejouer (mêmes instructions, nouveau match)
        </button>
        <button className="btn ghost" onClick={onNewMatch}>
          Nouveau match
        </button>
      </div>

      <div className="post-cols">
        <section className="panel">
          <h4>Moments clés</h4>
          <ul className="timeline">
            {timeline.map((ev, i) => (
              <li key={i} className={`ev-${ev.type}`}>
                <span className="ev-min">{ev.minute}'</span>
                {ev.message}
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <h4>Notes — {userTeam.name}</h4>
          <table className="ratings-table">
            <thead>
              <tr>
                <th>Joueur</th>
                <th>Note</th>
                <th>Buts</th>
                <th>Passes D.</th>
                <th>Endurance</th>
              </tr>
            </thead>
            <tbody>
              {ratings(userTeam).map(({ p, lp }) => (
                <tr key={p.id}>
                  <td>
                    {p.position} {p.name}
                  </td>
                  <td>
                    <b className={lp.stats.rating >= 7.5 ? 'hi' : lp.stats.rating >= 6.5 ? 'mid' : 'lo'}>
                      {lp.stats.rating.toFixed(1)}
                    </b>
                  </td>
                  <td>{lp.stats.goals}</td>
                  <td>{lp.stats.assists}</td>
                  <td>{Math.round(lp.stamina)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <h4>Notes — {opponent.name}</h4>
          <table className="ratings-table">
            <thead>
              <tr>
                <th>Joueur</th>
                <th>Note</th>
                <th>Buts</th>
                <th>Passes D.</th>
                <th>Endurance</th>
              </tr>
            </thead>
            <tbody>
              {ratings(opponent).map(({ p, lp }) => (
                <tr key={p.id}>
                  <td>
                    {p.position} {p.name}
                  </td>
                  <td>
                    <b className={lp.stats.rating >= 7.5 ? 'hi' : lp.stats.rating >= 6.5 ? 'mid' : 'lo'}>
                      {lp.stats.rating.toFixed(1)}
                    </b>
                  </td>
                  <td>{lp.stats.goals}</td>
                  <td>{lp.stats.assists}</td>
                  <td>{Math.round(lp.stamina)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  )
}
