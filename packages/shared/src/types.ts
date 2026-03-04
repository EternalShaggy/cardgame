// ─── Card Types ────────────────────────────────────────────────────────────────

export type CardColor = 'red' | 'green' | 'blue' | 'yellow' | 'wild';

export type CardValue =
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
  | 'skip' | 'reverse' | 'draw_two'
  | 'wild' | 'wild_draw_four'
  | 'wild_shuffle_hands' | 'wild_customizable';

export interface Card {
  id: string;         // unique instance id (e.g. "red_7_a")
  color: CardColor;
  value: CardValue;
}

// ─── Deck Profiles ─────────────────────────────────────────────────────────────

export type DeckProfile = 'classic' | 'modern';

// ─── Ruleset Config ────────────────────────────────────────────────────────────

export interface RulesetConfig {
  version: string;           // e.g. "classic-v1" | "modern-v1"
  deckProfile: DeckProfile;
  scoreTarget: number;       // default 500
  victoryMethod: 'highest_wins' | 'lowest_wins_at_500';
  houseRules: {
    progressive: boolean;          // stacking draw cards
    progressiveMixDraws: boolean;  // allow D2+WD4 stacking
    sevenO: boolean;               // 7=swap, 0=rotate
    jumpIn: boolean;               // exact same card out of turn
  };
  turnTimeoutSeconds: number;      // 0 = no timer
  allowSpectators: boolean;
  customWildRule?: string;         // for wild_customizable
}

export const DEFAULT_RULESET: RulesetConfig = {
  version: 'classic-v1',
  deckProfile: 'classic',
  scoreTarget: 500,
  victoryMethod: 'highest_wins',
  houseRules: {
    progressive: false,
    progressiveMixDraws: false,
    sevenO: false,
    jumpIn: false,
  },
  turnTimeoutSeconds: 60,
  allowSpectators: true,
};

// ─── Match State ───────────────────────────────────────────────────────────────

export type Direction = 1 | -1;

export type PendingActionType =
  | 'choose_color'           // after playing wild
  | 'challenge_wdf'          // next player must decide to challenge or draw4
  | 'seven_swap'             // after playing 7, choose who to swap with
  | 'vote_skip_replace';     // vote to skip/replace disconnected player

export interface PendingAction {
  type: PendingActionType;
  actorSeatId: number;       // who triggered it
  targetSeatId?: number;     // for challenge_wdf: who must respond
  accumulatedDraw?: number;  // for progressive stacking
  options?: string[];        // e.g. available colors
}

export interface SeatPublic {
  seatId: number;
  userId: string;
  displayName: string;
  avatarUrl?: string;
  handCount: number;
  calledUno: boolean;
  connected: boolean;
  disconnectedAt?: number;   // timestamp if disconnected
  role: 'player' | 'spectator';
  score: number;
}

export interface PublicMatchState {
  status: 'waiting' | 'active' | 'ended';
  currentTurn: number;       // seatId whose turn it is
  direction: Direction;
  topCard: Card;
  activeColor: CardColor;    // may differ from topCard.color after wild
  drawPileCount: number;
  discardPileCount: number;
  seats: SeatPublic[];
  scores: Record<string, number>;  // userId -> cumulative score
  pendingAction: PendingAction | null;
  rulesetConfig: RulesetConfig;
  roundNumber: number;
  winner?: string;            // userId of match winner
}

// ─── Server-side private state (never sent to clients raw) ──────────────────

export interface PrivateMatchState {
  hands: Record<number, Card[]>;   // seatId -> cards
  drawPile: Card[];
  discardPile: Card[];
  unoCalledBy: Set<number>;        // seats that have called uno
}

export interface FullMatchState {
  matchId: string;
  version: number;
  public: PublicMatchState;
  private: PrivateMatchState;
}

// ─── Scoring ───────────────────────────────────────────────────────────────────

export function cardPoints(card: Card): number {
  switch (card.value) {
    case 'wild':
    case 'wild_draw_four':
    case 'wild_shuffle_hands':
    case 'wild_customizable':
      return 50;
    case 'skip':
    case 'reverse':
    case 'draw_two':
      return 20;
    default:
      return parseInt(card.value, 10);
  }
}

// ─── Lobby ────────────────────────────────────────────────────────────────────

export type LobbyStatus = 'open' | 'starting' | 'in_match' | 'closed';

export interface LobbyMember {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  role: 'host' | 'player' | 'spectator';
  isReady: boolean;
  joinedAt: string;
}

export interface Lobby {
  id: string;
  joinCode: string;
  hostUserId: string;
  maxPlayers: number;
  isPublic: boolean;
  allowSpectators: boolean;
  rulesetConfig: RulesetConfig;
  status: LobbyStatus;
  members: LobbyMember[];
  createdAt: string;
}

// ─── User Profile ─────────────────────────────────────────────────────────────

export interface UserProfile {
  id: string;
  displayName: string;
  avatarUrl?: string;
  createdAt: string;
}

// ─── Match Result ─────────────────────────────────────────────────────────────

export interface MatchResult {
  matchId: string;
  winner: string;
  finalScores: Record<string, number>;
  rulesetConfig: RulesetConfig;
  startedAt: string;
  endedAt: string;
  rounds: number;
}
