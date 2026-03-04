import { Card, CardColor } from '@wholet/shared';
import GameCard from './GameCard';

const COLOR_RING: Partial<Record<CardColor, string>> = {
  red: 'ring-card-red',
  blue: 'ring-card-blue',
  green: 'ring-card-green',
  yellow: 'ring-card-yellow',
};

const COLOR_DOT: Partial<Record<CardColor, string>> = {
  red: 'bg-card-red',
  blue: 'bg-card-blue',
  green: 'bg-card-green',
  yellow: 'bg-card-yellow',
};

const DRAW_CARD: Card = { id: '__draw__', color: 'wild', value: 'wild' };

interface Props {
  topCard: Card;
  currentColor: CardColor;
  drawPileCount: number;
  onDraw?: () => void;
  canDraw?: boolean;
}

export default function DiscardPile({ topCard, currentColor, drawPileCount, onDraw, canDraw }: Props) {
  return (
    <div className="flex items-center gap-8">
      {/* Draw pile */}
      <div className="relative">
        <div className="absolute top-1 left-1 opacity-50">
          <GameCard card={DRAW_CARD} faceDown size="lg" />
        </div>
        <div onClick={canDraw ? onDraw : undefined} className={canDraw ? 'cursor-pointer hover:scale-105 transition-transform' : ''}>
          <GameCard card={DRAW_CARD} faceDown size="lg" />
        </div>
        <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-xs text-gray-400 whitespace-nowrap">
          {drawPileCount} left
        </span>
      </div>

      {/* Discard pile */}
      <div className={`ring-4 ${COLOR_RING[currentColor] ?? 'ring-gray-600'} rounded-xl`}>
        <GameCard card={topCard} size="lg" />
      </div>

      {/* Active color dot (shown when wild sets a color) */}
      {topCard.color === 'wild' && (
        <div
          className={`w-7 h-7 rounded-full ring-2 ring-white/40 ${COLOR_DOT[currentColor] ?? 'bg-gray-600'}`}
          title={`Active color: ${currentColor}`}
        />
      )}
    </div>
  );
}
