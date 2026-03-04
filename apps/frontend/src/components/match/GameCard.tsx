import { Card, CardColor } from '@wholet/shared';

interface Props {
  card: Card;
  playable?: boolean;
  selected?: boolean;
  faceDown?: boolean;
  onClick?: () => void;
  size?: 'sm' | 'md' | 'lg';
}

const COLOR_BG: Record<CardColor, string> = {
  red: 'bg-card-red',
  blue: 'bg-card-blue',
  green: 'bg-card-green',
  yellow: 'bg-card-yellow',
  wild: 'bg-card-wild',
};

const VALUE_LABEL: Record<string, string> = {
  skip: '⊘',
  reverse: '⇄',
  draw_two: '+2',
  wild: 'W',
  wild_draw_four: 'W+4',
  wild_shuffle_hands: 'W↯',
  wild_customizable: 'W★',
};

const SIZE_CLASS = {
  sm: 'w-10 h-14 text-xs',
  md: 'w-14 h-20 text-sm',
  lg: 'w-20 h-28 text-base',
};

export default function GameCard({ card, playable, selected, faceDown, onClick, size = 'md' }: Props) {
  const bg = faceDown ? 'bg-indigo-900' : COLOR_BG[card.color];
  const label = faceDown ? '?' : (VALUE_LABEL[card.value] ?? card.value);

  return (
    <div
      onClick={onClick}
      className={[
        'card-base',
        SIZE_CLASS[size],
        bg,
        'flex items-center justify-center font-extrabold text-white border-white/20',
        playable && !faceDown ? 'hover:scale-110 ring-2 ring-white/80' : '',
        selected ? 'scale-110 -translate-y-2' : '',
        !playable && !faceDown && onClick ? 'opacity-60' : '',
        onClick ? 'cursor-pointer' : 'cursor-default',
      ].filter(Boolean).join(' ')}
    >
      {label}
    </div>
  );
}
