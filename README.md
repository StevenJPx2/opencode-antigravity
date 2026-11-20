# opencode-antigravity

A small, repeatable setup for installing a **verified, pinned gulp79 fork build** of
[`opencode-antigravity-auth`](https://github.com/gulp79/opencode-antigravity-auth) into
[OpenCode V2](https://opencode.ai/docs/) as a native plugin. This repository provides a
setup CLI that downloads the released bundle, verifies its SHA-512 **before** extracting,
and adds its absolute directory path to OpenCode’s `plugins` array, plus a doctor command
that reports state without ever reading or printing credentials.

The pin is **build 2.1.2-gulp.8** (release tag
[`v2.1.2-gulp.8`](https://github.com/gulp79/opencode-antigravity-auth/releases/tag/v2.1.2-gulp.8),
18 Nov 2026) — a fork build, not an npm package. There is no bridge server, no wrapper CLI,
no service, and no custom `providers` block: OpenCode loads the plugin directly from the
installed directory.

> [!WARNING]
> **Unofficial client; real account risk.** This setup uses an unofficial OAuth client
> identity, not the official Antigravity (`agy`) client. Google’s Antigravity Terms and FAQ
> do not permit third-party wrappers or proxies — including OpenCode — and using one can
> trigger an account-level `TOS_VIOLATION` (`403 PERMISSION_DENIED`) that affects the whole
> Google account, not just this tool. **This fork does not lift TOS bans.**
>
> If an account is restricted, there is one official appeal form:
> <https://forms.gle/hGzM9MEUv2azZsrb9>. It allows **one appeal per account**, takes roughly
> **48–72 hours** of automated review, and sends **no status email**, so check back yourself.
> Before appealing or signing in again, remove third-party wrappers/proxies and revoke
> third-party OAuth access at <https://myaccount.google.com/permissions>. If you need a
> supported path instead, use the official Antigravity IDE/CLI, or use a Google AI Studio or
> Vertex AI API key with a third-party coding agent.
>
> Access is **at your own risk**. This project is not affiliated with, endorsed by, or
> supported by Google.

## Why this fork

The deciding requirement is **in-app multi-account switching and rotation**: a saved
account pool, an `/antigravity` menu, and selectable rotation strategies. The Meridian/`agy`
client signs in a single Google account and cannot switch accounts, so it cannot meet that
requirement. This fork carries the upstream work that makes the OpenCode plugin usable and
maintainable on V2:

- [PR #624](https://github.com/NoeFabris/opencode-antigravity-auth/pull/624) — sanitize
  `tools.opencode.session_move` to `session_relocate`, fixing a `429 RESOURCE_EXHAUSTED` loop
  on OpenCode 2.2+.
- [PR #617](https://github.com/NoeFabris/opencode-antigravity-auth/pull/617) — scrollable
  native quota dialog.
- [PR #612](https://github.com/NoeFabris/opencode-antigravity-auth/pull/612) — omit
  `undefined` properties from the account-list RPC payload.

The fork is installed from a released bundle into a directory, and the config entry is an
**absolute directory path**. Per the fork’s [FORK.md](https://github.com/gulp79/opencode-antigravity-auth/blob/main/FORK.md),
a path entry is ignored by the plugin auto-updater, so it never silently reverts to an
upstream npm package. FORK.md is the authoritative record of the fork’s deviations and
carried patches.

## Prerequisites

- **OpenCode >= 2.1.2.** The native plugin and the `plugins` config entry target OpenCode V2.
- **Node.js >= 20.** The setup and doctor CLIs use only Node built-ins.
- **A Google account with Antigravity access.** Access is not included with every Google or
  Gemini subscription; confirm the account has it before relying on this setup.

The machine this repository was authored on runs **OpenCode v2.3.2** and **Node.js
v26.13.1**. These are examples, not a guarantee; other versions at or above the minimums
should work but are not asserted here.

## Install

Verify the download **before** extracting it. The pinned asset is the self-contained bundle
(package plus runtime `node_modules`), so no npm is required on the host:

```sh
curl -L -o /tmp/oc-antigravity-bundle.tar.gz \
  https://github.com/gulp79/opencode-antigravity-auth/releases/download/v2.1.2-gulp.8/opencode-antigravity-auth-2.1.2-bundle.tar.gz
echo 'bc1d760ebf0e6f61408c722c2476cbdd566631cd0ce11e40b7608e6388a0dea3f220e17ac8a4e5ad41474f3141f5e99bc588541187499b67bfc1537d4bf1b074  /tmp/oc-antigravity-bundle.tar.gz' | shasum -a 512 -c -
mkdir -p ~/opt/oc-antigravity
tar -xzf /tmp/oc-antigravity-bundle.tar.gz -C ~/opt/oc-antigravity
```

The bundle extracts to `node_modules/opencode-antigravity-auth` under the install directory.
Add its **absolute path** to the top-level `plugins` array in
`~/.config/opencode/opencode.jsonc` (or `opencode.json`), preserving the rest of the file:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/Users/stevenjohn/opt/oc-antigravity/node_modules/opencode-antigravity-auth"]
}
```

Replace the `/Users/stevenjohn/...` home path with your own (for example
`/home/USER/opt/oc-antigravity/node_modules/opencode-antigravity-auth`). The default install
directory is `~/opt/oc-antigravity`; the path is a directory, not an npm package name.

The fork also publishes a compiled npm tarball, `opencode-antigravity-auth-2.1.2.tgz`
(SHA-512 `54b60a7d907d787d9b0d4c34a7e369d44ec46fe689edcedc9deb2ef47793cc79582ebf0ed4ed800baafd5eec650a19f32639bf701bfa59cb99aacfd739b7b8d5`).
This project intentionally does **not** install from it — the bundle above is pinned and
self-contained.

> [!IMPORTANT]
> OpenCode **V2** uses `"plugins"` (**plural**). Some V1-era plugin troubleshooting text
> says singular `"plugin"`; that key will not load the plugin in V2. Ignore it.

The repo’s setup CLI performs the same steps safely — download, SHA-512 verification before
extraction, and the JSONC-preserving config merge:

```sh
npm run setup -- --dry-run   # print the merged config; no download, extraction or writes
npm run setup                # verify, extract, and add the path entry
npm run setup -- --install-dir ~/opt/oc-antigravity   # override the install directory
```

## Sign in (you do this)

Sign-in is a **user step** and is never automated by this repository:

```sh
opencode auth login google
```

Choose **Google OAuth (Antigravity)** when prompted. Repeat the command to add more
accounts to the saved pool.

## Use

Inside OpenCode, run `/antigravity` (alias `/ag`) to open the account and quota menu. It lets
you add and verify accounts, check quotas and reset times, enable or disable accounts, select
an account, re-authenticate, delete one with confirmation, and refresh the model list.

Model names appear as `google/antigravity-*`, discovered from your enabled accounts:

```sh
opencode models
opencode run --model=google/antigravity-gemini-3.8-flash-high "Hello"
opencode run --model=google/antigravity-claude-opus-4-6-thinking#max "Hello"
```

The model catalog is cached for about an hour, so a newly added account may take a short while
to appear; **Refresh available models** in the menu updates it immediately. While Antigravity
OAuth is selected, native Google API-key models are hidden.

Account rotation is configured in the optional `~/.config/opencode/antigravity.json`. The
`account_selection_strategy` setting accepts `sticky` (same account until rate-limited),
`round-robin` (rotate every request), and `hybrid` (default: health score, token bucket, and
LRU):

```json
{
  "$schema": "https://raw.githubusercontent.com/NoeFabris/opencode-antigravity-auth/main/assets/antigravity.schema.json",
  "account_selection_strategy": "round-robin"
}
```

## Credentials

`~/.config/opencode/antigravity-accounts.json` holds the saved account pool and its
credentials. **Never commit it, and never print it.** Back it up privately before moving
machines. This repository’s setup CLI and doctor only check that the path exists — they
**never read its contents** and never automate any part of the OAuth flow.

## Setup CLI

```sh
npm run setup -- --dry-run                   # print the merged config; no download, extraction or writes
npm run setup                                # verify, extract, and merge the path entry
npm run setup -- --config-dir <dir>          # target an alternate OpenCode config directory
npm run setup -- --install-dir <dir>         # override the default ~/opt/oc-antigravity
```

The CLI verifies the bundle’s SHA-512 **before** extracting, then performs a JSONC-preserving
merge so comments and formatting outside the edited entry are retained. It is **idempotent**
(a second run reports no changes), creates a `<config>.bak` backup before writing, and
**refuses conflicting or duplicate plugin entries** with an actionable error instead of
overwriting them. It never reads account credentials.

## Doctor

```sh
npm run doctor
npm run doctor -- --json                     # machine-readable output
npm run doctor -- --config-dir <dir>         # alternate config directory
npm run doctor -- --install-dir <dir>        # alternate install directory
```

Checks performed:

- Node.js and OpenCode versions against the minimums.
- The plugin path in the install directory resolves to the pinned build.
- The absolute path entry is present and unique in the top-level `plugins` array.
- The accounts file is present — **path only**, never its contents.
- `opencode models` lists `google/antigravity-*` models.
- Captured command output is scanned for known failure signatures (`TOS_VIOLATION`/`403`,
  `429`/`RESOURCE_EXHAUSTED`, prompt-signature/`session_move`, `invalid_grant`).

Doctor never prints credentials and leaves no processes running.

## Troubleshooting

For the full list, see the upstream
[TROUBLESHOOTING.md](https://github.com/NoeFabris/opencode-antigravity-auth/blob/main/docs/TROUBLESHOOTING.md).
Common cases:

- **Plugin does not load / wrong config key.** V2 requires `"plugins"` (plural), not the
  singular `"plugin"` shown in some V1-era text.
- **`403` / `TOS_VIOLATION`.** An account-level restriction, not a model-specific one. Stop
  retrying; remove wrappers and revoke third-party OAuth at
  <https://myaccount.google.com/permissions>, then use the one-time appeal form at
  <https://forms.gle/hGzM9MEUv2azZsrb9>. This fork cannot lift a TOS ban.
- **`429` / `RESOURCE_EXHAUSTED`, or a `session_move` loop.** The `session_move`
  `429 RESOURCE_EXHAUSTED` loop on OpenCode 2.2+ is fixed by carried PR #624 in this fork.
  For ordinary quota exhaustion, wait for the reset window shown in `/antigravity`; repeated
  retries can make it worse.
- **`invalid_grant`.** The saved refresh token has expired. Run `opencode auth login google`
  again and reselect **Google OAuth (Antigravity)**.
- **“This version of Antigravity is no longer supported”.** A stale plugin cache. Clear the
  plugin caches and sign in again.
- **OAuth callback never completes in Safari.** Safari HTTPS-only mode can block the
  `http://localhost` redirect; use Chrome or Firefox. If the error says port `51121` is already
  in use, another client is holding the callback port.
- **Gemini 3 `400 Unknown name "parameters"`.** An MCP server schema incompatibility; disable
  MCP servers one at a time to find the culprit.

## Uninstall

Remove the absolute path entry from `"plugins"` in `~/.config/opencode/opencode.jsonc`, then
optionally delete the install directory (`~/opt/oc-antigravity`) and
`~/.config/opencode/antigravity.json`. Removing the plugin does **not** delete saved
credentials: `antigravity-accounts.json` remains on disk, owned by you. Back it up or remove
it only deliberately.

## Live verification (after you sign in)

Once signed in, confirm the real path end to end:

```sh
opencode models
opencode run --model=google/antigravity-gemini-3.8-flash-high "Hello"
```

`opencode models` should list `google/antigravity-*` models and the run should return a
reply. **This has not been run in this repository yet.** The live gate is deferred until a
user with Antigravity access signs in; nothing here claims it has passed.

## Development

```sh
npm test
npm run lint
```

The project uses only dependency-free Node.js built-ins (CommonJS and `node:test` for tests).
There are no runtime dependencies.

## Sources

- [gulp79 fork releases](https://github.com/gulp79/opencode-antigravity-auth/releases) — pinned
  build `v2.1.2-gulp.8` (18 Nov 2026) and its bundle/npm SHA-512 checksums.
- [FORK.md](https://github.com/gulp79/opencode-antigravity-auth/blob/main/FORK.md) — build
  usage, carried patches, and fork deviations.
- Upstream plugin docs: [OpenCode V2 guide](https://github.com/NoeFabris/opencode-antigravity-auth/blob/main/docs/OPENCODE-V2.md),
  [configuration](https://github.com/NoeFabris/opencode-antigravity-auth/blob/main/docs/CONFIGURATION.md),
  [troubleshooting](https://github.com/NoeFabris/opencode-antigravity-auth/blob/main/docs/TROUBLESHOOTING.md).
- OpenCode docs: [plugins](https://opencode.ai/docs/plugins/) and
  [configuration](https://opencode.ai/docs/config/).
- [Official TOS appeal form](https://forms.gle/hGzM9MEUv2azZsrb9) and
  [community appeal thread](https://discuss.ai.google.dev/t/account-disabled-for-tos-violation-in-google-antigravity-where-to-submit-an-appeal/200686).

## License

MIT (see [LICENSE](LICENSE)).
