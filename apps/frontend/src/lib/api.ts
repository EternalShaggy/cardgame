import { supabase } from './supabase';
import { RulesetConfig } from '@wholet/shared';

const BASE = import.meta.env.VITE_GAME_SERVICE_URL as string ?? '/api';

async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
}

export async function getWsTicket(): Promise<string> {
  const res = await authFetch('/auth/ws-ticket', { method: 'POST' });
  if (!res.ok) throw new Error('Failed to get WS ticket');
  const { ticket } = await res.json();
  return ticket as string;
}

export async function createLobby(opts: {
  maxPlayers: number;
  isPublic: boolean;
  allowSpectators: boolean;
  rulesetConfig: RulesetConfig;
}) {
  const res = await authFetch('/lobbies', { method: 'POST', body: JSON.stringify(opts) });
  if (!res.ok) throw new Error('Failed to create lobby');
  return res.json();
}

export async function joinLobby(lobbyId: string, role: 'player' | 'spectator' = 'player') {
  const res = await authFetch(`/lobbies/${lobbyId}/join`, {
    method: 'POST',
    body: JSON.stringify({ role }),
  });
  if (!res.ok) throw new Error('Failed to join lobby');
  return res.json();
}

export async function joinByCode(code: string) {
  const res = await authFetch('/lobbies/join-by-code', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new Error(`Join failed: ${res.status}`);
  return res.json();
}

export async function leaveLobby(lobbyId: string) {
  const res = await authFetch(`/lobbies/${lobbyId}/leave`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to leave lobby');
}

export async function setReady(lobbyId: string, isReady: boolean) {
  const res = await authFetch(`/lobbies/${lobbyId}/ready`, {
    method: 'POST',
    body: JSON.stringify({ isReady }),
  });
  if (!res.ok) throw new Error('Failed to update ready state');
}

export async function startMatch(lobbyId: string) {
  const res = await authFetch(`/lobbies/${lobbyId}/start`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to start match');
  return res.json();
}

export async function kickMember(lobbyId: string, targetUserId: string) {
  const res = await authFetch(`/lobbies/${lobbyId}/kick`, {
    method: 'POST',
    body: JSON.stringify({ targetUserId }),
  });
  if (!res.ok) throw new Error('Failed to kick member');
}

export async function updateRuleset(lobbyId: string, rulesetConfig: RulesetConfig) {
  const res = await authFetch(`/lobbies/${lobbyId}/ruleset`, {
    method: 'PUT',
    body: JSON.stringify({ rulesetConfig }),
  });
  if (!res.ok) throw new Error('Failed to update ruleset');
}

export async function listPublicLobbies() {
  const res = await authFetch('/lobbies');
  if (!res.ok) throw new Error('Failed to list lobbies');
  return res.json();
}

export async function getLobby(lobbyId: string) {
  const res = await authFetch(`/lobbies/${lobbyId}`);
  if (!res.ok) throw new Error('Failed to get lobby');
  return res.json();
}

export async function enqueueMatchmaking(opts?: { rulesetConfig?: RulesetConfig; region?: string }) {
  const res = await authFetch('/matchmaking/enqueue', {
    method: 'POST',
    body: JSON.stringify(opts ?? {}),
  });
  if (!res.ok) throw new Error('Failed to enqueue');
}

export async function cancelMatchmaking() {
  const res = await authFetch('/matchmaking/cancel', { method: 'POST' });
  if (!res.ok) throw new Error('Failed to cancel');
}
