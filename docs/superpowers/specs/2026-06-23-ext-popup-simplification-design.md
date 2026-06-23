# Extension Popup Simplification + Domain Picker — Design

Date: 2026-06-23
Scope: **`ext/` only.** No changes to `api/` or `docker/`.

## Goal

Simplify the CookieCloud browser extension's configuration UI and replace the
free-text "sync domain" / "keep alive" fields with an interactive, per-domain
checkbox list. The on-the-wire upload/download format
(`{ uuid, encrypted, crypto_type }`) is unchanged, so the existing self-hosted
server keeps working without modification.

## Requirements

1. Modify only the browser extension (`ext/`); leave `api/` and `docker/` untouched.
2. Server address is fixed to `https://cookie.readtheone.com`; it is no longer editable in the popup.
3. Encryption algorithm is fixed to `aes-128-cbc-fixed`; no algorithm selector.
4. Remove the request-header field (and its code path).
5. Local storage is always synced; remove the yes/no choice.
6. Replace the sync-domain textarea with a checkbox list that loads and shows all
   domains the browser currently has cookies for; the user multi-selects which to
   sync. Each domain also has a keep-alive checkbox (default off) — when checked,
   the domain is visited once per hour in the background.

## Decisions (resolved during brainstorming)

- **Domain grouping:** by registrable domain (eTLD+1), e.g. `accounts.google.com`
  and `.google.com` collapse to `google.com`. Selecting a domain syncs all of its
  subdomains.
- **Blacklist field:** removed — leaving a domain unchecked replaces it.
- **Default checkbox state:** all unchecked on first load. A domain syncs / keeps
  alive only if explicitly checked. Domains that appear later are unchecked too.
- **Keep alive:** per-domain checkbox (not a separate textarea). Checked = the
  background worker visits `https://<domain>/` once per hour. Default unchecked.
- **eTLD+1 computation:** add the `tldts` dependency for a correct Public-Suffix-List
  based registrable domain (handles `.com.cn`, `.co.uk`, `.gov.cn`, etc.).
- **Keep-alive + domain list visibility:** shown in **upload mode only**, matching
  the current behavior where the domain config appeared only in `up` mode.

## Configuration model

The `COOKIE_SYNC_SETTING` object stored in `browser.storage.local` changes:

Removed keys: `endpoint`, `crypto_type`, `headers`, `with_storage`, `domains`,
`blacklist`, `keep_live`.

Added keys:

```ts
selected_domains: string[];    // registrable domains whose cookies + local storage to sync
keep_alive_domains: string[];  // registrable domains to visit hourly in the background
```

Kept keys: `password`, `interval`, `uuid`, `type` (`up` | `down` | `pause`),
`expire_minutes`.

Only checked domains are stored, so "default unchecked" needs no per-domain record.

Constants (module-level in the extension, not in stored config):

```ts
const ENDPOINT = 'https://cookie.readtheone.com';
const CRYPTO_TYPE = 'aes-128-cbc-fixed';
```

### Backward compatibility

Existing users have a saved config containing the now-removed keys. On load the
popup ignores unknown/removed keys; `selected_domains` and `keep_alive_domains`
default to empty arrays, so an upgraded user starts with nothing selected and
re-picks their domains. This is acceptable and intentional (the selection model
changed). No migration code is written.

## Component changes

### `entrypoints/popup/App.tsx` (major)

- Remove inputs: server address, encryption algorithm `<select>`, request-header
  textarea, with-storage radios, sync-domain textarea, blacklist textarea,
  keep-alive textarea.
- Keep: working mode radios (up/down/pause), UUID (+ regenerate/copy), password
  (+ generate/copy), cookie expire minutes, sync interval.
- Add the **domain list** (upload mode only):
  - On mount (and when switching to up mode), call `browser.cookies.getAll({})`,
    map each cookie's domain to its registrable domain via `tldts`, dedupe, sort
    alphabetically.
  - Render one row per domain: `[sync checkbox] [keep-alive checkbox] domain`.
    A row's sync box is checked iff the domain is in `selected_domains`; its
    keep-alive box is checked iff it is in `keep_alive_domains`.
  - A text filter input narrows the visible rows (substring match on the domain).
  - A "select all / clear" control toggles the sync column for the currently
    visible (filtered) rows.
  - Toggling a checkbox updates the corresponding array in state.
