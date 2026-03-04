import { SeatPublic } from '@wholet/shared';
import GameCard from './GameCard';

interface Props {
  seat: SeatPublic;
  isCurrentTurn: boolean;
  isConnected: boolean;
}

const DUMMY_CARD = { id: 'back', color: 'wild' as const, value: 'wild' as const };

export default function OpponentSeat({ seat, isCurrentTurn, isConnected }: Props) {
  return (
    <div className={`flex flex-col items-center gap-2 p-3 rounded-xl transition-all ${isCurrentTurn ? 'ring-2 ring-yellow-400 bg-gray-800/70' : 'bg-gray-800/30'}`}>
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`} />
        <span className="text-sm font-semibold truncate max-w-[100px]">{seat.displayName}</span>
        {isCurrentTurn && <span className="text-xs text-yellow-400">▶</span>}
      </div>

      <p className="text-xs text-gray-400">{seat.score} pts</p>

      <div className="relative flex justify-center" style={{ height: '4rem', width: `${Math.min(seat.handCount * 6 + 40, 100)}px` }}>
        {Array.from({ length: Math.min(seat.handCount, 10) }).map((_, i) => (
          <div key={i} className="absolute" style={{ left: i * 6, bottom: 0, zIndex: i }}>
            <GameCard card={DUMMY_CARD} faceDown size="sm" />
          </div>
        ))}
      </div>

      <span className="text-xs text-gray-500">{seat.handCount} card{seat.handCount !== 1 ? 's' : ''}</span>

      {seat.calledUno && seat.handCount === 1 && (
        <span className="text-xs font-bold text-yellow-400 animate-bounce">UNO!</span>
      )}
    </div>
  );
}
