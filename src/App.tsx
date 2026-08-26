import { useState } from 'react'
import { MatchEngine } from './engine/sim'
import { defaultInstructions } from './engine/instructions'
import type { MatchInstructions } from './engine/types'
import { ALL_TEAMS } from './data/allTeams'
import { loadSettings, saveSettings, type LLMSettings } from './llm/presets'
import { SetupScreen } from './ui/screens/SetupScreen'
import { SquadScreen } from './ui/screens/SquadScreen'
import { TacticsScreen } from './ui/screens/TacticsScreen'
import { MatchScreen } from './ui/screens/MatchScreen'
import { PostMatchScreen } from './ui/screens/PostMatchScreen'

export type Screen = 'setup' | 'squad' | 'tactics' | 'match' | 'post'

export default function App() {
  const [screen, setScreen] = useState<Screen>('setup')
  const [userTeamId, setUserTeamId] = useState<string>(ALL_TEAMS[0].id)
  const [settings, setSettings] = useState<LLMSettings>(() => loadSettings())
  const [instructions, setInstructions] = useState<MatchInstructions>(() => defaultInstructions())
  const [engine, setEngine] = useState<MatchEngine | null>(null)
  const [matchVersion, setMatchVersion] = useState(0)

  const userTeam = ALL_TEAMS.find((t) => t.id === userTeamId)!
  const opponent = ALL_TEAMS.find((t) => t.id !== userTeamId)!

  const updateSettings = (s: LLMSettings) => {
    setSettings(s)
    saveSettings(s)
  }

  // Le joueur humain est toujours "home" (attaque vers la droite),
  // l'IA adverse est "away".
  const startMatch = (instr: MatchInstructions) => {
    setInstructions(instr)
    const seed = Math.floor(Math.random() * 1e9)
    setEngine(
      new MatchEngine({
        home: userTeam,
        away: opponent,
        homeInstructions: instr,
        awayInstructions: defaultInstructions(),
        seed,
        autoSubSides: ['away'],
      }),
    )
    setMatchVersion((v) => v + 1)
    setScreen('match')
  }

  const replayMatch = () => {
    if (!engine) return
    const seed = Math.floor(Math.random() * 1e9)
    setEngine(
      new MatchEngine({
        home: userTeam,
        away: opponent,
        homeInstructions: engine.state.home.instructions,
        awayInstructions: engine.state.away.instructions,
        seed,
        autoSubSides: ['away'],
      }),
    )
    setMatchVersion((v) => v + 1)
    setScreen('match')
  }

  const newMatch = () => {
    setEngine(null)
    setInstructions(defaultInstructions())
    setScreen('setup')
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">⚽ Prompt Foot Manager</div>
        {screen !== 'setup' && (
          <nav className="steps">
            <span className={screen === 'squad' ? 'on' : ''}>Effectif</span>
            <span className={screen === 'tactics' ? 'on' : ''}>Tactique</span>
            <span className={screen === 'match' || screen === 'post' ? 'on' : ''}>Match</span>
          </nav>
        )}
        <div className="header-right">
          <span className={`llm-badge ${settings.apiKey ? 'ok' : ''}`}>
            {settings.apiKey ? `LLM · ${settings.model}` : 'Mode démo (sans LLM)'}
          </span>
        </div>
      </header>

      {screen === 'setup' && (
        <SetupScreen
          userTeamId={userTeamId}
          onChooseTeam={(id) => {
            setUserTeamId(id)
            setInstructions(defaultInstructions())
          }}
          onGoSquad={() => setScreen('squad')}
          settings={settings}
          onUpdateSettings={updateSettings}
        />
      )}
      {screen === 'squad' && (
        <SquadScreen
          userTeam={userTeam}
          opponent={opponent}
          onBack={() => setScreen('setup')}
          onNext={() => setScreen('tactics')}
        />
      )}
      {screen === 'tactics' && (
        <TacticsScreen
          userTeam={userTeam}
          opponent={opponent}
          settings={settings}
          onUpdateSettings={updateSettings}
          instructions={instructions}
          onValidate={(instr) => setInstructions(instr)}
          onStart={startMatch}
        />
      )}
      {screen === 'match' && engine && (
        <MatchScreen
          key={matchVersion}
          engine={engine}
          userTeam={userTeam}
          opponent={opponent}
          settings={settings}
          onFinished={() => setScreen('post')}
        />
      )}
      {screen === 'post' && engine && (
        <PostMatchScreen engine={engine} userTeam={userTeam} opponent={opponent} onReplay={replayMatch} onNewMatch={newMatch} />
      )}
    </div>
  )
}
