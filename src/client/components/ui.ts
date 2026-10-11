/** Small pure helpers shared by the SSH tab components. */
import { PALETTE, type PaletteColor } from '../../config.ts'
import type { Auth, Host } from '../../types.ts'

/** Palette colours, re-exported for the swatch row. */
export const COLORS: readonly PaletteColor[] = PALETTE

/** CSS custom property of a named colour. */
export function colorVar(color: string | undefined): string {
  return color !== undefined && (PALETTE as readonly string[]).includes(color) ? `var(--ssh-${color})` : 'var(--ssh-slate)'
}

/** `user@host:port` display line. */
export function addressOf(host: Host): string {
  if (host.auth.kind === 'alias') return host.auth.alias ?? ''
  const base = `${host.user ?? ''}@${host.host ?? ''}`
  return host.port !== undefined && host.port !== 22 ? `${base}:${host.port}` : base
}

/**
 * Subsequence fuzzy match of every whitespace-separated query token.
 * @param query - the user's text.
 * @param haystack - the searchable text.
 * @returns whether every token matches.
 */
export function fuzzyMatch(query: string, haystack: string): boolean {
  const text = haystack.toLowerCase()
  return query.toLowerCase().split(/\s+/u).filter(t => t !== '').every((token) => {
    let at = 0
    for (const ch of token) {
      at = text.indexOf(ch, at)
      if (at < 0) return false
      at += 1
    }
    return true
  })
}

/** Searchable text of one host. */
export function searchText(host: Host, groupName: string | undefined): string {
  return [host.name, host.host, host.user, host.auth.alias, ...(host.tags ?? []), groupName].filter(Boolean).join(' ')
}

/** A random lowercase-alphanumeric id of the given length. */
export function randomToken(length: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('')
}

/** A group id derived from its name. */
export function groupIdFor(name: string, taken: readonly string[]): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 30) || 'group'
  let id = slug.length < 2 ? `${slug}0` : slug
  while (taken.includes(id)) id = `${slug.slice(0, 26)}-${randomToken(3)}`
  return id
}

/** Auth label key suffix. */
export function authKey(auth: Auth): `auth.${Auth['kind']}` {
  return `auth.${auth.kind}`
}

/** Read a JSON value from `localStorage`, tolerating every failure. */
export function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? fallback : JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** Write a JSON value to `localStorage`, tolerating every failure. */
export function writeStored(key: string, value: unknown): void {
  try { window.localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage may be unavailable */ }
}
