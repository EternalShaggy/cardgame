import { Injectable, Logger } from '@nestjs/common';
import { PersistenceService } from '../persistence/persistence.service';
import { MatchService } from '../match/match.service';
import { RulesetConfig, DEFAULT_RULESET } from '@wholet/shared';
import { v4 as uuidv4 } from 'uuid';

function generateJoinCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

@Injectable()
export class LobbyService {
  private readonly logger = new Logger(LobbyService.name);

  constructor(
    private readonly persistence: PersistenceService,
    private readonly matchService: MatchService,
  ) {}

  async createLobby(
    hostUserId: string,
    opts: {
      maxPlayers: number;
      isPublic: boolean;
      allowSpectators: boolean;
      rulesetConfig: RulesetConfig;
    },
  ) {
    const joinCode = generateJoinCode();

    const { data, error } = await this.persistence.db
      .from('lobbies')
      .insert({
        join_code: joinCode,
        host_user_id: hostUserId,
        max_players: opts.maxPlayers,
        is_public: opts.isPublic,
        allow_spectators: opts.allowSpectators,
        ruleset_config: opts.rulesetConfig,
        status: 'open',
      })
      .select()
      .single();

    if (error) throw error;

    // Host auto-joins as 'host' role
    await this.persistence.db.from('lobby_members').insert({
      lobby_id: data.id,
      user_id: hostUserId,
      role: 'host',
      is_ready: true,
    });

    return data;
  }

  async joinLobby(userId: string, lobbyId: string, role: 'player' | 'spectator' = 'player') {
    const { data, error } = await this.persistence.db.rpc('join_lobby', {
      p_lobby_id: lobbyId,
      p_role: role,
    });

    if (error) throw error;
    return data;
  }

  async joinByCode(userId: string, code: string) {
    const { data: lobby, error } = await this.persistence.db
      .from('lobbies')
      .select('id')
      .eq('join_code', code.toUpperCase())
      .single();

    if (error || !lobby) throw new Error('Lobby not found');
    return this.joinLobby(userId, lobby.id);
  }

  async leaveLobby(userId: string, lobbyId: string) {
    // If host leaves, transfer or close
    const { data: lobby } = await this.persistence.db
      .from('lobbies')
      .select('host_user_id')
      .eq('id', lobbyId)
      .single();

    if (lobby?.host_user_id === userId) {
      await this.closeOrTransferLobby(lobbyId, userId);
    } else {
      await this.persistence.db
        .from('lobby_members')
        .delete()
        .eq('lobby_id', lobbyId)
        .eq('user_id', userId);
    }
  }

  async setReady(userId: string, lobbyId: string, isReady: boolean) {
    await this.persistence.db
      .from('lobby_members')
      .update({ is_ready: isReady })
      .eq('lobby_id', lobbyId)
      .eq('user_id', userId);
  }

  async kickMember(hostUserId: string, lobbyId: string, targetUserId: string) {
    const { data: lobby } = await this.persistence.db
      .from('lobbies')
      .select('host_user_id')
      .eq('id', lobbyId)
      .single();

    if (lobby?.host_user_id !== hostUserId) throw new Error('Not the host');

    await this.persistence.db
      .from('lobby_members')
      .delete()
      .eq('lobby_id', lobbyId)
      .eq('user_id', targetUserId);
  }

  async startMatch(hostUserId: string, lobbyId: string) {
    const { data: lobby } = await this.persistence.db
      .from('lobbies')
      .select('*, lobby_members(user_id, role, is_ready)')
      .eq('id', lobbyId)
      .single();

    if (!lobby) throw new Error('Lobby not found');
    if (lobby.host_user_id !== hostUserId) throw new Error('Not the host');

    const players = (lobby.lobby_members as any[]).filter(
      (m: any) => m.role === 'player' || m.role === 'host',
    );

    if (players.length < 2) throw new Error('Need at least 2 players');
    const allReady = players.every((m: any) => m.is_ready || m.role === 'host');
    if (!allReady) throw new Error('Not all players are ready');

    // Update lobby status
    await this.persistence.db
      .from('lobbies')
      .update({ status: 'in_match' })
      .eq('id', lobbyId);

    // Create match row
    const matchId = uuidv4();
    await this.persistence.db.from('matches').insert({
      id: matchId,
      lobby_id: lobbyId,
      ruleset_config: lobby.ruleset_config,
      status: 'active',
    });

    // Get player profiles
    const userIds = players.map((p: any) => p.user_id);
    const { data: profiles } = await this.persistence.db
      .from('profiles')
      .select('id, display_name, avatar_url')
      .in('id', userIds);

    const playerList = players.map((p: any) => {
      const profile = profiles?.find((pr: any) => pr.id === p.user_id);
      return {
        userId: p.user_id,
        displayName: profile?.display_name ?? 'Player',
        avatarUrl: profile?.avatar_url,
      };
    });

    // Start the match session
    await this.matchService.startMatch({
      matchId,
      lobbyId,
      players: playerList,
      ruleset: lobby.ruleset_config as RulesetConfig,
    });

    this.logger.log(`Match ${matchId} started from lobby ${lobbyId}`);
    return { matchId };
  }

  async getLobby(lobbyId: string) {
    const { data } = await this.persistence.db
      .from('lobbies')
      .select('*, lobby_members(user_id, role, is_ready, profiles(display_name, avatar_url))')
      .eq('id', lobbyId)
      .single();
    return data;
  }

  async listPublicLobbies() {
    const { data } = await this.persistence.db
      .from('lobbies')
      .select('id, join_code, max_players, ruleset_config, status, created_at, lobby_members(count)')
      .eq('is_public', true)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(50);
    return data ?? [];
  }

  async updateRuleset(hostUserId: string, lobbyId: string, rulesetConfig: RulesetConfig) {
    const { data: lobby } = await this.persistence.db
      .from('lobbies')
      .select('host_user_id, status')
      .eq('id', lobbyId)
      .single();

    if (lobby?.host_user_id !== hostUserId) throw new Error('Not the host');
    if (lobby?.status !== 'open') throw new Error('Cannot change ruleset after match start');

    await this.persistence.db
      .from('lobbies')
      .update({ ruleset_config: rulesetConfig })
      .eq('id', lobbyId);
  }

  private async closeOrTransferLobby(lobbyId: string, hostUserId: string) {
    // Try to find another player to make host
    const { data: members } = await this.persistence.db
      .from('lobby_members')
      .select('user_id, role')
      .eq('lobby_id', lobbyId)
      .neq('user_id', hostUserId)
      .limit(1);

    if (members && members.length > 0) {
      const newHost = members[0]!.user_id;
      await this.persistence.db
        .from('lobbies')
        .update({ host_user_id: newHost })
        .eq('id', lobbyId);
      await this.persistence.db
        .from('lobby_members')
        .update({ role: 'host' })
        .eq('lobby_id', lobbyId)
        .eq('user_id', newHost);
    } else {
      // No other members; close lobby
      await this.persistence.db
        .from('lobbies')
        .update({ status: 'closed' })
        .eq('id', lobbyId);
    }

    // Remove host from members
    await this.persistence.db
      .from('lobby_members')
      .delete()
      .eq('lobby_id', lobbyId)
      .eq('user_id', hostUserId);
  }
}
