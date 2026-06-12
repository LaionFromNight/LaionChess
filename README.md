

# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.


## Github Page
[Under](https://laionfromnight.github.io/LaionChess/)

## Common Moves (opening book) data

Common Moves are served from a layered source so the app **always works**:

1. **Local book server** (dev only) — serves a persistent offline DB and, in
   online mode, fills gaps from the Lichess Opening Explorer and saves them.
2. **Bundled offline DB** — `public/book/explorer.json`, shipped in the build.
3. **Hardcoded demo book** — `src/data/book.ts`, last-resort seed.

### GitHub Pages (no backend)

Pages is fully static. `public/book/explorer.json` is bundled into the build and
the app reads it offline — `VITE_BOOK_SERVER` is unset there, so it never tries a
server. To enrich what Pages serves, run the local server, browse positions to
cache them, and commit the updated `public/book/explorer.json`.

> The old Cloudflare Worker proxy was removed: a browser can't call Lichess
> directly (401 on `Origin`) and the Worker also got 401 (cloud egress IPs /
> wrong host). Live data now flows only through the local server.

### Local development with live data

```bash
npm run server   # online with cache (default); or: npm run server:offline
npm run dev      # in another terminal — .env.local points it at the server
```

See [`server/README.md`](server/README.md) for the API, DB format, and modes.
