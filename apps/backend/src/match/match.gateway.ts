/**
 * GameGateway – WebSocket gateway for all real-time match communication.
 * Uses the native `ws` adapter for performance.
 */

import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, WebSocket } from 'ws';
import { parse as parseUrl } from 'url';
import { TicketService } from '../auth/ticket.service';
import { MatchService } from './match.service';
import { PersistenceService } from '../persistence/persistence.service';
import {
  ClientMessage,
  MsgActionAck,
  MsgMatchSnapshot,
  MsgMatchError,
  MsgPresenceUpdate,
  MsgChatMessage,
} from '@wholet/shared';

interface ConnectedClient {
  ws: WebSocket;
  userId: string;
  clientId: string;
  matchId?: string;
  seatId?: number;
  isSpectator: boolean;
}

@WebSocketGateway({ path: '/ws' })
export class MatchGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(MatchGateway.name);
  // clientId → ConnectedClient
  private readonly clients = new Map<string, ConnectedClient>();
  // matchId → Set<clientId>
  private readonly matchClients = new Map<string, Set<string>>();

  // Rate limiting: userId → last action timestamps
  private readonly actionLog = new Map<string, number[]>();
  private readonly RATE_LIMIT = 20; // max actions per 10s window

  constructor(
    private readonly tickets: TicketService,
    private readonly matchService: MatchService,
    private readonly persistence: PersistenceService,
  ) {}

  // ─── Connection lifecycle ─────────────────────────────────────────────────

  async handleConnection(ws: WebSocket, request: any) {
    const { query } = parseUrl(request.url ?? '', true);
    const ticketToken = query['ticket'] as string | undefined;

    if (!ticketToken) {
      ws.close(4001, 'Missing ticket');
      return;
    }

    const userId = this.tickets.validateAndConsume(ticketToken);
    if (!userId) {
      ws.close(4002, 'Invalid or expired ticket');
      return;
    }

    const clientId = `${userId}-${Date.now()}`;
    const client: ConnectedClient = { ws, userId, clientId, isSpectator: false };
    this.clients.set(clientId, client);
    (ws as any).__clientId = clientId;

    this.send(ws, { type: 'connection.established', clientId, userId });
    this.logger.log(`Client connected: ${clientId}`);

    ws.on('message', (raw: Buffer) => this.handleMessage(clientId, raw));
  }

  handleDisconnect(ws: WebSocket) {
    const clientId = (ws as any).__clientId as string | undefined;
    if (!clientId) return;

    const client = this.clients.get(clientId);
    if (client?.matchId) {
      this.handlePlayerDisconnect(client);
    }

    this.clients.delete(clientId);
    this.logger.log(`Client disconnected: ${clientId}`);
  }

  // ─── Message routing ──────────────────────────────────────────────────────

  private async handleMessage(clientId: string, raw: Buffer) {
    const client = this.clients.get(clientId);
    if (!client) return;

    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      this.sendError(client.ws, 'parse_error', 'Invalid JSON');
      return;
    }

    // Rate limit
    if (this.isRateLimited(client.userId)) {
      this.sendError(client.ws, 'rate_limited', 'Too many actions');
      return;
    }

    try {
      switch (msg.type) {
        case 'match.join':
          await this.handleMatchJoin(client, msg.matchId, msg.lastKnownVersion);
          break;
        case 'action.play_card':
          await this.handlePlayCard(client, msg);
          break;
        case 'action.draw':
          await this.handleDraw(client, msg);
          break;
        case 'action.call_uno':
          await this.handleCallUno(client, msg);
          break;
        case 'action.challenge_wdf':
          await this.handleChallengeWdf(client, msg);
          break;
        case 'action.jump_in':
          await this.handleJumpIn(client, msg);
          break;
        case 'action.vote_skip_replace': {
          // Vote is recorded; when majority reached the server auto-skips the disconnected turn
          const session = this.matchService.getSession(msg.matchId);
          if (session) {
            session.voteSkipVotes.add(client.userId);
            const playerCount = session.state.public.seats.filter(s => s.role === 'player').length;
            const majority = Math.ceil(playerCount / 2);
            if (session.voteSkipVotes.size >= majority) {
              // Skip the disconnected player's turn
              const result = await this.matchService.handleDraw(msg.matchId, session.seatToUser.get(session.state.public.currentTurn) ?? '');
              if (result.ok) {
                session.voteSkipVotes.clear();
                this.broadcastStateUpdate(msg.matchId, result.state);
              }
            }
          }
          break;
        }
        case 'match.request_snapshot':
          await this.sendSnapshot(client, msg.matchId);
          break;
        case 'chat.send':
          await this.handleChat(client, msg);
          break;
        default:
          this.sendError(client.ws, 'unknown_type', `Unknown message type`);
      }
    } catch (err) {
      this.logger.error(`Error handling message for ${clientId}:`, err);
      this.sendError(client.ws, 'server_error', 'Internal server error');
    }
  }

  // ─── Match join / snapshot ────────────────────────────────────────────────

  private async handleMatchJoin(
    client: ConnectedClient,
    matchId: string,
    lastKnownVersion?: number,
  ) {
    // Verify the user is a participant
    const isMember = await this.persistence.isMatchParticipant(matchId, client.userId);
    let isSpectator = false;

    if (!isMember) {
      // Check if spectators are allowed
      const session = this.matchService.getSession(matchId);
      if (!session?.state.public.rulesetConfig.allowSpectators) {
        this.sendError(client.ws, 'not_in_match', 'You are not a participant');
        return;
      }
      isSpectator = true;
    }

    // Register client to match room
    client.matchId = matchId;
    client.isSpectator = isSpectator;

    let room = this.matchClients.get(matchId);
    if (!room) {
      room = new Set();
      this.matchClients.set(matchId, room);
    }
    room.add(client.clientId);

    // Load or get match session
    let session = this.matchService.getSession(matchId);
    if (!session) {
      const state = await this.matchService.loadMatch(matchId);
      if (!state) {
        this.sendError(client.ws, 'match_not_found', 'Match not found');
        return;
      }
      session = this.matchService.getSession(matchId)!;
    }

    client.seatId = session.userToSeat.get(client.userId);

    // Send snapshot (full resync)
    await this.sendSnapshot(client, matchId, true);

    // Notify others of reconnection
    this.broadcastPresence(matchId);
  }

  private async sendSnapshot(
    client: ConnectedClient,
    matchId: string,
    reconnected = false,
  ) {
    const snap = client.isSpectator
      ? this.matchService.buildSpectatorSnapshot(matchId)
      : this.matchService.buildPlayerSnapshot(matchId, client.userId);

    if (!snap) {
      this.sendError(client.ws, 'match_not_found', 'Match not found');
      return;
    }

    this.send(client.ws, {
      type: 'match.snapshot',
      ...snap,
      reconnected,
    } as MsgMatchSnapshot);
  }

  // ─── Action handlers ──────────────────────────────────────────────────────

  private async handlePlayCard(client: ConnectedClient, msg: any) {
    const result = await this.matchService.handlePlayCard(
      msg.matchId,
      client.userId,
      msg.cardId,
      msg.chosenColor,
      msg.targetSeatId,
    );

    this.send(client.ws, {
      type: 'action.ack',
      clientActionId: msg.clientActionId,
      accepted: result.ok,
      reason: result.ok ? undefined : result.reason,
      newVersion: result.ok ? result.state.version : undefined,
    } as MsgActionAck);

    if (result.ok) {
      this.broadcastStateUpdate(msg.matchId, result.state);
    }
  }

  private async handleDraw(client: ConnectedClient, msg: any) {
    const result = await this.matchService.handleDraw(msg.matchId, client.userId);

    this.send(client.ws, {
      type: 'action.ack',
      clientActionId: msg.clientActionId,
      accepted: result.ok,
      reason: result.ok ? undefined : result.reason,
      newVersion: result.ok ? result.state.version : undefined,
    } as MsgActionAck);

    if (result.ok) {
      this.broadcastStateUpdate(msg.matchId, result.state);
    }
  }

  private async handleCallUno(client: ConnectedClient, msg: any) {
    const result = await this.matchService.handleCallUno(msg.matchId, client.userId);

    this.send(client.ws, {
      type: 'action.ack',
      clientActionId: msg.clientActionId,
      accepted: result.ok,
      reason: result.ok ? undefined : result.reason,
      newVersion: result.ok ? result.state.version : undefined,
    } as MsgActionAck);

    if (result.ok) {
      this.broadcastStateUpdate(msg.matchId, result.state);
    }
  }

  private async handleChallengeWdf(client: ConnectedClient, msg: any) {
    const result = await this.matchService.handleChallengeWdf(
      msg.matchId,
      client.userId,
      msg.decision,
    );

    this.send(client.ws, {
      type: 'action.ack',
      clientActionId: msg.clientActionId,
      accepted: result.ok,
      reason: result.ok ? undefined : result.reason,
      newVersion: result.ok ? result.state.version : undefined,
    } as MsgActionAck);

    if (result.ok) {
      this.broadcastStateUpdate(msg.matchId, result.state);
    }
  }

  private async handleJumpIn(client: ConnectedClient, msg: any) {
    const result = await this.matchService.handleJumpIn(
      msg.matchId,
      client.userId,
      msg.cardId,
    );

    this.send(client.ws, {
      type: 'action.ack',
      clientActionId: msg.clientActionId,
      accepted: result.ok,
      reason: result.ok ? undefined : result.reason,
      newVersion: result.ok ? result.state.version : undefined,
    } as MsgActionAck);

    if (result.ok) {
      this.broadcastStateUpdate(msg.matchId, result.state);
    }
  }

  // ─── Broadcast helpers ────────────────────────────────────────────────────

  private broadcastStateUpdate(matchId: string, state: any) {
    const room = this.matchClients.get(matchId);
    if (!room) return;

    if (state.public?.status === 'ended') {
      this.broadcastToRoom(matchId, {
        type: 'match.ended',
        matchId,
        winner: state.public.winner,
        finalScores: state.public.scores,
        version: state.version,
      });
      this.matchService.endSession(matchId);
      return;
    }

    for (const clientId of room) {
      const client = this.clients.get(clientId);
      if (!client || client.ws.readyState !== WebSocket.OPEN) continue;

      const snap = client.isSpectator
        ? this.matchService.buildSpectatorSnapshot(matchId)
        : this.matchService.buildPlayerSnapshot(matchId, client.userId);

      if (snap) {
        this.send(client.ws, { type: 'match.snapshot', ...snap } as MsgMatchSnapshot);
      }
    }
  }

  broadcastToRoom(matchId: string, msg: Record<string, unknown>) {
    const room = this.matchClients.get(matchId);
    if (!room) return;
    for (const clientId of room) {
      const client = this.clients.get(clientId);
      if (client?.ws.readyState === WebSocket.OPEN) {
        this.send(client.ws, msg);
      }
    }
  }

  private broadcastPresence(matchId: string) {
    const session = this.matchService.getSession(matchId);
    if (!session) return;

    const room = this.matchClients.get(matchId) ?? new Set();
    const connectedUserIds = new Set(
      [...room].map((id) => this.clients.get(id)?.userId).filter(Boolean),
    );

    const seats = session.state.public.seats.map((s) => ({
      seatId: s.seatId,
      connected: connectedUserIds.has(s.userId),
    }));

    this.broadcastToRoom(matchId, {
      type: 'presence.update',
      matchId,
      seats,
    } as unknown as Record<string, unknown>);
  }

  // ─── Chat ─────────────────────────────────────────────────────────────────

  private async handleChat(client: ConnectedClient, msg: any) {
    const matchId = msg.matchId ?? client.matchId;
    if (!matchId) return;

    const profile = await this.persistence.getProfile(client.userId);

    const chatMsg = {
      type: 'chat.message',
      id: `${Date.now()}-${client.clientId}`,
      scope: 'match',
      fromUserId: client.userId,
      displayName: profile?.display_name ?? 'Unknown',
      message: (msg.message as string).slice(0, 500),
      createdAt: new Date().toISOString(),
    } as MsgChatMessage;

    this.broadcastToRoom(matchId, chatMsg as unknown as Record<string, unknown>);

    // Persist to DB
    await this.persistence.db.from('chat_messages').insert({
      scope: 'match',
      match_id: matchId,
      user_id: client.userId,
      message: chatMsg.message,
    });
  }

  // ─── Disconnection handling ───────────────────────────────────────────────

  private handlePlayerDisconnect(client: ConnectedClient) {
    const { matchId, userId } = client;
    if (!matchId) return;

    // Remove from room
    this.matchClients.get(matchId)?.delete(client.clientId);
    this.persistence.markPlayerDisconnected(matchId, userId);

    this.broadcastPresence(matchId);
    this.logger.log(`Player ${userId} disconnected from match ${matchId}`);

    // Reconnection grace window timer is managed server-side
  }

  // ─── Rate limiting ────────────────────────────────────────────────────────

  private isRateLimited(userId: string): boolean {
    const now = Date.now();
    const window = 10_000;
    const log = this.actionLog.get(userId) ?? [];
    const recent = log.filter((t) => now - t < window);
    recent.push(now);
    this.actionLog.set(userId, recent);
    return recent.length > this.RATE_LIMIT;
  }

  // ─── Utilities ────────────────────────────────────────────────────────────

  private send(ws: WebSocket, msg: Record<string, unknown>) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  private sendError(ws: WebSocket, code: string, message: string) {
    this.send(ws, { type: 'match.error', code, message } as unknown as Record<string, unknown>);
  }

  // Public method used by lobby to push clients into a new match
  notifyMatchStarted(matchId: string, lobbyClientIds: string[]) {
    for (const clientId of lobbyClientIds) {
      const client = this.clients.get(clientId);
      if (client) {
        this.send(client.ws, {
          type: 'match.started',
          matchId,
        });
      }
    }
  }
}
