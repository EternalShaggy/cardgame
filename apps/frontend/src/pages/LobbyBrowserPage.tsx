import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  listPublicLobbies,
  createLobby,
  joinByCode,
  joinLobby,
  enqueueMatchmaking,
  cancelMatchmaking,
} from '../lib/api';
import { DEFAULT_RULESET } from '@wholet/shared';

interface LobbyRow {
  id: string;
  join_code: string;
  max_players: number;
  status: string;
  // Supabase returns aggregate as array: [{ count: N }]
  lobby_members: { count: number }[];
}

export default function LobbyBrowserPage() {
  const { signOut, user } = useAuth();
  const navigate = useNavigate();
  const [lobbies, setLobbies] = useState<LobbyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [inQueue, setInQueue] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchLobbies = async () => {
    try {
      const data = await listPublicLobbies();
      setLobbies(data);
    } catch {
      setError('Failed to load lobbies');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLobbies();
    const interval = setInterval(fetchLobbies, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleCreate = async () => {
    setCreating(true);
    setError('');
    try {
      const lobby = await createLobby({
        maxPlayers: 4,
        isPublic: true,
        allowSpectators: true,
        rulesetConfig: DEFAULT_RULESET,
      });
      navigate(`/lobbies/${lobby.id}`);
    } catch {
      setError('Failed to create lobby');
      setCreating(false);
    }
  };

  const handleJoinCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const lobby = await joinByCode(joinCode.trim().toUpperCase());
      navigate(`/lobbies/${lobby.lobby_id ?? lobby.id}`);
    } catch {
      setError('Invalid code or lobby full');
    }
  };

  const handleJoin = async (lobbyId: string) => {
    setError('');
    try {
      await joinLobby(lobbyId, 'player');
      navigate(`/lobbies/${lobbyId}`);
    } catch {
      setError('Failed to join lobby');
    }
  };

  const handleQueue = async () => {
    if (inQueue) {
      await cancelMatchmaking();
      setInQueue(false);
    } else {
      await enqueueMatchmaking({});
      setInQueue(true);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <header className="flex items-center justify-between px-6 py-4 bg-gray-800 border-b border-gray-700">
        <h1 className="text-2xl font-extrabold text-indigo-400">Wholet</h1>
        <div className="flex items-center gap-4">
          <Link to="/profile" className="text-sm text-gray-400 hover:text-white">{user?.email}</Link>
          <button onClick={signOut} className="btn-secondary text-sm">Sign Out</button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {error && <div className="bg-red-900/50 border border-red-700 rounded-lg px-4 py-2 text-red-300">{error}</div>}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button
            onClick={handleCreate}
            disabled={creating}
            className="btn-primary py-4 text-lg"
          >
            {creating ? 'Creating…' : '+ Create Lobby'}
          </button>

          <button
            onClick={handleQueue}
            className={`btn py-4 text-lg font-semibold ${inQueue ? 'bg-yellow-600 hover:bg-yellow-700' : 'bg-green-600 hover:bg-green-700'} text-white`}
          >
            {inQueue ? 'Cancel Queue' : 'Quick Play'}
          </button>

          <form onSubmit={handleJoinCode} className="flex gap-2">
            <input
              value={joinCode}
              onChange={e => setJoinCode(e.target.value)}
              placeholder="Join Code"
              maxLength={6}
              className="flex-1 bg-gray-700 rounded-lg px-3 py-2 uppercase tracking-widest font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button type="submit" className="btn-primary px-4">Join</button>
          </form>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-gray-300 mb-3">Public Lobbies</h2>
          {loading ? (
            <p className="text-gray-500">Loading…</p>
          ) : lobbies.length === 0 ? (
            <p className="text-gray-500">No public lobbies. Create one!</p>
          ) : (
            <div className="space-y-2">
              {lobbies.map(lobby => (
                <div key={lobby.id} className="flex items-center justify-between bg-gray-800 rounded-xl px-5 py-4">
                  <div>
                    <p className="font-semibold">Lobby <span className="font-mono text-indigo-400">{lobby.join_code}</span></p>
                    <p className="text-sm text-gray-400">{lobby.lobby_members[0]?.count ?? 0} / {lobby.max_players} players</p>
                  </div>
                  <button
                    onClick={() => handleJoin(lobby.id)}
                    disabled={(lobby.lobby_members[0]?.count ?? 0) >= lobby.max_players}
                    className="btn-primary"
                  >
                    Join
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
