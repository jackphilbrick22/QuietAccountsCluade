import { useCallback, useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { useApp } from "../store/app";
import { api, ApiError, getToken, setSessionToken, storeToken, type Health } from "./api";

export type ClientTab = "overview" | "opportunities" | "notes" | "replies" | "texts" | "activity" | "files" | "settings";

interface LiveStore {
  token: string | null;
  /** Bumped after every change so every screen on view re-reads. */
  version: number;
  signInError?: string;
  health?: Health;
  clientTab: ClientTab;
  signIn(token: string): Promise<boolean>;
  signOut(reason?: string): void;
  bump(): void;
  setClientTab(t: ClientTab): void;
  loadHealth(): Promise<void>;
}

export const useLive = create<LiveStore>((set, get) => ({
  token: getToken(),
  version: 0,
  clientTab: "overview",

  async signIn(token) {
    const t = token.trim();
    if (!t) {
      set({ signInError: "Paste the operator token." });
      return false;
    }
    try {
      await api("GET", "/businesses", undefined, t);
      storeToken(t);
      setSessionToken(t);
      set({ token: t, signInError: undefined, version: get().version + 1 });
      return true;
    } catch (e) {
      const err = e as ApiError;
      set({ signInError: err.status === 401 ? "That token wasn't accepted." : err.message });
      return false;
    }
  },

  signOut(reason) {
    storeToken(null);
    setSessionToken(null);
    cache.clear();
    set({ token: null, signInError: reason });
  },

  bump() {
    set((s) => ({ version: s.version + 1 }));
  },

  setClientTab(t) {
    set({ clientTab: t });
  },

  async loadHealth() {
    try {
      set({ health: await api<Health>("GET", "/health") });
    } catch {
      set({ health: undefined });
    }
  },
}));

/* ------------------------------ reads ------------------------------ */

const cache = new Map<string, unknown>();

export interface Query<T> {
  data?: T;
  error?: string;
  loading: boolean;
  reload: () => void;
}

/**
 * GET an operator route. Shows the last copy right away (so tabs switch instantly), refetches on
 * every change (`version`), and optionally polls. A 401 signs the operator out.
 */
export function useApi<T>(path: string | null, opts: { poll?: number } = {}): Query<T> {
  const version = useLive((s) => s.version);
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<{ path: string | null; data?: T; error?: string; loading: boolean }>(() => ({ path, data: path ? (cache.get(path) as T | undefined) : undefined, loading: !!path }));

  useEffect(() => {
    if (!path) return;
    let alive = true;
    setState((s) => (s.path === path ? { ...s, loading: true } : { path, data: cache.get(path) as T | undefined, loading: true }));
    api<T>("GET", path).then(
      (data) => {
        cache.set(path, data);
        if (alive) setState({ path, data, loading: false });
      },
      (e: ApiError) => {
        if (e.status === 401) useLive.getState().signOut("Your operator token was rejected. Sign in again.");
        if (alive) setState((s) => ({ ...s, path, error: e.message, loading: false }));
      },
    );
    return () => {
      alive = false;
    };
  }, [path, version, nonce]);

  useEffect(() => {
    if (!opts.poll || !path) return;
    const t = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") setNonce((n) => n + 1);
    }, opts.poll);
    return () => clearInterval(t);
  }, [opts.poll, path]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const fresh = state.path === path;
  return { data: fresh ? state.data : path ? (cache.get(path) as T | undefined) : undefined, error: fresh ? state.error : undefined, loading: fresh ? state.loading : !!path, reload };
}

/* ------------------------------ writes ------------------------------ */

/**
 * Run a change against the server: tracks which action is busy, toasts the result,
 * and bumps `version` so everything on screen re-reads.
 */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const run = useCallback(async <T,>(key: string, fn: () => Promise<T>, done?: string | ((r: T) => string | undefined)): Promise<T | undefined> => {
    setBusy(key);
    try {
      const r = await fn();
      const msg = typeof done === "function" ? done(r) : done;
      if (msg) useApp.getState().toast(msg);
      useLive.getState().bump();
      return r;
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) useLive.getState().signOut("Your operator token was rejected. Sign in again.");
      useApp.getState().toast(err.issues?.length ? `${err.message}: ${err.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` : err.message || "That didn't work.");
      return undefined;
    } finally {
      if (mounted.current) setBusy(null);
    }
  }, []);
  return { busy, run };
}

/** Copy text; falls back silently when the clipboard is blocked. */
export async function copy(text: string, label = "Copied"): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    useApp.getState().toast(label);
  } catch {
    useApp.getState().toast("Couldn't copy. Select the text instead.");
  }
}
