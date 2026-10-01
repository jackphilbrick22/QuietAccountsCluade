/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The server's public URL; with it the form posts to {url}/start, without it to Netlify Forms. */
  readonly VITE_SERVER_URL?: string;
}
