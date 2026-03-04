/**
 * Wholet Rule Engine – Deterministic reducer
 * All public methods are pure functions; no I/O.
 */

import {
  Card,
  CardColor,
  FullMatchState,
  PublicMatchState,
  PrivateMatchState,
  RulesetConfig,
  PendingAction,
  SeatPublic,
  cardPoints,
  Direction,
} from '@wholet/shared';
import { buildDeck, shuffle, dealHands, drawFirstDiscard, reshuffleDiscard } from './deck';
import { v4 as uuidv4 } from 'uuid';

// ─── Action results ────────────────────────────────────────────────────────────

export type RuleResult =
  | { ok: true; state: FullMatchState; events: GameEvent[] }
  | { ok: false; reason: string };

export interface GameEvent {
  type: string;
  data: Record<string, unknown>;
}

// ─── Initialise a new match ───────────────────────────────────────────────────

export interface MatchInitOptions {
  matchId: string;
  seats: Array<{ seatId: number; userId: string; displayName: string; avatarUrl?: string }>;
  ruleset: RulesetConfig;
  scores?: Record<string, number>; // carry-over from prior rounds
}

export function initMatch(opts: MatchInitOptions): FullMatchState {
  const deck = shuffle(buildDeck(opts.ruleset.deckProfile));
  const seatIds = opts.seats.filter((s) => s).map((s) => s.seatId);
  const { hands, remainingDeck } = dealHands(deck, seatIds);
  const { card: firstDiscard, remainingDeck: drawPile } = drawFirstDiscard(remainingDeck);

  const seats: SeatPublic[] = opts.seats.map((s) => ({
    seatId: s.seatId,
    userId: s.userId,
    displayName: s.displayName,
    avatarUrl: s.avatarUrl,
    handCount: 7,
    calledUno: false,
    connected: true,
    role: 'player',
    score: opts.scores?.[s.userId] ?? 0,
  }));

  const pub: PublicMatchState = {
    status: 'active',
    currentTurn: seatIds[0]!,
    direction: 1,
    topCard: firstDiscard,
    activeColor: firstDiscard.color as CardColor,
    drawPileCount: drawPile.length,
    discardPileCount: 1,
    seats,
    scores: opts.scores ?? Object.fromEntries(opts.seats.map((s) => [s.userId, 0])),
    pendingAction: null,
    rulesetConfig: opts.ruleset,
    roundNumber: 1,
  };

  // If first discard is an action card, apply it immediately
  applyFirstDiscardEffect(pub, firstDiscard);

  const priv: PrivateMatchState = {
    hands,
    drawPile,
    discardPile: [firstDiscard],
    unoCalledBy: new Set(),
  };

  return { matchId: opts.matchId, version: 1, public: pub, private: priv };
}

// ─── Playability ──────────────────────────────────────────────────────────────

export function isPlayable(card: Card, top: Card, activeColor: CardColor, ruleset: RulesetConfig, pendingAction: PendingAction | null): boolean {
  // Wild cards are always playable (unless WD4 illegal)
  if (card.color === 'wild') return true;

  // Must match active color, top card value, or same type
  return card.color === activeColor || card.value === top.value;
}

export function isWd4Legal(hand: Card[], activeColor: CardColor): boolean {
  // WD4 is only legal when you have no card matching the active color
  return !hand.some((c) => c.color === activeColor);
}

// ─── Main turn actions ────────────────────────────────────────────────────────

