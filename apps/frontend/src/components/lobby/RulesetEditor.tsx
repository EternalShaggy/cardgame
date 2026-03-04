import { RulesetConfig } from '@wholet/shared';

interface Props {
  config: RulesetConfig;
  onChange: (config: RulesetConfig) => void;
  disabled?: boolean;
}

export default function RulesetEditor({ config, onChange, disabled }: Props) {
  const setTop = <K extends keyof RulesetConfig>(key: K, value: RulesetConfig[K]) => {
    onChange({ ...config, [key]: value });
  };

  const setHouseRule = (key: keyof RulesetConfig['houseRules'], value: boolean) => {
    onChange({ ...config, houseRules: { ...config.houseRules, [key]: value } });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <label className="text-sm text-gray-400 w-32">Deck Profile</label>
        <select
          value={config.deckProfile}
          onChange={e => setTop('deckProfile', e.target.value as RulesetConfig['deckProfile'])}
          disabled={disabled}
          className="bg-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
        >
          <option value="classic">Classic (108 cards)</option>
          <option value="modern">Modern (112 cards)</option>
        </select>
      </div>

      <div className="flex items-center gap-4">
        <label className="text-sm text-gray-400 w-32">Score Target</label>
        <input
          type="number"
          value={config.scoreTarget}
          min={100}
          max={1000}
          step={50}
          onChange={e => setTop('scoreTarget', Number(e.target.value))}
          disabled={disabled}
          className="bg-gray-700 rounded-lg px-3 py-1.5 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
        />
        <span className="text-sm text-gray-500">points</span>
      </div>

      <div className="flex items-center gap-4">
        <label className="text-sm text-gray-400 w-32">Turn Timer</label>
        <input
          type="number"
          value={config.turnTimeoutSeconds}
          min={0}
          max={300}
          step={15}
          onChange={e => setTop('turnTimeoutSeconds', Number(e.target.value))}
          disabled={disabled}
          className="bg-gray-700 rounded-lg px-3 py-1.5 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
        />
        <span className="text-sm text-gray-500">sec (0 = off)</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
        {([
          ['progressive', 'Progressive Draw Stacking'],
          ['progressiveMixDraws', 'Mix D2 + WD4 Stacking'],
          ['sevenO', 'Seven-O (7=swap, 0=rotate)'],
          ['jumpIn', 'Jump-In Rule'],
        ] as [keyof RulesetConfig['houseRules'], string][]).map(([key, label]) => (
          <label
            key={key}
            className={`flex items-center gap-3 cursor-pointer ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <input
              type="checkbox"
              checked={!!config.houseRules[key]}
              onChange={e => setHouseRule(key, e.target.checked)}
              disabled={disabled}
              className="w-4 h-4 accent-indigo-500"
            />
            <span className="text-sm text-gray-300">{label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
