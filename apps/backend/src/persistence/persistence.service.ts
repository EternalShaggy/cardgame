import { Injectable, OnModuleInit } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { FullMatchState } from '@wholet/shared';

@Injectable()
export class PersistenceService implements OnModuleInit {
  private supabase!: SupabaseClient;
  private anonClient!: SupabaseClient;

  onModuleInit() {
    const url = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = process.env.SUPABASE_ANON_KEY;

    if (!url || !serviceKey || !anonKey) {
      throw new Error('Missing Supabase environment variables');
    }

    // Service role client – bypasses RLS; used only on the server
    this.supabase = createClient(url, serviceKey, {
      auth: { persistSession: false },
    });

    // Anon client – used only for JWT verification
    this.anonClient = createClient(url, anonKey, {
      auth: { persistSession: false },
    });
  }

  get db(): SupabaseClient {
    return this.supabase;
  }

  get anonDb(): SupabaseClient {
    return this.anonClient;
  }

  // ─── Match snapshots ─────────────────────────────────────────────────────

  async saveSnapshot(state: FullMatchState): Promise<void> {
    const { private: priv, public: pub } = state;

    // Serialize private state (hands and piles)
    const privateState = {
      hands: Object.fromEntries(
        Object.entries(priv.hands).map(([k, v]) => [k, v]),
      ),
      drawPile: priv.drawPile,
      discardPile: priv.discardPile,
    };

    await this.supabase.from('match_snapshots').upsert({
      match_id: state.matchId,
      version: state.version,
      public_state: pub,
      private_state: privateState,
    });

    // Update match row version + turn info
    await this.supabase
      .from('matches')
      .update({
        version: state.version,
        current_turn_user_id:
          pub.seats.find((s) => s.seatId === pub.currentTurn)?.userId ?? null,
        direction: pub.direction,
        status: pub.status === 'ended' ? 'ended' : 'active',
        ended_at: pub.status === 'ended' ? new Date().toISOString() : null,
      })
      .eq('id', state.matchId);
  }

  async loadLatestSnapshot(
    matchId: string,
  ): Promise<{ publicState: Record<string, unknown>; privateState: Record<string, unknown> } | null> {
    const { data } = await this.supabase
      .from('match_snapshots')
      .select('public_state, private_state, version')
      .eq('match_id', matchId)
      .order('version', { ascending: false })
      .limit(1)
      .single();

    return data
      ? { publicState: data.public_state, privateState: data.private_state }
      : null;
  }

  // ─── Match players ────────────────────────────────────────────────────────

  async isMatchParticipant(matchId: string, userId: string): Promise<boolean> {
    const { data } = await this.supabase
      .from('match_players')
      .select('user_id')
      .eq('match_id', matchId)
      .eq('user_id', userId)
      .single();
    return !!data;
  }

  async getMatchPlayers(matchId: string) {
    const { data } = await this.supabase
      .from('match_players')
      .select('user_id, seat, role')
      .eq('match_id', matchId);
    return data ?? [];
  }

  // ─── Heartbeat ───────────────────────────────────────────────────────────

  async updateHeartbeat(matchId: string, instanceId: string): Promise<void> {
    await this.supabase
      .from('matches')
      .update({
        host_last_heartbeat: new Date().toISOString(),
        host_instance_id: instanceId,
      })
      .eq('id', matchId);
  }

  async findStaleMatches(staleThresholdSeconds = 30) {
    const cutoff = new Date(
      Date.now() - staleThresholdSeconds * 1000,
    ).toISOString();
    const { data } = await this.supabase
      .from('matches')
      .select('id, host_instance_id')
      .eq('status', 'active')
      .lt('host_last_heartbeat', cutoff);
    return data ?? [];
  }

  // ─── Advisory locks ──────────────────────────────────────────────────────

  async tryAcquireLock(lockKey: bigint): Promise<boolean> {
    const { data } = await this.supabase.rpc('pg_try_advisory_lock', {
      key: lockKey.toString(),
    });
    return data === true;
  }

  async releaseLock(lockKey: bigint): Promise<void> {
    await this.supabase.rpc('pg_advisory_unlock', {
      key: lockKey.toString(),
    });
  }

  // ─── Disconnect tracking ─────────────────────────────────────────────────

  async markPlayerDisconnected(matchId: string, userId: string): Promise<void> {
    await this.supabase
      .from('match_players')
      .update({ disconnected_at: new Date().toISOString() })
      .eq('match_id', matchId)
      .eq('user_id', userId);
  }

  async markPlayerReconnected(matchId: string, userId: string): Promise<void> {
    await this.supabase
      .from('match_players')
      .update({ disconnected_at: null })
      .eq('match_id', matchId)
      .eq('user_id', userId);
  }

  // ─── User profile ─────────────────────────────────────────────────────────

  async getProfile(userId: string) {
    const { data } = await this.supabase
      .from('profiles')
      .select('id, display_name, avatar_url')
      .eq('id', userId)
      .single();
    return data;
  }

  // ─── JWT verification ─────────────────────────────────────────────────────

  async verifyJwt(token: string) {
    const { data, error } = await this.anonDb.auth.getUser(token);
    if (error || !data.user) return null;
    return data.user;
  }
}