export function playCard(
  state: FullMatchState,
  actorUserId: string,
  cardId: string,
  chosenColor?: CardColor,
  targetSeatId?: number,
): RuleResult {
  const { pub, priv } = cloneState(state);
  const events: GameEvent[] = [];

  // Validate turn
  const actorSeat = pub.seats.find((s) => s.userId === actorUserId);
  if (!actorSeat) return fail('not_in_match');
  if (actorSeat.seatId !== pub.currentTurn) return fail('not_your_turn');
  if (pub.pendingAction && pub.pendingAction.type !== 'choose_color') return fail('pending_action_required');
  if (pub.status !== 'active') return fail('match_ended');

  const hand = priv.hands[actorSeat.seatId]!;
  const cardIdx = hand.findIndex((c) => c.id === cardId);
  if (cardIdx === -1) return fail('card_not_in_hand');
  const card = hand[cardIdx]!;

  // Validate playability
  if (!isPlayable(card, pub.topCard, pub.activeColor, pub.rulesetConfig, pub.pendingAction)) {
    return fail('card_not_playable');
  }

  // WD4 legality check
  if (card.value === 'wild_draw_four' && !isWd4Legal(hand, pub.activeColor)) {
    return fail('wdf_not_legal');
  }

  // Remove card from hand
  hand.splice(cardIdx, 1);
  priv.hands[actorSeat.seatId] = hand;

  // Update discard pile
  priv.discardPile.push(card);
  pub.topCard = card;
  pub.discardPileCount = priv.discardPile.length;

  // Update hand count
  const seatPub = pub.seats.find((s) => s.seatId === actorSeat.seatId)!;
  seatPub.handCount = hand.length;
  seatPub.calledUno = false;

  events.push({ type: 'card_played', data: { seatId: actorSeat.seatId, card, handCount: hand.length } });

  // ─── House rule: Seven-O ───────────────────────────────────────────────
  if (pub.rulesetConfig.houseRules.sevenO) {
    if (card.value === '7') {
      // Actor chooses who to swap with
      pub.pendingAction = {
        type: 'seven_swap',
        actorSeatId: actorSeat.seatId,
        options: pub.seats
          .filter((s) => s.seatId !== actorSeat.seatId && s.role === 'player')
          .map((s) => s.seatId.toString()),
      };
      pub.activeColor = card.color as CardColor;
      return ok({ ...state, public: pub, private: priv, version: state.version + 1 }, events);
    }
    if (card.value === '0') {
      // All players pass hands in current direction
      performZeroRotate(pub, priv);
      events.push({ type: 'hands_rotated', data: {} });
      // After zero, apply color and advance turn
    }
  }

  // ─── Apply card effect ─────────────────────────────────────────────────
  return applyCardEffect(
    { ...state, public: pub, private: priv, version: state.version + 1 },
    actorSeat.seatId,
    card,
    chosenColor,
    events,
  );
}

export function drawCard(
  state: FullMatchState,
  actorUserId: string,
): RuleResult {
  const { pub, priv } = cloneState(state);
  const events: GameEvent[] = [];

  const actorSeat = pub.seats.find((s) => s.userId === actorUserId);
  if (!actorSeat) return fail('not_in_match');
  if (actorSeat.seatId !== pub.currentTurn) return fail('not_your_turn');
  if (pub.pendingAction) return fail('pending_action_required');
  if (pub.status !== 'active') return fail('match_ended');

  // Draw one card; reshuffle if needed
  const drawn = drawCards(priv, pub, 1);
  if (drawn.length === 0) return fail('deck_empty');

  const hand = priv.hands[actorSeat.seatId]!;
  hand.push(...drawn);
  priv.hands[actorSeat.seatId] = hand;

  const seatPub = pub.seats.find((s) => s.seatId === actorSeat.seatId)!;
  seatPub.handCount = hand.length;
  seatPub.calledUno = false;

  events.push({ type: 'card_drawn', data: { seatId: actorSeat.seatId, count: 1 } });

  // Advance turn (drawn card NOT playable from hand in classic rules unless it's an immediate play)
  advanceTurn(pub);

  return ok({ ...state, public: pub, private: priv, version: state.version + 1 }, events);
}

export function callUno(
  state: FullMatchState,
  actorUserId: string,
): RuleResult {
  const { pub, priv } = cloneState(state);

  const actorSeat = pub.seats.find((s) => s.userId === actorUserId);
  if (!actorSeat) return fail('not_in_match');
  if (pub.status !== 'active') return fail('match_ended');

  const hand = priv.hands[actorSeat.seatId]!;
  if (hand.length !== 1) return fail('not_on_one_card');

  const seatPub = pub.seats.find((s) => s.seatId === actorSeat.seatId)!;
  seatPub.calledUno = true;
  priv.unoCalledBy.add(actorSeat.seatId);

  return ok({ ...state, public: pub, private: priv, version: state.version + 1 }, [
    { type: 'uno_called', data: { seatId: actorSeat.seatId } },
  ]);
}

