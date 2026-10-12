# dsh-ssh-hosts

A Termius-like SSH host manager for the DSH right sidebar, shipped as a Cordis plugin.

Hosts live in one YAML file, are edited in a drawer with a live command preview, and
connect through the core terminal: the plugin types `exec ssh ...` into a fresh terminal
and hands it to the regular `terminal` tab. There is no core change. The only process the
plugin runs itself is `ssh-keyscan`, in the Connect pre-flight described under
[Trust policy](#trust-policy).

## Install

Add the package to the DSH profile and enable its bundle row (`cordis.patch.yml` ships the
default row). Build it first (`pnpm run build`), then install it from the built tree.

## Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| `hostsFile` | `~/.config/dsh-ssh-hosts/hosts.yaml` | The only store. Created on the first save. |
| `probeTimeoutMs` | `2000` | TCP reachability probe deadline, and the host-key scan deadline. |
| `probeConcurrency` | `8` | Concurrent probes. |
| `healChangedHostKey` | `true` | Delete a stale `known_hosts` entry for the destination before Connect, when the host's key changed. |

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

**One process is the exception, and only for Connect.** Before the ssh line is typed, the
Host half may run

```
ssh-keyscan -p <port> -T <probeTimeoutMs> -t rsa,ecdsa,ed25519 -- <host>
```

to ask the destination for its public keys. It speaks the SSH handshake, authenticates
nothing, and runs no local command. The scan runs **only** when the destination already has
an entry in `~/.ssh/known_hosts`, and its only effect is to delete that entry when the key
the host serves differs from the key recorded for it — the case of a machine rebuilt behind
the same address, where ssh otherwise aborts with `REMOTE HOST IDENTIFICATION HAS CHANGED`.
The removed lines are copied to `<file>.old` first, and the connection that follows carries
`-o StrictHostKeyChecking=accept-new`, so **ssh itself** records the key it negotiated: the
plugin never writes key material. A first connect — nothing recorded — is untouched. Set
`healChangedHostKey: false` to remove the exception entirely.

## Caveats

- Hosts are per machine: the file is read where the DSH host runs, so key paths and
  agent sockets resolve there. The terminal is assumed to run on that same machine.
- The Connect action opens the terminal in the Session that is on screen. Leaving the
  Session while a connect is in flight rolls the new terminal back.
- A changed host key is healed only for a plain destination: an `alias` and a jump host
  (whose real address and port live in `~/.ssh/config`) are skipped, and the file read is
  the default `~/.ssh/known_hosts` / `known_hosts2` or the one the host entry's own
  `UserKnownHostsFile` names — not a global one set in `~/.ssh/config`.
- Recent connections are kept per browser, not in the hosts file.

## Scripts

`pnpm run check` type-checks both halves; `pnpm run build` emits the Host half to `lib/`
and the browser bundle to `lib/client.js`.

## License

MIT
