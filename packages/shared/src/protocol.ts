// ─── WebSocket Protocol Messages ──────────────────────────────────────────────
// All messages are JSON-encoded. Clients send "intents," server sends state.

import type { Card, CardColor, PublicMatchState } from './types';

// ─── Client → Server ──────────────────────────────────────────────────────────

export interface MsgMatchJoin {
  type: 'match.join';
  matchId: string;
  lastKnownVersion?: number;
}

export interface MsgActionPlayCard {
  type: 'action.play_card';
  clientActionId: string;
  matchId: string;
  cardId: string;
  chosenColor?: CardColor;    // required when playing wild
  targetSeatId?: number;      // required for seven_swap
}

export interface MsgActionDraw {
  type: 'action.draw';
  clientActionId: string;
  matchId: string;
}

export interface MsgActionCallUno {
  type: 'action.call_uno';
  clientActionId: string;
  matchId: string;
}

export interface MsgActionChallengeWdf {
  type: 'action.challenge_wdf';
  clientActionId: string;
  matchId: string;
  decision: 'challenge' | 'accept';  // accept = draw the 4 cards
}

export interface MsgActionJumpIn {
  type: 'action.jump_in';
  clientActionId: string;
  matchId: string;
  cardId: string;
}

export interface MsgActionVoteSkip {
  type: 'action.vote_skip_replace';
  clientActionId: string;
  matchId: string;
  vote: 'skip' | 'replace_ai';
}

export interface MsgChatSend {
  type: 'chat.send';
  matchId?: string;
  lobbyId?: string;
  message: string;
}

export interface MsgRequestSnapshot {
  type: 'match.request_snapshot';
  matchId: string;
  reason: string;
}

export type ClientMessage =
  | MsgMatchJoin
  | MsgActionPlayCard
  | MsgActionDraw
  | MsgActionCallUno
  | MsgActionChallengeWdf
  | MsgActionJumpIn
  | MsgActionVoteSkip
  | MsgChatSend
  | MsgRequestSnapshot;

// ─── Server → Client ──────────────────────────────────────────────────────────

export interface MsgConnectionEstablished {
  type: 'connection.established';
  clientId: string;
  userId: string;
}

export interface MsgMatchSnapshot {
  type: 'match.snapshot';
  matchId: string;
  version: number;
  timestamp: number;
  yourSeatId: number | null;    // null for spectators
  publicState: PublicMatchState;
  privateHand?: Card[];         // only for the receiving player
  reconnected?: boolean;
  recovered?: boolean;
}

export interface DeltaOp {
  op: 'set' | 'increment' | 'push' | 'remove';
  path: string;
  value?: unknown;
  predicate?: Record<string, unknown>;
  index?: number;
}

export interface MsgMatchDelta {
  type: 'match.delta';
  matchId: string;
  fromVersion: number;
  toVersion: number;
  timestamp: number;
  ops: DeltaOp[];
}

export interface MsgMatchPrivateDelta {
  type: 'match.private_delta';
  matchId: string;
  fromVersion: number;
  toVersion: number;
  ops: DeltaOp[];
}

export interface MsgActionAck {
  type: 'action.ack';
  clientActionId: string;
  accepted: boolean;
  reason?: string;
  newVersion?: number;
}

export interface MsgMatchError {
  type: 'match.error';
  code: string;
  message: string;
}

export interface MsgPresenceUpdate {
  type: 'presence.update';
  matchId: string;
  seats: Array<{ seatId: number; connected: boolean; disconnectedAt?: number }>;
}

export interface MsgChatMessage {
  type: 'chat.message';
  id: string;
  scope: 'lobby' | 'match';
  fromUserId: string;
  displayName: string;
  message: string;
  createdAt: string;
}

export interface MsgMatchEnded {
  type: 'match.ended';
  matchId: string;
  winner: string;
  finalScores: Record<string, number>;
  version: number;
}

export interface MsgRedirect {
  type: 'redirect';
  hostUrl: string;
  reason: string;
}

export interface MsgReconnectionStatus {
  type: 'reconnection.status';
  matchId: string;
  disconnectedSeatId: number;
  secondsElapsed: number;
  phase: 'reconnecting' | 'grace' | 'warning' | 'abandoned';
  voteRequired?: boolean;
  votesFor: number;
  votesNeeded: number;
}

export type ServerMessage =
  | MsgConnectionEstablished
  | MsgMatchSnapshot
  | MsgMatchDelta
  | MsgMatchPrivateDelta
  | MsgActionAck
  | MsgMatchError
  | MsgPresenceUpdate
  | MsgChatMessage
  | MsgMatchEnded
  | MsgRedirect
  | MsgReconnectionStatus;

// ─── Error Codes ──────────────────────────────────────────────────────────────

export const ErrorCodes = {
  NOT_YOUR_TURN: 'not_your_turn',
  CARD_NOT_PLAYABLE: 'card_not_playable',
  CARD_NOT_IN_HAND: 'card_not_in_hand',
  STATE_MISMATCH: 'state_mismatch',
  STALE_VERSION: 'stale_version',
  PENDING_ACTION_REQUIRED: 'pending_action_required',
  WDF_NOT_LEGAL: 'wdf_not_legal',
  JUMP_IN_NOT_LEGAL: 'jump_in_not_legal',
  MATCH_NOT_FOUND: 'match_not_found',
  NOT_IN_MATCH: 'not_in_match',
  MATCH_ENDED: 'match_ended',
  RATE_LIMITED: 'rate_limited',
} as const;