export function challengeWdf(
  state: FullMatchState,
  actorUserId: string,
  decision: 'challenge' | 'accept',
): RuleResult {
  const { pub, priv } = cloneState(state);
  const events: GameEvent[] = [];

  if (pub.pendingAction?.type !== 'challenge_wdf') return fail('no_pending_challenge');

  const actorSeat = pub.seats.find((s) => s.userId === actorUserId);
  if (!actorSeat) return fail('not_in_match');
  if (actorSeat.seatId !== pub.pendingAction.targetSeatId) return fail('not_your_turn');

  const { actorSeatId: wdfPlayerId, accumulatedDraw = 4 } = pub.pendingAction;

  if (decision === 'challenge') {
    // Check if WD4 player had a legal color match
    const wdfPlayerHand = priv.hands[wdfPlayerId]!;
    const hadMatch = wdfPlayerHand.some((c) => c.color === pub.activeColor);

    if (hadMatch) {
      // Challenge successful: WD4 player draws 4 cards instead
      const drawn = drawCards(priv, pub, 4);
      const wdfHand = priv.hands[wdfPlayerId]!;
      wdfHand.push(...drawn);
      priv.hands[wdfPlayerId] = wdfHand;
      pub.seats.find((s) => s.seatId === wdfPlayerId)!.handCount = wdfHand.length;
      events.push({ type: 'challenge_won', data: { challengerSeatId: actorSeat.seatId, penaltyTo: wdfPlayerId } });
    } else {
      // Challenge failed: challenger draws 6 cards (4 + 2 penalty)
      const drawn = drawCards(priv, pub, 6);
      const hand = priv.hands[actorSeat.seatId]!;
      hand.push(...drawn);
      priv.hands[actorSeat.seatId] = hand;
      pub.seats.find((s) => s.seatId === actorSeat.seatId)!.handCount = hand.length;
      events.push({ type: 'challenge_lost', data: { challengerSeatId: actorSeat.seatId } });
    }
  } else {
    // Accept: draw accumulated cards
    const drawn = drawCards(priv, pub, accumulatedDraw);
    const hand = priv.hands[actorSeat.seatId]!;
    hand.push(...drawn);
    priv.hands[actorSeat.seatId] = hand;
    pub.seats.find((s) => s.seatId === actorSeat.seatId)!.handCount = hand.length;
    events.push({ type: 'drew_cards', data: { seatId: actorSeat.seatId, count: accumulatedDraw } });
  }

  pub.pendingAction = null;
  advanceTurn(pub);

  return ok({ ...state, public: pub, private: priv, version: state.version + 1 }, events);
}

export function sevenSwap(
  state: FullMatchState,
  actorUserId: string,
  targetSeatId: number,
): RuleResult {
  const { pub, priv } = cloneState(state);

  if (pub.pendingAction?.type !== 'seven_swap') return fail('no_pending_swap');

  const actorSeat = pub.seats.find((s) => s.userId === actorUserId);
  if (!actorSeat) return fail('not_in_match');
  if (actorSeat.seatId !== pub.pendingAction.actorSeatId) return fail('not_your_turn');

  const targetSeat = pub.seats.find((s) => s.seatId === targetSeatId);
  if (!targetSeat || targetSeat.role !== 'player') return fail('invalid_target');

  // Swap hands
  const actorHand = priv.hands[actorSeat.seatId]!;
  const targetHand = priv.hands[targetSeatId]!;
  priv.hands[actorSeat.seatId] = targetHand;
  priv.hands[targetSeatId] = actorHand;

  pub.seats.find((s) => s.seatId === actorSeat.seatId)!.handCount = targetHand.length;
  pub.seats.find((s) => s.seatId === targetSeatId)!.handCount = actorHand.length;

  pub.pendingAction = null;
  advanceTurn(pub);

  return ok({ ...state, public: pub, private: priv, version: state.version + 1 }, [
    { type: 'hands_swapped', data: { seatA: actorSeat.seatId, seatB: targetSeatId } },
  ]);
}

