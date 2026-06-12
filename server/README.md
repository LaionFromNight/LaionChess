# Local Common Moves server

Serves opening "book" / Common Moves data to the app from a **persistent offline
database** (`public/book/explorer.json`), and — in online mode — fills gaps from
the Lichess Opening Explorer and saves them back to that file.

This replaces the abandoned Cloudflare Worker proxy. A browser can't call Lichess
directly (`401` on `Origin`), and the Worker proxy also got `401` (cloud egress
IPs / wrong host). This server runs **locally**, calls the correct host
(`explorer.lichess.ovh`) server-to-server, and owns the offline DB.

## Run

```bash
LICHESS_COOKIE='lila2=7d5701794ddb644abab521....' npm run server
```

`.env.local` already points the app at the server via
`VITE_BOOK_SERVER=http://localhost:8787`.

### Config

| Env | Default | Meaning |
|-----|---------|---------|
| `BOOK_PORT` | `8787` | Port to listen on |
| `BOOK_MODE` | `online` | `online` = DB + fetch-and-cache · `offline` = DB only |
| `LICHESS_TOKEN` | _(unset)_ | Optional Lichess API token, sent as `Authorization: Bearer …` |

### Heads-up: Lichess explorer may return 401

The explorer host (`explorer.lichess.ovh`) currently answers **401** to
unauthenticated requests from some networks — this happens for the local server
too, not just browsers/Cloudflare. When that occurs, online mode logs the 401 and
the app transparently falls back to the bundled offline book (it never breaks).

If you hit 401, create a personal token at **lichess.org → Preferences → API
access tokens** (no scopes needed) and run:

```bash
LICHESS_TOKEN=lip_xxx npm run server
```

If a token still doesn't help, the explorer is likely IP-blocking this network;
fetch the data from a network where the explorer is reachable, then commit the
updated `public/book/explorer.json`.

## API

- `GET /api/health` → `{ ok: true, mode, entries }`
- `GET /api/common-moves?fen=<FEN>&speeds=blitz,rapid&ratings=1600,1800`
  → `{ rows, source }` where `source` is `cache` | `lichess` | `empty` | `error`,
  and `rows` is `[san, played%, gamesLabel, whiteWin%, draw%][]` (or `null`).

`speeds`/`ratings` are optional, comma-separated. Omitting them (or selecting the
full set) means "all", matching Lichess.

## Database format

`public/book/explorer.json` — the **same file Vite bundles into the build**, so
enriching it locally and committing makes the data live on GitHub Pages (which
runs fully offline).

```jsonc
{
  "version": 1,
  "entries": {
    "<placement> <side>|<speeds>|<ratings>": {
      "rows": [["e4", 62, "1749m", 50, 4]],
      "source": "seed" | "lichess",
      "fetchedAt": "ISO-8601"   // present for lichess-fetched entries
    }
  }
}
```

The key is the first two FEN fields (placement + side to move) plus normalized
speed/rating filters (sorted; full or empty set → `""`). The key function is
duplicated in `src/board/lichess.ts` — keep the two in sync.

## Workflow: refresh the data that ships to Pages

1. `npm run server` and `npm run dev`.
2. Browse positions in the app; misses are fetched from Lichess and saved into
   `public/book/explorer.json`.
3. Commit the updated `public/book/explorer.json`. GitHub Pages now serves the
   richer book offline — no backend involved.
