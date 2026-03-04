import { SeatPublic } from '@wholet/shared';

interface Props {
  seats: SeatPublic[];
  scoreTarget: number;
}

export default function ScoreBoard({ seats, scoreTarget }: Props) {
  const sorted = [...seats].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  return (
    <div className="bg-gray-800 rounded-xl p-3">
      <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">Scores</h3>
      <div className="space-y-1.5">
        {sorted.map(seat => (
          <div key={seat.seatId} className="flex items-center gap-2">
            <span className="text-sm flex-1 truncate">{seat.displayName}</span>
            <div className="flex items-center gap-1">
              <div className="w-24 h-2 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-500 rounded-full transition-all"
                  style={{ width: `${Math.min(100, ((seat.score ?? 0) / scoreTarget) * 100)}%` }}
                />
              </div>
              <span className="text-xs text-gray-400 w-10 text-right">{seat.score ?? 0}</span>
            </div>
          </div>
        ))}
        <p className="text-xs text-gray-600 text-right mt-1">Target: {scoreTarget}</p>
      </div>
    </div>
  );
}