export function jumpIn(
  state: FullMatchState,
  actorUserId: string,
  cardId: string,
): RuleResult {
  if (!state.public.rulesetConfig.houseRules.jumpIn) return fail('jump_in_not_enabled');
  if (state.public.pendingAction) return fail('jump_in_not_legal');

  const { pub, priv } = cloneState(state);
  const events: GameEvent[] = [];

  const actorSeat = pub.seats.find((s) => s.userId === actorUserId);
  if (!actorSeat) return fail('not_in_match');

  const hand = priv.hands[actorSeat.seatId]!;
  const cardIdx = hand.findIndex((c) => c.id === cardId);
  if (cardIdx === -1) return fail('card_not_in_hand');
  const card = hand[cardIdx]!;

  // Must be exact match (color AND value) with top card
  const top = pub.topCard;
  if (card.color !== top.color || card.value !== top.value || card.color === 'wild') {
    return fail('jump_in_not_legal');
  }

  // Remove from hand
  hand.splice(cardIdx, 1);
  priv.hands[actorSeat.seatId] = hand;
  priv.discardPile.push(card);
  pub.topCard = card;
  pub.discardPileCount = priv.discardPile.length;

  // Turn order now continues from the jumper
  pub.currentTurn = actorSeat.seatId;
  const seatPub = pub.seats.find((s) => s.seatId === actorSeat.seatId)!;
  seatPub.handCount = hand.length;
  seatPub.calledUno = false;

  events.push({ type: 'jumped_in', data: { seatId: actorSeat.seatId, card } });

  return applyCardEffect(
    { ...state, public: pub, private: priv, version: state.version + 1 },
    actorSeat.seatId,
    card,
    undefined,
    events,
  );
}

// ─── UNO penalty (called by timer or opponent catch) ─────────────────────────

export function penaliseForUno(
  state: FullMatchState,
  targetSeatId: number,
): RuleResult {
  const { pub, priv } = cloneState(state);

  const seat = pub.seats.find((s) => s.seatId === targetSeatId);
  if (!seat) return fail('seat_not_found');

  const hand = priv.hands[targetSeatId]!;
  if (hand.length !== 1) return fail('not_penalisable');
  if (priv.unoCalledBy.has(targetSeatId)) return fail('already_called_uno');

  const drawn = drawCards(priv, pub, 2);
  hand.push(...drawn);
  priv.hands[targetSeatId] = hand;
  seat.handCount = hand.length;

  return ok({ ...state, public: pub, private: priv, version: state.version + 1 }, [
    { type: 'uno_penalty', data: { seatId: targetSeatId } },
  ]);
}

// ─── End-of-round scoring ─────────────────────────────────────────────────────

