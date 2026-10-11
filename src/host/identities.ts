/**
 * Names of private-key-looking files under `~/.ssh`.
 *
 * Names only: file contents are never read.
 */
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const EXCLUDED = /^(config|known_hosts.*|authorized_keys.*|environment|rc|.*\.pub|.*\.bak|.*~)$/u

/**
 * @param home - the home directory.
 * @returns `~/.ssh/<name>` strings for regular files that may be keys, sorted.
 */
export async function listIdentities(home: string = homedir()): Promise<string[]> {
  const dir = join(home, '.ssh')
  let names: string[]
  try { names = await readdir(dir) } catch { return [] }
  const out: string[] = []
  for (const name of names.sort()) {
    if (EXCLUDED.test(name) || name.startsWith('.')) continue
    try {
      if ((await stat(join(dir, name))).isFile()) out.push(`~/.ssh/${name}`)
    } catch { /* unreadable entries are skipped */ }
  }
  return out
}
