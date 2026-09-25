import { useState } from 'react';
import {
  useLichessAuth, startLichessLogin, setManualLichessToken, logoutLichess, clearLichessError,
} from '../board/lichessAuth';
import type { BookSource } from '../board/lichess';

const SOURCE_LABEL: Record<Exclude<BookSource, null>, string> = {
  live: 'Live · Lichess',
  server: 'Local book server',
  offline: 'Offline snapshot',
};

/** Data-source badge under Common Moves + "Connect Lichess" for live stats. */
export default function LichessConnect({ source, loading }: { source: BookSource; loading?: boolean }) {
  const { token, username, error } = useLichessAuth();
  const [showToken, setShowToken] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const tone = source === 'live' ? 'live' : source === 'server' ? 'server' : 'offline';

  return (
    <div className="lichess-connect">
      <div className="lc-src-row">
        <span className={`src-badge ${tone}`}>
          <i className="dot" />
          {loading ? 'Loading…' : source ? SOURCE_LABEL[source] : 'No data'}
        </span>
        {token ? (
          <span className="lc-acct">
            {username ? <>as <b>{username}</b></> : 'Lichess connected'}
            <button type="button" className="link-btn" onClick={logoutLichess}>Disconnect</button>
          </span>
        ) : (
          <button type="button" className="btn btn-sm btn-lichess" onClick={() => { clearLichessError(); startLichessLogin(); }}>
            ♞ Connect Lichess
          </button>
        )}
      </div>

      {!token && (
        <div className="lc-hint">
          Lichess only serves live explorer stats to signed-in users. Connect once (read-only, no permissions)
          and Common Moves update live — also on GitHub Pages.{' '}
          <button type="button" className="link-btn" onClick={() => setShowToken(v => !v)}>
            {showToken ? 'Hide' : 'Use a token instead'}
          </button>
        </div>
      )}

      {!token && showToken && (
        <form className="lc-token" onSubmit={async e => {
          e.preventDefault();
          setBusy(true);
          const ok = await setManualLichessToken(draft);
          setBusy(false);
          if (ok) { setDraft(''); setShowToken(false); }
        }}>
          <input type="password" placeholder="lip_…" value={draft} onChange={e => setDraft(e.target.value)} aria-label="Lichess API token" autoComplete="off" />
          <button type="submit" className="btn btn-sm" disabled={busy || !draft.trim()}>{busy ? '…' : 'Save'}</button>
          <a className="link-btn" href="https://lichess.org/account/oauth/token/create?description=LaionChess" target="_blank" rel="noreferrer">Create token ↗</a>
        </form>
      )}

      {error && <div className="lc-error">{error}</div>}
    </div>
  );
}