export function scoreRound(state: FullMatchState, winnerSeatId: number): FullMatchState {
  const { pub, priv } = cloneState(state);

  // Sum all other players' hands
  let roundPoints = 0;
  for (const [seatStr, hand] of Object.entries(priv.hands)) {
    const seatId = parseInt(seatStr, 10);
    if (seatId === winnerSeatId) continue;

    // If the last card was a draw-two/WD4, the penalised player draws first
    // (those cards are already in their hand at this point)
    for (const card of hand) {
      roundPoints += cardPoints(card);
    }
  }

  const winnerSeat = pub.seats.find((s) => s.seatId === winnerSeatId)!;
  const winnerUserId = winnerSeat.userId;

  pub.scores[winnerUserId] = (pub.scores[winnerUserId] ?? 0) + roundPoints;

  // Check for match win
  const winThreshold = pub.rulesetConfig.scoreTarget;
  const matchWinner = Object.entries(pub.scores).find(
    ([, score]) => score >= winThreshold,
  );

  if (matchWinner) {
    pub.status = 'ended';
    pub.winner = matchWinner[0];
  }

  return { ...state, public: pub, private: priv };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function applyCardEffect(
  state: FullMatchState,
  actorSeatId: number,
  card: Card,
  chosenColor: CardColor | undefined,
  events: GameEvent[],
): RuleResult {
  const { pub, priv } = cloneState(state);
  const ruleset = pub.rulesetConfig;

  // Check for win condition
  if (priv.hands[actorSeatId]!.length === 0) {
    // Handle draw-two / WD4 finishing card: next player still draws
    if (card.value === 'draw_two') {
      const nextSeat = getNextSeat(pub, actorSeatId, pub.direction);
      const drawn = drawCards(priv, pub, 2);
      priv.hands[nextSeat.seatId]!.push(...drawn);
      nextSeat.handCount += 2;
      events.push({ type: 'drew_cards', data: { seatId: nextSeat.seatId, count: 2 } });
    }
    if (card.value === 'wild_draw_four') {
      const nextSeat = getNextSeat(pub, actorSeatId, pub.direction);
      const drawn = drawCards(priv, pub, 4);
      priv.hands[nextSeat.seatId]!.push(...drawn);
      nextSeat.handCount += 4;
      events.push({ type: 'drew_cards', data: { seatId: nextSeat.seatId, count: 4 } });
    }

    const winner = scoreRound({ ...state, public: pub, private: priv }, actorSeatId);
    events.push({ type: 'round_ended', data: { winnerSeatId: actorSeatId } });
    return ok(winner, events);
  }

  switch (card.value) {
    case 'skip': {
      const skipped = getNextSeat(pub, actorSeatId, pub.direction);
      events.push({ type: 'skip', data: { skippedSeatId: skipped.seatId } });
      advanceTurn(pub, 2); // skip one player
      break;
    }

    case 'reverse': {
      if (pub.seats.filter((s) => s.role === 'player').length === 2) {
        // In 2-player, reverse acts like skip
        advanceTurn(pub, 2);
      } else {
        pub.direction = (pub.direction * -1) as Direction;
        events.push({ type: 'direction_changed', data: { direction: pub.direction } });
        advanceTurn(pub);
      }
      break;
    }

    case 'draw_two': {
      if (ruleset.houseRules.progressive) {
        // Next player may stack another D2
        pub.pendingAction = {
          type: 'challenge_wdf',
          actorSeatId,
          targetSeatId: getNextSeat(pub, actorSeatId, pub.direction).seatId,
          accumulatedDraw: 2,
        };
        pub.activeColor = card.color as CardColor;
      } else {
        const nextSeat = getNextSeat(pub, actorSeatId, pub.direction);
        const drawn = drawCards(priv, pub, 2);
        priv.hands[nextSeat.seatId]!.push(...drawn);
        nextSeat.handCount += 2;
        nextSeat.calledUno = false;
        events.push({ type: 'drew_cards', data: { seatId: nextSeat.seatId, count: 2 } });
        advanceTurn(pub, 2); // skip next player
      }
      break;
    }

    case 'wild': {
      if (!chosenColor || chosenColor === 'wild') return fail('color_required');
      pub.activeColor = chosenColor;
      pub.pendingAction = null;
      advanceTurn(pub);
      break;
    }

    case 'wild_draw_four': {
      if (!chosenColor || chosenColor === 'wild') return fail('color_required');
      pub.activeColor = chosenColor;
      const nextSeat = getNextSeat(pub, actorSeatId, pub.direction);

      if (ruleset.houseRules.progressive) {
        pub.pendingAction = {
          type: 'challenge_wdf',
          actorSeatId,
          targetSeatId: nextSeat.seatId,
          accumulatedDraw: 4,
        };
      } else {
        pub.pendingAction = {
          type: 'challenge_wdf',
          actorSeatId,
          targetSeatId: nextSeat.seatId,
          accumulatedDraw: 4,
        };
      }
      break;
    }

    case 'wild_shuffle_hands': {
      if (!chosenColor || chosenColor === 'wild') return fail('color_required');
      // Collect all hands, shuffle, redeal
      const allCards: Card[] = [];
      for (const hand of Object.values(priv.hands)) allCards.push(...hand);
      const shuffled = shuffle(allCards);
      const playerSeats = pub.seats.filter((s) => s.role === 'player');
      let idx = 0;
      // Redeal starting from player left of actor
      const startIdx = (playerSeats.findIndex((s) => s.seatId === actorSeatId) + 1) % playerSeats.length;
      for (let i = 0; i < playerSeats.length; i++) {
        const seat = playerSeats[(startIdx + i) % playerSeats.length]!;
        const count = Math.floor(shuffled.length / playerSeats.length) +
          (i < shuffled.length % playerSeats.length ? 1 : 0);
        priv.hands[seat.seatId] = shuffled.slice(idx, idx + count);
        seat.handCount = priv.hands[seat.seatId]!.length;
        idx += count;
      }
      pub.activeColor = chosenColor;
      events.push({ type: 'hands_shuffled', data: {} });
      advanceTurn(pub);
      break;
    }

    case 'wild_customizable': {
      if (!chosenColor || chosenColor === 'wild') return fail('color_required');
      pub.activeColor = chosenColor;
      events.push({ type: 'wild_custom_played', data: { rule: ruleset.customWildRule } });
      advanceTurn(pub);
      break;
    }

    default:
      // Number card – just set color and advance
      pub.activeColor = card.color as CardColor;
      advanceTurn(pub);
  }

  return ok({ ...state, public: pub, private: priv, version: state.version + 1 }, events);
}

function applyFirstDiscardEffect(pub: PublicMatchState, card: Card): void {
  switch (card.value) {
    case 'reverse':
      if (pub.seats.length === 2) {
        // stays same direction, first player skipped effectively
      } else {
        pub.direction = -1 as Direction;
      }
      break;
    case 'skip':
      advanceTurn(pub, 2);
      break;
    case 'draw_two':
      // First player draws 2 and loses turn — handled in game start logic
      break;
  }
}

function drawCards(priv: PrivateMatchState, pub: PublicMatchState, count: number): Card[] {
  const drawn: Card[] = [];
  for (let i = 0; i < count; i++) {
    if (priv.drawPile.length === 0) {
      const reshuffled = reshuffleDiscard(priv.drawPile, priv.discardPile);
      priv.drawPile = reshuffled.newDrawPile;
      priv.discardPile = reshuffled.newDiscardPile;
      if (priv.drawPile.length === 0) break; // truly empty
    }
    drawn.push(priv.drawPile.shift()!);
  }
  pub.drawPileCount = priv.drawPile.length;
  return drawn;
}

function getNextSeat(pub: PublicMatchState, fromSeatId: number, direction: Direction): SeatPublic {
  const players = pub.seats.filter((s) => s.role === 'player');
  const idx = players.findIndex((s) => s.seatId === fromSeatId);
  const nextIdx = ((idx + direction) + players.length) % players.length;
  return players[nextIdx]!;
}

function advanceTurn(pub: PublicMatchState, steps = 1): void {
  const players = pub.seats.filter((s) => s.role === 'player');
  let idx = players.findIndex((s) => s.seatId === pub.currentTurn);
  for (let i = 0; i < steps; i++) {
    idx = ((idx + pub.direction) + players.length) % players.length;
  }
  pub.currentTurn = players[idx]!.seatId;
}

function performZeroRotate(pub: PublicMatchState, priv: PrivateMatchState): void {
  const players = pub.seats.filter((s) => s.role === 'player');
  const n = players.length;
  if (pub.direction === 1) {
    const first = priv.hands[players[0]!.seatId]!;
    for (let i = 0; i < n - 1; i++) {
      priv.hands[players[i]!.seatId] = priv.hands[players[i + 1]!.seatId]!;
    }
    priv.hands[players[n - 1]!.seatId] = first;
  } else {
    const last = priv.hands[players[n - 1]!.seatId]!;
    for (let i = n - 1; i > 0; i--) {
      priv.hands[players[i]!.seatId] = priv.hands[players[i - 1]!.seatId]!;
    }
    priv.hands[players[0]!.seatId] = last;
  }
  for (const seat of players) {
    seat.handCount = priv.hands[seat.seatId]!.length;
  }
}

function cloneState(state: FullMatchState): { pub: PublicMatchState; priv: PrivateMatchState } {
  return {
    pub: JSON.parse(JSON.stringify(state.public)),
    priv: {
      hands: JSON.parse(JSON.stringify(state.private.hands)),
      drawPile: [...state.private.drawPile],
      discardPile: [...state.private.discardPile],
      unoCalledBy: new Set(state.private.unoCalledBy),
    },
  };
}

function ok(state: FullMatchState, events: GameEvent[]): RuleResult {
  return { ok: true, state, events };
}

function fail(reason: string): RuleResult {
  return { ok: false, reason };
}
