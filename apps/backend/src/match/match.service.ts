/**
 * MatchService – per-match in-memory state + persistence adapter.
 * Single-writer guarantee is enforced by the match actor pattern:
 * all incoming WS messages for a match are processed sequentially.
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PersistenceService } from '../persistence/persistence.service';
import {
  FullMatchState,
  RulesetConfig,
  PublicMatchState,
  Card,
  SeatPublic,
  CardColor,
} from '@wholet/shared';

const VALID_COLORS = new Set<string>(['red', 'blue', 'green', 'yellow']);
import {
  initMatch,
  playCard,
  drawCard,
  callUno,
  challengeWdf,
  sevenSwap,
  jumpIn,
  penaliseForUno,
  GameEvent,
} from '../game/rule-engine';
import { matchLockKey } from '../game/match-lock';

export interface MatchSession {
  matchId: string;
  state: FullMatchState;
  // seatId → userId mapping for quick lookup
  seatToUser: Map<number, string>;
  // userId → seatId
  userToSeat: Map<string, number>;
  heartbeatInterval?: NodeJS.Timer;
  disconnectTimers: Map<string, NodeJS.Timeout>;
  voteSkipVotes: Set<string>;  // userIds who voted
}

export type ActionResult =
  | { ok: true; events: GameEvent[]; state: FullMatchState }
  | { ok: false; reason: string };

@Injectable()
export class MatchService implements OnModuleInit {
  private readonly logger = new Logger(MatchService.name);
  private readonly sessions = new Map<string, MatchSession>();
  private readonly instanceId = process.env.INSTANCE_ID ?? uuidv4();

  constructor(private readonly persistence: PersistenceService) {}

  onModuleInit() {
    // Check for stale locks every 10s and reclaim if needed
    setInterval(() => this.reclaimStaleLocks(), 10_000);
  }

  // ─── Session management ───────────────────────────────────────────────────

  getSession(matchId: string): MatchSession | undefined {
    return this.sessions.get(matchId);
  }

  async startMatch(opts: {
    matchId: string;
    lobbyId: string;
    players: Array<{ userId: string; displayName: string; avatarUrl?: string }>;
    ruleset: RulesetConfig;
  }): Promise<FullMatchState> {
    const seats = opts.players.map((p, i) => ({
      seatId: i,
      userId: p.userId,
      displayName: p.displayName,
      avatarUrl: p.avatarUrl,
    }));

    const state = initMatch({
      matchId: opts.matchId,
      seats,
      ruleset: opts.ruleset,
    });

    const seatToUser = new Map(seats.map((s) => [s.seatId, s.userId]));
    const userToSeat = new Map(seats.map((s) => [s.userId, s.seatId]));

    const session: MatchSession = {
      matchId: opts.matchId,
      state,
      seatToUser,
      userToSeat,
      disconnectTimers: new Map(),
      voteSkipVotes: new Set(),
    };

    this.sessions.set(opts.matchId, session);

    // Insert match_players rows
    for (const seat of seats) {
      await this.persistence.db.from('match_players').upsert({
        match_id: opts.matchId,
        user_id: seat.userId,
        seat: seat.seatId,
        role: 'player',
      });
    }

    // Start heartbeat
    this.startHeartbeat(session);

    // Persist initial snapshot
    await this.persistence.saveSnapshot(state);

    this.logger.log(`Match ${opts.matchId} started with ${seats.length} players`);
    return state;
  }

  async loadMatch(matchId: string): Promise<FullMatchState | null> {
    const snap = await this.persistence.loadLatestSnapshot(matchId);
    if (!snap) return null;

    const players = await this.persistence.getMatchPlayers(matchId);

    const pub = snap.publicState as PublicMatchState;
    const priv = snap.privateState as {
      hands: Record<number, Card[]>;
      drawPile: Card[];
      discardPile: Card[];
    };

    const state: FullMatchState = {
      matchId,
      version: (pub as { version?: number }).version ?? 0,
      public: pub,
      private: {
        hands: priv.hands,
        drawPile: priv.drawPile,
        discardPile: priv.discardPile,
        unoCalledBy: new Set(),
      },
    };

    const seatToUser = new Map(players.map((p: { seat: number; user_id: string }) => [p.seat, p.user_id]));
    const userToSeat = new Map(players.map((p: { seat: number; user_id: string }) => [p.user_id, p.seat]));

    const session: MatchSession = {
      matchId,
      state,
      seatToUser,
      userToSeat,
      disconnectTimers: new Map(),
      voteSkipVotes: new Set(),
    };
    this.sessions.set(matchId, session);
    this.startHeartbeat(session);

    return state;
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  async handlePlayCard(
    matchId: string,
    userId: string,
    cardId: string,
    chosenColor?: string,
    targetSeatId?: number,
  ): Promise<ActionResult> {
    const session = this.sessions.get(matchId);
    if (!session) return { ok: false, reason: 'match_not_found' };

    const validatedColor: CardColor | undefined =
      chosenColor && VALID_COLORS.has(chosenColor) ? (chosenColor as CardColor) : undefined;

    const result = playCard(
      session.state,
      userId,
      cardId,
      validatedColor,
      targetSeatId,
    );
    if (!result.ok) return result;

    session.state = result.state;
    await this.persistence.saveSnapshot(result.state);
    return { ok: true, events: result.events, state: result.state };
  }

  async handleDraw(matchId: string, userId: string): Promise<ActionResult> {
    const session = this.sessions.get(matchId);
    if (!session) return { ok: false, reason: 'match_not_found' };

    const result = drawCard(session.state, userId);
    if (!result.ok) return result;

    session.state = result.state;
    await this.persistence.saveSnapshot(result.state);
    return { ok: true, events: result.events, state: result.state };
  }

  async handleCallUno(matchId: string, userId: string): Promise<ActionResult> {
    const session = this.sessions.get(matchId);
    if (!session) return { ok: false, reason: 'match_not_found' };

    const result = callUno(session.state, userId);
    if (!result.ok) return result;

    session.state = result.state;
    return { ok: true, events: result.events, state: result.state };
  }

  async handleChallengeWdf(
    matchId: string,
    userId: string,
    decision: 'challenge' | 'accept',
  ): Promise<ActionResult> {
    const session = this.sessions.get(matchId);
    if (!session) return { ok: false, reason: 'match_not_found' };

    const result = challengeWdf(session.state, userId, decision);
    if (!result.ok) return result;

    session.state = result.state;
    await this.persistence.saveSnapshot(result.state);
    return { ok: true, events: result.events, state: result.state };
  }

  async handleSevenSwap(
    matchId: string,
    userId: string,
    targetSeatId: number,
  ): Promise<ActionResult> {
    const session = this.sessions.get(matchId);
    if (!session) return { ok: false, reason: 'match_not_found' };

    const result = sevenSwap(session.state, userId, targetSeatId);
    if (!result.ok) return result;

    session.state = result.state;
    await this.persistence.saveSnapshot(result.state);
    return { ok: true, events: result.events, state: result.state };
  }

  async handleJumpIn(
    matchId: string,
    userId: string,
    cardId: string,
  ): Promise<ActionResult> {
    const session = this.sessions.get(matchId);
    if (!session) return { ok: false, reason: 'match_not_found' };

    const result = jumpIn(session.state, userId, cardId);
    if (!result.ok) return result;

    session.state = result.state;
    await this.persistence.saveSnapshot(result.state);
    return { ok: true, events: result.events, state: result.state };
  }

  // ─── State helpers ────────────────────────────────────────────────────────

  buildPlayerSnapshot(matchId: string, userId: string) {
    const session = this.sessions.get(matchId);
    if (!session) return null;

    const { state } = session;
    const seatId = session.userToSeat.get(userId) ?? null;
    const hand = seatId !== null ? state.private.hands[seatId] ?? [] : [];

    return {
      matchId,
      version: state.version,
      timestamp: Date.now(),
      yourSeatId: seatId,
      publicState: state.public,
      privateHand: seatId !== null ? hand : undefined,
    };
  }

  buildSpectatorSnapshot(matchId: string) {
    const session = this.sessions.get(matchId);
    if (!session) return null;
    const { state } = session;
    return {
      matchId,
      version: state.version,
      timestamp: Date.now(),
      yourSeatId: null,
      publicState: state.public,
    };
  }

  // ─── Heartbeat & failover ─────────────────────────────────────────────────

  private startHeartbeat(session: MatchSession) {
    session.heartbeatInterval = setInterval(async () => {
      await this.persistence.updateHeartbeat(session.matchId, this.instanceId);
    }, 5_000) as unknown as NodeJS.Timer;
  }

  private async reclaimStaleLocks() {
    const stale = await this.persistence.findStaleMatches(30);
    for (const match of stale) {
      if (this.sessions.has(match.id)) continue; // we already own it
      const lockKey = matchLockKey(match.id);
      const acquired = await this.persistence.tryAcquireLock(lockKey);
      if (acquired) {
        this.logger.log(`Reclaimed stale match ${match.id} from ${match.host_instance_id}`);
        await this.loadMatch(match.id);
      }
    }
  }

  async endSession(matchId: string) {
    const session = this.sessions.get(matchId);
    if (!session) return;

    if (session.heartbeatInterval) {
      clearInterval(session.heartbeatInterval as unknown as NodeJS.Timeout);
    }

    const lockKey = matchLockKey(matchId);
    await this.persistence.releaseLock(lockKey);
    this.sessions.delete(matchId);
    this.logger.log(`Match ${matchId} session ended`);
  }
}
