/**
 * Copy dictionary for the SSH tab.
 *
 * Every product-visible string lives here and reaches a component through the
 * `t` seat. User data (host names, notes, tags) is rendered verbatim and never
 * passes through this dictionary. Only English ships; the locale service falls
 * back to `en` for every active locale.
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** SSH host manager tab title, guide entry and body copy. */
    dshSshHosts: DshSshHostsKey
  }
}

/** English dictionary, and the namespace's key-set source of truth. */
export const en = {
  'tab.title': 'SSH',
  'guide.title': 'SSH hosts',
  'guide.description': 'Saved SSH hosts. Connect opens a terminal tab running ssh',

  'toolbar.search': 'Search hosts  ( / )',
  'toolbar.add': '+ Host',
  'toolbar.refresh': 'Refresh',

  'section.favorites': 'Favorites',
  'section.recent': 'Recent',
  'section.ungrouped': 'Ungrouped',

  'row.connect': 'Connect',
  'row.edit': 'Edit',
  'row.duplicate': 'Duplicate',
  'row.copy': 'Copy command',
  'row.delete': 'Delete',
  'row.deleteConfirm': 'Delete "{name}"? This edits the hosts file.',
  'row.connecting': 'Connecting…',

  'auth.agent': 'agent',
  'auth.key': 'key',
  'auth.certificate': 'cert',
  'auth.identity-agent': 'custom agent',
  'auth.alias': 'alias',
  'auth.password': 'password',
  'badge.jump': 'via jump',
  'badge.keyMissing': 'key missing on this machine',
  'badge.keyTooOpen': 'key permissions too open',
  'badge.certMissing': 'certificate missing on this machine',
  'badge.aliasMissing': 'alias not found in ~/.ssh/config (Match / nested Include not evaluated)',
  'badge.machineSocket': 'machine-specific path',
  'badge.jumpMissing': 'jump host deleted',
  'status.up': 'reachable',
  'status.down': 'unreachable',
  'status.indirect': 'reached through a jump host (not probed)',
  'status.unknown': 'not probed',

  'empty.title': 'No SSH hosts yet',
  'empty.body': 'Add a host, then click it to open a terminal tab running ssh. SSH tabs belong to the current conversation and end with it or with a host restart.',
  'empty.policy': 'This tab never runs ssh or reads secrets on its own: it only checks that key files exist and tests TCP reachability.',
  'empty.add': 'Add host',
  'empty.noMatch': 'No host matches "{query}".',
  'footnote.hostsFile': 'Hosts file: {path}',

  'banner.parse': 'The hosts file cannot be read, so editing is disabled until it is fixed: {error} ({path})',
  'banner.load': 'Could not load hosts: {error}',
  'toast.conflict': 'hosts file changed on disk — reloaded',
  'toast.saved': 'Saved',
  'toast.copied': 'Command copied',
  'toast.connectFailed': 'Connect failed: {error}',
  'toast.noTerminal': 'The terminal service is not available in this Session.',
  'toast.saveFailed': 'Save failed: {error}',
  'toast.dismiss': 'Dismiss',

  'editor.titleNew': 'New host',
  'editor.titleEdit': 'Edit host',
  'editor.close': 'Close',
  'editor.save': 'Save',
  'editor.cancel': 'Cancel',
  'editor.name': 'Name',
  'editor.group': 'Group',
  'editor.groupNone': 'No group',
  'editor.groupNew': 'New group…',
  'editor.groupNewName': 'New group name',
  'editor.tags': 'Tags (comma separated)',
  'editor.color': 'Colour',
  'editor.favorite': 'Favorite',
  'editor.host': 'Host',
  'editor.port': 'Port',
  'editor.user': 'User',
  'editor.auth': 'Authentication',
  'editor.identityFile': 'Private key (~/…)',
  'editor.certificateFile': 'Certificate (~/…)',
  'editor.agentSocket': 'Agent socket (~/… or absolute)',
  'editor.alias': 'Host alias in ~/.ssh/config',
  'editor.passwordHint': 'ssh asks for the password in the terminal. It is never stored.',
  'editor.agentHint': 'Uses the running ssh-agent (SSH_AUTH_SOCK).',
  'editor.aliasHint': 'Host, user and credentials come from ~/.ssh/config.',
  'editor.jump': 'Jump host',
  'editor.jumpNone': 'None',
  'editor.jumpSaved': 'Saved host',
  'editor.jumpSpec': 'Free text (-J)',
  'editor.jumpSpecPlaceholder': 'user@bastion:22',
  'editor.advanced': 'Advanced',
  'editor.forwards': 'Port forwards',
  'editor.forwardAdd': '+ Forward',
  'editor.forwardKindLocal': 'Local -L',
  'editor.forwardKindRemote': 'Remote -R',
  'editor.forwardKindDynamic': 'Dynamic -D',
  'editor.forwardBind': 'bind',
  'editor.forwardTarget': 'host:port',
  'editor.options': 'ssh options',
  'editor.optionAdd': '+ Option',
  'editor.optionKey': 'Name',
  'editor.optionValue': 'Value',
  'editor.remoteCommand': 'Remote command',
  'editor.notes': 'Notes (never sent to the shell)',
  'editor.remove': 'Remove',
  'editor.preview': 'Command preview',
  'editor.previewCopy': 'Copy',
  'editor.previewPending': 'Fix the highlighted fields to see the command.',
} satisfies Record<string, string>

/** Every key the dictionary defines. */
export type DshSshHostsKey = keyof typeof en

/** The namespace-bound translate seat a component receives. */
export type Translate = PropsLocale<'dshSshHosts'>['t']
