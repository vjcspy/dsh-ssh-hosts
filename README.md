# dsh-ssh-hosts

A Termius-like SSH host manager for the DSH right sidebar, shipped as a Cordis plugin.

Hosts live in one YAML file, are edited in a drawer with a live command preview, and
connect through the core terminal: the plugin types `exec ssh ...` into a fresh terminal
and hands it to the regular `terminal` tab. There is no core change and the plugin never
spawns a process itself.

## Install

Add the package to the DSH profile and enable its bundle row (`cordis.patch.yml` ships the
default row). Build it first (`pnpm run build`), then install it from the built tree.

## Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| `hostsFile` | `~/.config/dsh-ssh-hosts/hosts.yaml` | The only store. Created on the first save. |
| `probeTimeoutMs` | `2000` | TCP reachability probe deadline. |
| `probeConcurrency` | `8` | Concurrent probes. |

Override the row in your own profile patch, keyed by the plugin id.

## Credentials

Nothing secret is ever stored. A host references its credential by kind:

- `agent`: whatever `ssh-agent` offers.
- `key`: a `~/`-relative private key path.
- `certificate`: a key plus a certificate path.
- `identity-agent`: an agent socket path.
- `alias`: an alias from your own `~/.ssh/config`.
- `password`: ssh prompts in the terminal; nothing is stored or typed for you.

## Trust policy

The plugin generates one `exec ssh ... -- <destination>` line. Every argument is
single-quoted for the local shell, `--` always precedes the destination, and the
`options` map refuses keys that make ssh run local commands (`ProxyCommand`, `ProxyJump`,
`LocalCommand`, `PermitLocalCommand`, `KnownHostsCommand`, `PKCS11Provider`,
`SecurityKeyProvider`, `XAuthLocation`, `Match`, `Include`) and any key that duplicates a
structured field. Diagnostics read files only; `ssh -G` is never run at runtime.

## Caveats

- Hosts are per machine: the file is read where the DSH host runs, so key paths and
  agent sockets resolve there. The terminal is assumed to run on that same machine.
- The Connect action opens the terminal in the Session that is on screen. Leaving the
  Session while a connect is in flight rolls the new terminal back.
- Recent connections are kept per browser, not in the hosts file.

## Scripts

`pnpm run check` type-checks both halves; `pnpm run build` emits the Host half to `lib/`
and the browser bundle to `lib/client.js`.

## License

MIT
