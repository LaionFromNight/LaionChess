import type { BookRow } from '../data/book';

interface CommonMovesProps {
  rows: BookRow[] | null;
  loading?: boolean;
  onPlay: (san: string) => void;
  onHover?: (san: string | null) => void;
}

function shortName(name: string): string {
  const colon = name.indexOf(':');
  return colon !== -1 ? name.slice(0, colon).trim() : name;
}

export default function CommonMoves({ rows, loading, onPlay, onHover }: CommonMovesProps) {
  return (
    <div className="book">
      <div className="book-head">
        <span className="m">Move</span>
        <span className="p">%</span>
        <span className="book-n" />
        <span className="g">Games</span>
        <span className="bar" style={{ minWidth: 0 }}>Winrate</span>
      </div>
      <div className="book-rows-scroll">
        {!rows && <div className="book-empty">{loading ? 'Loading from Lichess…' : 'No book data for this position.'}</div>}
        {rows && rows.map(([san, pct, games, ww, dd, name]) => {
          const bb = 100 - ww - dd;
          const full = name ?? undefined;
          const short = name ? shortName(name) : undefined;
          return (
            <button
              key={san}
              type="button"
              className="book-row"
              onClick={() => onPlay(san)}
              onMouseEnter={() => onHover?.(san)}
              onMouseLeave={() => onHover?.(null)}
            >
              <span className="m">{san}</span>
              <span className="p">{pct}%</span>
              {short
                ? <span className="book-n" data-full={full} title="">{short}</span>
                : <span className="book-n" />
              }
              <span className="g">{games}</span>
              <span className="bar">
                <i className="bw" style={{ width: `${ww}%` }}>{ww}%</i>
                <i className="bd" style={{ width: `${dd}%` }} />
                <i className="bb" style={{ width: `${bb}%` }}>{bb}%</i>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
