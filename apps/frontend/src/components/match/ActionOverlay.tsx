import { CardColor, SeatPublic } from '@wholet/shared';

interface ColorPickerProps {
  onPick: (color: CardColor) => void;
}

export function ColorPicker({ onPick }: ColorPickerProps) {
  const colors: { color: CardColor; label: string; bg: string }[] = [
    { color: 'red', label: 'Red', bg: 'bg-card-red' },
    { color: 'blue', label: 'Blue', bg: 'bg-card-blue' },
    { color: 'green', label: 'Green', bg: 'bg-card-green' },
    { color: 'yellow', label: 'Yellow', bg: 'bg-card-yellow' },
  ];

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-2xl p-8 shadow-2xl">
        <h2 className="text-xl font-bold text-center mb-6">Choose a Color</h2>
        <div className="grid grid-cols-2 gap-4">
          {colors.map(({ color, label, bg }) => (
            <button
              key={color}
              onClick={() => onPick(color)}
              className={`${bg} w-28 h-28 rounded-2xl font-bold text-white text-lg hover:ring-4 ring-white/50 transition-all`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

interface ChallengeWdfProps {
  challengerName: string;
  onDecide: (challenge: boolean) => void;
}

export function ChallengeWdf({ challengerName, onDecide }: ChallengeWdfProps) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-2xl p-8 shadow-2xl max-w-sm w-full text-center">
        <h2 className="text-xl font-bold mb-2">Wild Draw Four!</h2>
        <p className="text-gray-400 mb-6">{challengerName} played a Wild Draw Four. Do you challenge it?</p>
        <div className="flex gap-4">
          <button onClick={() => onDecide(true)} className="btn-primary flex-1">Challenge</button>
          <button onClick={() => onDecide(false)} className="btn-secondary flex-1">Accept (+4)</button>
        </div>
      </div>
    </div>
  );
}

interface SevenSwapProps {
  seats: SeatPublic[];
  onChoose: (seatId: number) => void;
}

export function SevenSwap({ seats, onChoose }: SevenSwapProps) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-2xl p-8 shadow-2xl max-w-sm w-full text-center">
        <h2 className="text-xl font-bold mb-2">Seven — Swap hands with:</h2>
        <div className="space-y-2 mt-4">
          {seats.map(seat => (
            <button
              key={seat.seatId}
              onClick={() => onChoose(seat.seatId)}
              className="btn-secondary w-full"
            >
              {seat.displayName} ({seat.handCount} cards)
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
