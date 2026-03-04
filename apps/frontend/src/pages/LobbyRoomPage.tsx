import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  getLobby,
  setReady,
  leaveLobby,
  startMatch,
  kickMember,
  updateRuleset,
} from '../lib/api';
import { RulesetConfig, DEFAULT_RULESET } from '@wholet/shared';
import RulesetEditor from '../components/lobby/RulesetEditor';

interface Member {
  user_id: string;
  role: string;
  is_ready: boolean;
  profiles: { display_name: string; avatar_url?: string } | null;
}

interface LobbyData {
  id: string;
  host_user_id: string;
  join_code: string;
  max_players: number;
  allow_spectators: boolean;
  status: string;
  ruleset_config: RulesetConfig;
  lobby_members: Member[];
}

export default function LobbyRoomPage() {
  const { lobbyId } = useParams<{ lobbyId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [lobby, setLobby] = useState<LobbyData | null>(null);
  const [error, setError] = useState('');
  const [chatMessages, setChatMessages] = useState<{ userId: string; name: string; text: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [pendingRuleset, setPendingRuleset] = useState<RulesetConfig>(DEFAULT_RULESET);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const fetchLobby = async () => {
    if (!lobbyId) return;
    try {
      const data = await getLobby(lobbyId);
      setLobby(data);
      setPendingRuleset(data.ruleset_config ?? DEFAULT_RULESET);
    } catch {
      setError('Failed to load lobby');
    }
  };

  useEffect(() => {
    fetchLobby();

    // Supabase Realtime broadcast for lobby presence
    const channel = supabase.channel(`lobby:${lobbyId}`, {
      config: { broadcast: { self: false } },
    });

    channel
      .on('broadcast', { event: 'lobby.updated' }, () => fetchLobby())
      .on('broadcast', { event: 'chat' }, ({ payload }) => {
        setChatMessages(prev => [...prev, { userId: payload.userId, name: payload.name, text: payload.text }]);
      })
      .on('broadcast', { event: 'match.started' }, ({ payload }) => {
        navigate(`/match/${payload.matchId}`);
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      channel.unsubscribe();
    };
  }, [lobbyId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  if (!lobby) {
    return (
      <div className="flex items-center justify-center h-screen text-gray-400">
        {error || 'Loading lobby…'}
      </div>
    );
  }

  const isHost = user?.id === lobby.host_user_id;
  const me = lobby.lobby_members.find(m => m.user_id === user?.id);
  const isReady = me?.is_ready ?? false;
  const players = lobby.lobby_members.filter(m => m.role !== 'spectator');
  const spectators = lobby.lobby_members.filter(m => m.role === 'spectator');
  const allReady = players.filter(m => m.role !== 'host').every(m => m.is_ready);
  const canStart = isHost && players.length >= 2 && (allReady || players.length === 1);

  const handleLeave = async () => {
    if (!lobbyId) return;
    await leaveLobby(lobbyId);
    navigate('/lobbies');
  };

  const handleReady = async () => {
    if (!lobbyId) return;
    await setReady(lobbyId, !isReady);
    await fetchLobby();
    channelRef.current?.send({ type: 'broadcast', event: 'lobby.updated', payload: {} });
  };

  const handleStart = async () => {
    if (!lobbyId) return;
    try {
      const result = await startMatch(lobbyId);
      channelRef.current?.send({ type: 'broadcast', event: 'match.started', payload: { matchId: result.matchId } });
      navigate(`/match/${result.matchId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start match');
    }
  };

  const handleKick = async (targetUserId: string) => {
    if (!lobbyId) return;
    await kickMember(lobbyId, targetUserId);
    await fetchLobby();
    channelRef.current?.send({ type: 'broadcast', event: 'lobby.updated', payload: {} });
  };

  const handleRulesetSave = async () => {
    if (!lobbyId) return;
    await updateRuleset(lobbyId, pendingRuleset);
    await fetchLobby();
    channelRef.current?.send({ type: 'broadcast', event: 'lobby.updated', payload: {} });
  };

  const handleChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const name = me?.profiles?.display_name ?? 'Player';
    channelRef.current?.send({
      type: 'broadcast',
      event: 'chat',
      payload: { userId: user?.id, name, text: chatInput.trim() },
    });
    setChatMessages(prev => [...prev, { userId: user?.id ?? '', name, text: chatInput.trim() }]);
    setChatInput('');
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      <header className="flex items-center justify-between px-6 py-4 bg-gray-800 border-b border-gray-700">
        <div>
          <h1 className="text-xl font-bold">Lobby</h1>
          <p className="text-sm text-gray-400">
            Code: <span className="font-mono text-indigo-400 tracking-widest">{lobby.join_code}</span>
          </p>
        </div>
        <button onClick={handleLeave} className="btn-danger">Leave</button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left panel */}
        <div className="flex-1 p-6 space-y-6 overflow-y-auto">
          {error && <div className="bg-red-900/50 border border-red-700 rounded-lg px-4 py-2 text-red-300">{error}</div>}

          {/* Players */}
          <div>
            <h2 className="text-sm font-semibold text-gray-400 uppercase mb-2">Players ({players.length}/{lobby.max_players})</h2>
            <div className="space-y-2">
              {players.map(member => (
                <div key={member.user_id} className="flex items-center justify-between bg-gray-800 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-2.5 h-2.5 rounded-full ${member.is_ready || member.role === 'host' ? 'bg-green-400' : 'bg-gray-500'}`} />
                    <span>{member.profiles?.display_name ?? 'Player'}</span>
                    {member.role === 'host' && <span className="text-xs bg-indigo-600 px-2 py-0.5 rounded-full">Host</span>}
                  </div>
                  {isHost && member.user_id !== user?.id && (
                    <button onClick={() => handleKick(member.user_id)} className="text-xs text-red-400 hover:text-red-300">Kick</button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {spectators.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-400 uppercase mb-2">Spectators</h2>
              <div className="space-y-1">
                {spectators.map(member => (
                  <div key={member.user_id} className="text-gray-400 text-sm px-4">
                    {member.profiles?.display_name ?? 'Spectator'}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Ruleset */}
          {isHost && (
            <div>
              <h2 className="text-sm font-semibold text-gray-400 uppercase mb-2">Ruleset</h2>
              <div className="bg-gray-800 rounded-xl p-4">
                <RulesetEditor config={pendingRuleset} onChange={setPendingRuleset} />
                <button onClick={handleRulesetSave} className="btn-secondary mt-4 text-sm">Save Ruleset</button>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            {!isHost && me?.role !== 'spectator' && (
              <button onClick={handleReady} className={isReady ? 'btn-secondary' : 'btn-primary'}>
                {isReady ? 'Cancel Ready' : 'Ready Up'}
              </button>
            )}
            {isHost && (
              <button onClick={handleStart} disabled={!canStart} className="btn-primary">
                Start Match
              </button>
            )}
          </div>
        </div>

        {/* Chat panel */}
        <div className="w-72 flex flex-col bg-gray-800 border-l border-gray-700">
          <div className="px-4 py-3 border-b border-gray-700 text-sm font-semibold text-gray-400">Lobby Chat</div>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {chatMessages.map((msg, i) => (
              <div key={i} className="text-sm">
                <span className="text-indigo-400 font-semibold">{msg.name}: </span>
                <span className="text-gray-300">{msg.text}</span>
              </div>
            ))}
            <div ref={chatBottomRef} />
          </div>
          <form onSubmit={handleChat} className="p-3 flex gap-2 border-t border-gray-700">
            <input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              placeholder="Say something…"
              className="flex-1 bg-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button type="submit" className="btn-primary text-sm px-3">Send</button>
          </form>
        </div>
      </div>
    </div>
  );
}
