import { Card, CardColor, CardValue, DeckProfile } from '@wholet/shared';
import { v4 as uuidv4 } from 'uuid';

// ─── Deck Composition ─────────────────────────────────────────────────────────

const COLORS: CardColor[] = ['red', 'green', 'blue', 'yellow'];
const NUMBERS: CardValue[] = ['0','1','2','3','4','5','6','7','8','9'];
const ACTIONS: CardValue[] = ['skip','reverse','draw_two'];

function makeCard(color: CardColor, value: CardValue): Card {
  return { id: uuidv4(), color, value };
}

/**
 * Builds a fresh, unshuffled deck for the given profile.
 * Classic: 108 cards; Modern: 112 cards.
 */
export function buildDeck(profile: DeckProfile): Card[] {
  const deck: Card[] = [];

  for (const color of COLORS) {
    // One 0 per color
    deck.push(makeCard(color, '0'));

    // Two of each 1-9 and action per color
    for (const val of [...NUMBERS.slice(1), ...ACTIONS]) {
      deck.push(makeCard(color, val));
      deck.push(makeCard(color, val));
    }
  }

  // Wild cards (4 of each)
  for (let i = 0; i < 4; i++) {
    deck.push(makeCard('wild', 'wild'));
    deck.push(makeCard('wild', 'wild_draw_four'));
  }

  if (profile === 'modern') {
    deck.push(makeCard('wild', 'wild_shuffle_hands'));
    deck.push(makeCard('wild', 'wild_customizable'));
    deck.push(makeCard('wild', 'wild_shuffle_hands'));
    deck.push(makeCard('wild', 'wild_customizable'));
  }

  return deck;
}

/**
 * Fisher-Yates in-place shuffle (crypto-quality via Math.random for now;
 * swap for a CSPRNG in production if needed).
 */
export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Deal 7 cards to each seat from the top of the deck.
 * Returns the mutated deck (cards removed) and hands map.
 */
export function dealHands(
  deck: Card[],
  seatIds: number[],
): { hands: Record<number, Card[]>; remainingDeck: Card[] } {
  const working = [...deck];
  const hands: Record<number, Card[]> = {};

  for (const seat of seatIds) {
    hands[seat] = working.splice(0, 7);
  }

  return { hands, remainingDeck: working };
}

/**
 * Draw the first non-wild card for the initial discard pile.
 */
export function drawFirstDiscard(deck: Card[]): { card: Card; remainingDeck: Card[] } {
  const working = [...deck];
  let card: Card | undefined;
  let idx = 0;

  for (; idx < working.length; idx++) {
    if (working[idx]!.color !== 'wild') {
      card = working.splice(idx, 1)[0]!;
      break;
    }
  }

  if (!card) {
    // Fallback: just use first card
    card = working.splice(0, 1)[0]!;
  }

  return { card, remainingDeck: working };
}

/**
 * Reshuffle the discard pile back into the draw pile,
 * keeping only the top card on the discard pile.
 */
export function reshuffleDiscard(
  drawPile: Card[],
  discardPile: Card[],
): { newDrawPile: Card[]; newDiscardPile: Card[] } {
  if (discardPile.length <= 1) {
    return { newDrawPile: drawPile, newDiscardPile: discardPile };
  }

  const top = discardPile[discardPile.length - 1]!;
  const toShuffle = discardPile.slice(0, -1);
  const newDrawPile = shuffle([...drawPile, ...toShuffle]);

  return { newDrawPile, newDiscardPile: [top] };
}
