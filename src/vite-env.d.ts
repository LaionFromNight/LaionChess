/// <reference types="vite/client" />
declare module '*.css'

interface ImportMetaEnv {
  /**
   * Optional base URL of the local Common Moves server (see server/).
   * Unset on GitHub Pages → the app runs fully offline from the bundled
   * book/explorer.json. Set locally (e.g. http://localhost:8787) to fetch
   * live, cached Lichess opening-explorer data.
   */
  readonly VITE_BOOK_SERVER?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
