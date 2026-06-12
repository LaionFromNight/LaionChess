import {
  useSettings, EXPLORER_SPEEDS, EXPLORER_SPEED_LABELS, EXPLORER_RATINGS,
  type ExplorerSpeed,
} from '../settings/useSettings';

/** Lichess opening-explorer filters for the Common Moves table (speeds + ratings). */
export default function BookFilters() {
  const { settings, setSetting } = useSettings();

  const toggleSpeed = (s: ExplorerSpeed) => {
    const next = settings.bookSpeeds.includes(s)
      ? settings.bookSpeeds.filter(x => x !== s)
      : [...settings.bookSpeeds, s];
    setSetting('bookSpeeds', next);
  };
  const toggleRating = (r: number) => {
    const next = settings.bookRatings.includes(r)
      ? settings.bookRatings.filter(x => x !== r)
      : [...settings.bookRatings, r];
    setSetting('bookRatings', next);
  };

  return (
    <div className="book-filters">
      <div className="bf-row">
        <span className="bf-label">Speed</span>
        {EXPLORER_SPEEDS.map(s => (
          <button
            key={s} type="button"
            className={`chip ${settings.bookSpeeds.includes(s) ? 'on' : ''}`}
            onClick={() => toggleSpeed(s)}
          >{EXPLORER_SPEED_LABELS[s]}</button>
        ))}
      </div>
      <div className="bf-row">
        <span className="bf-label">Rating</span>
        {EXPLORER_RATINGS.map(r => (
          <button
            key={r} type="button"
            className={`chip ${settings.bookRatings.includes(r) ? 'on' : ''}`}
            onClick={() => toggleRating(r)}
          >{r}</button>
        ))}
      </div>
    </div>
  );
}