- `save` persists the new config shape; `test` / manual sync call
  `handleConfigMessage` with the constants merged in.

### `utils/functions.ts`

- Introduce `ENDPOINT` / `CRYPTO_TYPE` constants and a `registrable_domain(host)`
  helper backed by `tldts`. When `tldts` cannot derive a registrable domain (IP
  literals, `localhost`, single-label hosts), the helper falls back to the host
  string stripped of a leading dot, so those cookies still group and select
  consistently.
- `upload_cookie`:
  - Build the endpoint from `ENDPOINT`; use `CRYPTO_TYPE`.
  - Always collect local storage (no `with_storage` gate).
  - Collect cookies for `selected_domains` and local storage for `selected_domains`.
  - Remove header-parsing logic; POST uses the fixed gzip/json headers only.
- `download_cookie`: endpoint from `ENDPOINT`; default crypto type `CRYPTO_TYPE`
  (still honors `result.crypto_type` from the server so old blobs decrypt).
- `get_cookie_by_domains(selected_domains)`: drop the blacklist parameter; match a
  cookie to a selected domain when `registrable_domain(cookie.domain) === domain`.
  Group results keyed by the registrable domain.
- `get_local_storage_by_domains(selected_domains)`: match stored `LS-<host>` keys by
  `registrable_domain(host) === domain`.
- `cookie_encrypt` / `cookie_decrypt`: unchanged — both algorithms remain so that
  any previously-stored `legacy` blob can still be decrypted; new uploads always
  use `aes-128-cbc-fixed`.

### `entrypoints/background.ts`

- Sync scheduling (1-minute alarm, interval check, up/down/pause) unchanged.
- Keep-alive: replace `config.keep_live` string parsing with iteration over
  `config.keep_alive_domains`. For each domain, when `minute_count % 60 === 0`,
  visit `https://<domain>/`, reusing the existing logic (if a tab for that URL
  exists and is backgrounded, reload it; otherwise open a pinned inactive tab,
  wait 5s, close it).

### `entrypoints/content.ts`

- Up mode: capture the page's `localStorage` into `LS-<host>` on every page load
  (no domain gate at capture time; the upload step filters by `selected_domains`).
  This guarantees a selected domain's local storage is available without a
  re-visit.
- Down mode: unchanged — apply `LS-<host>` if present, then clear it.

### `_locales/en/messages.json` + `_locales/zh_CN/messages.json`

- Remove keys for the deleted fields (server host, crypto algorithm + descriptions,
  request header, with-storage, domain keyword, blacklist, keep-alive textarea).
- Add keys: domain-list section title, sync column label, keep-alive column label,
  filter placeholder, select-all / clear labels, and an empty-state ("no cookies
  found") message.

### `package.json`

- Add dependency `tldts` (registrable-domain lookup).

## Data flow (unchanged in shape)

Upload: collect selected cookies + local storage → JSON
`{ cookie_data, local_storage_data, update_time }` → encrypt with
`aes-128-cbc-fixed` → gzip → `POST https://cookie.readtheone.com/update`
`{ uuid, encrypted, crypto_type }`. The 24-hour SHA-256 de-dup guard is kept.

Download: `GET /get/:uuid?crypto_type=aes-128-cbc-fixed` → decrypt client-side →
set cookies via `browser.cookies.set`, store local storage as `LS-<host>` for the
content script to apply.

## Testing

- Unit-level: `registrable_domain()` returns expected eTLD+1 for tricky inputs
  (`a.b.google.com` → `google.com`, `x.com.cn` → `x.com.cn`, `.taobao.com` →
  `taobao.com`, IP/`localhost` handled gracefully).
- Manual / behavioral (load the unpacked extension):
  1. Popup lists current cookie domains grouped by registrable domain, all
     unchecked.
  2. Checking sync for a domain and saving causes only that domain's cookies to be
     uploaded; unchecked domains are excluded.
  3. Local storage for a selected domain round-trips (capture on source, apply on
     a download-mode browser).
  4. Checking keep-alive causes an hourly background visit to `https://<domain>/`.
  5. Filter narrows the list; select-all/clear toggles the visible sync boxes.
  6. Upload/download still succeed against an unchanged `api/` server.

## Out of scope

- Server (`api/`, `docker/`) changes.
- Migrating old saved configs to the new model.
- Removing the legacy encryption code path (kept for decrypt compatibility).
