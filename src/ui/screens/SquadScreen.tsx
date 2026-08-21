import type { Player, Team } from '../../engine/types'

interface Props {
  userTeam: Team
  opponent: Team
  onBack: () => void
  onNext: () => void
}

const ATTRS: { key: keyof Player['attributes']; label: string; short: string }[] = [
  { key: 'pace', label: 'Vitesse', short: 'VIT' },
  { key: 'stamina', label: 'Endurance', short: 'END' },
  { key: 'technique', label: 'Technique', short: 'TEC' },
  { key: 'passing', label: 'Passe', short: 'PAS' },
  { key: 'shooting', label: 'Tir', short: 'TIR' },
  { key: 'tackling', label: 'Tacle', short: 'TAC' },
  { key: 'agility', label: 'Vivacité', short: 'VIV' },
]

function PlayerCard({ player, accent }: { player: Player; accent: string }) {
  return (
    <div className="player-card">
      <div className="pc-head" style={{ borderTopColor: accent }}>
        <span className="pc-pos">{player.position}</span>
        <span className="pc-name">{player.name}</span>
      </div>
      <div className="pc-attrs">
        {ATTRS.map(({ key, label, short }) => (
          <div key={key} className={`attr v-${tier(player.attributes[key])}`} title={label}>
            <em>{short}</em>
            <b>{player.attributes[key]}</b>
          </div>
        ))}
        {player.role === 'GK' && (
          <div className={`attr v-${tier(player.attributes.goalkeeper)}`} title="Gardien">
            <em>GAR</em>
            <b>{player.attributes.goalkeeper}</b>
          </div>
        )}
      </div>
    </div>
  )
}

function tier(v: number): string {
  return v >= 80 ? 'hi' : v >= 65 ? 'mid' : 'lo'
}

export function SquadScreen({ userTeam, opponent, onBack, onNext }: Props) {
  return (
    <div className="screen">
      <div className="screen-head">
        <button className="btn ghost" onClick={onBack}>← Retour</button>
        <h2>Effectif — {userTeam.name}</h2>
        <button className="btn primary" onClick={onNext}>Écran tactique →</button>
      </div>

      <div className="squad-grid">
        {userTeam.players.map((p) => (
          <PlayerCard key={p.id} player={p} accent={userTeam.color} />
        ))}
      </div>

      <h3 className="opp-title">Adversaire : {opponent.name}</h3>
      <div className="squad-grid compact">
        {opponent.players.map((p) => (
          <PlayerCard key={p.id} player={p} accent={opponent.color} />
        ))}
      </div>
    </div>
  )
}
