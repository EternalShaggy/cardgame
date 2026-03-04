import { Card, CardColor } from '@wholet/shared';
import GameCard from './GameCard';

interface Props {
  hand: Card[];
  topCard: Card;
  activeColor: CardColor;
  selectedId: string | null;
  onSelect: (cardId: string) => void;
  canDraw: boolean;
  onDraw: () => void;
  onCallUno: () => void;
  hasCalledUno: boolean;
  isMyTurn: boolean;
}

function isPlayable(card: Card, top: Card, activeColor: CardColor): boolean {
  if (card.color === 'wild') return true;
  if (card.color === activeColor) return true;
  if (card.value === top.value) return true;
  return false;
}

export default function PlayerHand({
  hand,
  topCard,
  activeColor,
  selectedId,
  onSelect,
  canDraw,
  onDraw,
  onCallUno,
  hasCalledUno,
  isMyTurn,
}: Props) {
  const fanOffset = Math.min(40, 280 / Math.max(hand.length, 1));

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Hand */}
      <div className="relative flex justify-center" style={{ height: '7rem', minWidth: `${Math.min(hand.length * fanOffset + 56, 500)}px` }}>
        {hand.map((card, i) => {
          const canPlay = isMyTurn && isPlayable(card, topCard, activeColor);
          return (
            <div key={card.id} className="absolute" style={{ left: i * fanOffset, bottom: 0, zIndex: i }}>
              <GameCard
                card={card}
                playable={canPlay}
                selected={card.id === selectedId}
                onClick={isMyTurn ? () => onSelect(card.id) : undefined}
                size="lg"
              />
            </div>
          );
        })}
      </div>

      {/* Actions bar */}
      <div className="flex items-center gap-4">
        <button onClick={onDraw} disabled={!isMyTurn || !canDraw} className="btn-secondary">
          Draw Card
        </button>

        {hand.length === 1 && !hasCalledUno && (
          <button onClick={onCallUno} className="btn bg-yellow-500 hover:bg-yellow-400 text-black font-extrabold animate-pulse">
            UNO!
          </button>
        )}

        <span className="text-sm text-gray-400">{hand.length} card{hand.length !== 1 ? 's' : ''}</span>
      </div>
    </div>
  );
}
