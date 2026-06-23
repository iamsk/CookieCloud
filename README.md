# CookieCloud

[中文](./README_cn.md) | [English](./README.md)

![](ext/public/icon/icon.png)

CookieCloud is a small tool for syncing cookies with your self-hosted server. It synchronizes browser cookies and local storage to your phone and the cloud, features built-in end-to-end encryption, and syncs automatically on a schedule.

The current version is rewritten with **[wxt](https://wxt.dev)** (Manifest V3, React + TypeScript). It always syncs local storage alongside cookies and encrypts with a standard **AES-128-CBC** (fixed IV) scheme that is easy to decrypt with mainstream crypto libraries in any language. The extension is driven by a single secret: you set only an end-to-end **password**, and the storage **UUID** is derived from it automatically. The server endpoint is fixed in the build (the `ENDPOINT` constant in [`ext/utils/functions.ts`](ext/utils/functions.ts)). The server and the reference decryptors still understand the older `legacy` CryptoJS format for previously-stored data.

[Telegram channel](https://t.me/CookieCloudTG) | [Telegram group](https://t.me/CookieCloudGroup)

## Repository Structure

This is a monorepo. Each top-level directory is an independent module:

| Directory | Stack | Responsibility |
| --------- | ----- | -------------- |
| [`ext/`](#ext--browser-extension) | wxt + React + TypeScript + Tailwind | The browser extension — collects cookies / local storage, encrypts them, and syncs with the server. The heart of the project. |
| [`api/`](#api--server-side) | Node.js + Express | The current server side. Stores the encrypted blob keyed by UUID and serves it back. |
| [`docker/`](#docker--published-image) | Node.js + Express | A minimal server used to build the published `easychen/cookiecloud` Docker image. |
| [`web/`](#web--landing-page) | Vite + React + Tailwind | The bilingual marketing / landing page. Not involved in syncing. |
| [`examples/`](#examples--decryption--usage-references) | Multi-language | Reference implementations for decrypting CookieCloud data and using it in headless browsers. |
| `design/` | Adobe XD | Source file for the logo (`logo.xd`). |
| `.github/` | GitHub Actions | CI that builds the Chrome/Firefox extension on tag push and publishes to the stores. |
| `RoboFile.php` | Robo | Task runner shortcuts for local dev, the Docker image, and extension builds. |

### `ext/` — Browser Extension

The extension is the only component that touches your cookies. It is built with [wxt](https://wxt.dev) and ships as Manifest V3.

- **`entrypoints/popup/App.tsx`** — the React configuration UI. A three-state segmented control on the first row picks the working mode (upload / overwrite / pause). The only secret you enter is the end-to-end **password** — the storage UUID is derived from it automatically (via `derive_uuid`) and is never shown or edited. In upload mode it lists every domain the browser has cookies for, grouped by registrable domain, each row with a **sync** checkbox and a **keep-alive** checkbox (both default off), plus a filter box and select-all/clear. The config is persisted locally under the key `COOKIE_SYNC_SETTING`.
- **`entrypoints/background.ts`** — the background service worker. It registers a 1-minute alarm; on each tick it reads the saved config and, when the elapsed minutes are divisible by the sync interval (default 10), runs an upload or a download (or does nothing in pause mode). It also implements **Cookie Keep Alive**: for every domain whose keep-alive box is checked, it visits `https://<domain>/` in a background tab once per hour to keep the session alive.
- **`entrypoints/content.ts`** — a content script injected into every page. In upload mode it reads the page's `localStorage` on every load and stashes it in extension storage under `LS-<host>` (the upload step filters it by the selected domains). In overwrite ("down") mode it writes the previously-synced values from `LS-<host>` back into the page's `localStorage`. This is how local storage sync is achieved, since the background worker cannot read a page's `localStorage` directly.
- **`utils/functions.ts`** — the core logic and **the only place encryption happens**. It collects cookies and local storage for the selected registrable domains, derives the UUID from the password (`derive_uuid`), encrypts with the fixed `aes-128-cbc-fixed` scheme, uploads (gzip-compressed, with a 24-hour SHA-256 de-duplication guard so unchanged data is not re-uploaded), and downloads (writing cookies via `browser.cookies.set` and storing local storage for the content script to apply). The fixed server endpoint (`ENDPOINT`) and algorithm (`CRYPTO_TYPE`) are module-level constants here. See [Encryption](#cookie-encryption-and-decryption-algorithm).
- **`utils/domain.ts`** — computes the registrable domain (eTLD+1) of a host via `tldts`; used to group the popup's domain list and to match cookies / local storage at sync time so the two always agree.
- **`utils/messaging.ts`** — a thin dispatcher that routes a config payload to `upload_cookie` or `download_cookie`.
- **`public/_locales/`** — i18n messages for `en` and `zh_CN`.
- **`wxt.config.ts`** — wxt/manifest config. Requested permissions: `cookies`, `tabs`, `storage`, `alarms`, `unlimitedStorage`, and `<all_urls>` host access.
- **`scripts/release.mjs`** — an interactive release helper that bumps the version, commits, tags (`build-v*` / `release-v*`), and pushes to trigger CI.

### `api/` — Server Side

A self-hostable Express server (`api/app.js`). The server never sees your password and stores only the encrypted blob.

- `POST /update` — saves `{ encrypted, crypto_type }` to `data/<uuid>.json`.
- `GET|POST /get/:uuid` — returns the stored blob. If a `password` is supplied in the body it decrypts server-side and returns the parsed object; otherwise it returns the raw encrypted string. A `?crypto_type=` query parameter can override the algorithm.
- `GET /health` — health check.
- Hardened with CORS, gzip compression, rate limiting (100 requests / 15 minutes per IP), Winston file logging (`api/utils/logger.js`), and graceful shutdown.

### `docker/` — Published Image

A trimmed-down server (`docker/app.js`) plus `docker/Dockerfile` (based on `node:16-alpine`). This is the source for the published [`easychen/cookiecloud`](https://hub.docker.com/r/easychen/cookiecloud) image. It exposes the same `/update` and `/get/:uuid` endpoints.

### `web/` — Landing Page

A static Vite + React + Tailwind landing page (bilingual EN/ZH) that markets the project and links to the stores. It is purely informational and is not part of the sync pipeline.

### `examples/` — Decryption & Usage References

- **`examples/decrypt.py`** — a Python script that fetches and decrypts data, supporting both encryption algorithms.
- **`examples/fixediv/`** — production-ready decryption of the `aes-128-cbc-fixed` algorithm in **Node.js, Python, Java (Maven & dependency-free), Go, and PHP**, with shared test data and a `test_all.sh` cross-language verification script.
- **`examples/playwright/`** — a headless-browser example that pulls cloud cookies and injects them into a Playwright context.

## Browser Plugin

1. Install from a store: [Edge Store](https://microsoftedge.microsoft.com/addons/detail/cookiecloud/bffenpfpjikaeocaihdonmgnjjdpjkeo) | [Chrome Store](https://chrome.google.com/webstore/detail/cookiecloud/ffjiejobkoibkjlhjnlgmcnnigeelbdl) (store versions may lag due to review).
2. Manual download and install: see Release.

### Build from source

```bash
cd ext
pnpm install
pnpm build:chrome      # or: pnpm build:firefox
pnpm zip:chrome        # package a distributable zip
```

> Firefox's cookie format differs from Chrome's and the two cannot be mixed.

## Official Tutorials

![](images/20230121141854.png)

1. Video: [Bilibili](https://www.bilibili.com/video/BV1fR4y1a7zb) | [YouTube](https://youtu.be/3oeSiGHXeQw)
2. Tutorial: [Juejin](https://juejin.cn/post/7190963442017108027)

## Server Side · Self-hosting

> Hosting your own server keeps your data fully under your control.

> The extension's server endpoint is hardcoded as the `ENDPOINT` constant in [`ext/utils/functions.ts`](ext/utils/functions.ts). To point a build at your own server, change that constant and rebuild the extension.

### Option One: Docker (simple, recommended)

Supports architectures: linux/amd64, linux/arm64, etc.

#### Start with the Docker command

```bash
docker run -p=8088:8088 easychen/cookiecloud:latest
```

Default port 8088, image [easychen/cookiecloud](https://hub.docker.com/r/easychen/cookiecloud).

##### Specify an API subdirectory (optional)

Add the environment variable `-e API_ROOT=/subdirectory` (must start with a slash):

```bash
docker run -e API_ROOT=/cookie -p=8088:8088 easychen/cookiecloud:latest
```

#### Start with Docker Compose

```yml
version: '3'
services:
  cookiecloud:
    image: easychen/cookiecloud:latest
    container_name: cookiecloud-app
    restart: always
    volumes:
      - ./data:/data/api/data
    ports:
      - 8088:8088
```

[docker-compose.yml provided by aitixiong](https://github.com/easychen/CookieCloud/issues/42)

### Option Two: Node

> For environments without Docker but with Node installed.

```bash
cd api && yarn install && node app.js
```

Default port 8088; also honours the `API_ROOT` environment variable.

## Debugging and Logs

Open the browser's extension list, click the service worker for CookieCloud, and a panel pops up where you can view the runtime log.

![](images/20230121095327.png)

## API Interface

Upload:

- method: `POST`
- url: `/update`
- parameters:
  - `uuid`
  - `encrypted`: the string encrypted locally
  - `crypto_type`: optional, the algorithm used (`legacy` or `aes-128-cbc-fixed`)

Download:

- method: `POST` / `GET`
- url: `/get/:uuid`
- parameters:
  - `password`: optional. If omitted, the raw encrypted string is returned; if provided, the server decrypts and returns the content.
  - `crypto_type`: optional query parameter to force a specific algorithm.

## Cookie Encryption and Decryption Algorithm

CookieCloud is end-to-end encrypted: the server only ever stores ciphertext. The **password** is the single secret and never leaves your browser. Encryption and decryption both live in [`ext/utils/functions.ts`](ext/utils/functions.ts).

### Identity — the UUID is derived from the password

The storage UUID (the address the blob lives at, `data/<uuid>.json`) is derived from the password with a one-way hash, so you manage one secret and the same password points every browser at the same record:

```
uuid = MD5('cookiecloud-' + password).hex()   // see derive_uuid()
```

Because it is a one-way hash, the UUID can safely appear in URLs without revealing the password. The flip side: the password is now the *only* thing protecting your data, so use a strong one (the popup's "generate" button creates a 22-character random one).

### Encryption key

```
the_key = MD5(uuid + '-' + password).hex().substring(0, 16)   // a 16-character string
```

### Plaintext format

Before encryption, the payload is JSON:

```json
{
  "cookie_data": { "<domain>": [ /* cookie objects */ ] },
  "local_storage_data": { "LS-<host>": { "<key>": "<value>" } },
  "update_time": "<ISO timestamp>"
}
```

After decryption you `JSON.parse` it back into `{ cookie_data, local_storage_data }`.

### What the extension uses — `aes-128-cbc-fixed`

`the_key` is used **directly as the 16 raw bytes** of an **AES-128** key, with a **fixed all-zero IV** and PKCS7 padding. The output is the Base64 of the raw ciphertext (no `Salted__` envelope). Because there is no custom KDF or salt header, this format is trivial to decrypt with the standard crypto library of any language.

- Algorithm: AES-128-CBC
- Key: `MD5(uuid + '-' + password).substring(0, 16)` (as UTF-8 bytes)
- IV: 16 bytes of zero
- Padding: PKCS7
- Encoding: Base64

```js
function cookie_decrypt(uuid, encrypted, password) {
  const CryptoJS = require('crypto-js');
  const the_key = CryptoJS.MD5(uuid + '-' + password).toString().substring(0, 16);
  const options = {
    iv: CryptoJS.enc.Hex.parse('00000000000000000000000000000000'),
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  };
  const decrypted = CryptoJS.AES
    .decrypt(encrypted, CryptoJS.enc.Utf8.parse(the_key), options)
    .toString(CryptoJS.enc.Utf8);
  return JSON.parse(decrypted);
}
```

### Legacy format — `legacy` (CryptoJS / dynamic IV)

The extension no longer produces this format, but the server and the reference decryptors still read it so previously-stored blobs stay decryptable. Here `the_key` is passed to CryptoJS as a **passphrase**: CryptoJS generates a random 8-byte salt and derives the real key + IV with OpenSSL's `EVP_BytesToKey` (MD5), producing **AES-256-CBC** with PKCS7 padding. The output is the OpenSSL `"Salted__" + salt + ciphertext` envelope, Base64-encoded — so the IV is random for every message.

```js
function cookie_decrypt_legacy(uuid, encrypted, password) {
  const CryptoJS = require('crypto-js');
  const the_key = CryptoJS.MD5(uuid + '-' + password).toString().substring(0, 16);
  const decrypted = CryptoJS.AES.decrypt(encrypted, the_key).toString(CryptoJS.enc.Utf8);
  return JSON.parse(decrypted);
}
```

### Decryption in other languages

- **`aes-128-cbc-fixed`** — ready-to-run implementations for Node.js, Python, Java, Go, and PHP live in [`examples/fixediv/`](examples/fixediv/), along with a `test_all.sh` that verifies they all produce identical output.
- **`legacy`** — Python and other-language references: see [`examples/decrypt.py`](examples/decrypt.py), [PyCookieCloud](https://github.com/lupohan44/PyCookieCloud), the [Python crypto write-up](https://blog.homurax.com/2022/08/12/python-crypto/), the [Go reference](https://github.com/easychen/CookieCloud/issues/49), and the [Deno reference](https://github.com/easychen/CookieCloud/issues/41).

## Using CookieCloud in a Headless Browser

See [`examples/playwright/tests/example.spec.js`](examples/playwright/tests/example.spec.js).

```javascript
test('Access nexusphp using CookieCloud', async ({ page, browser }) => {
  // Read and decrypt the cloud cookies
  const cookies = await cloud_cookie(COOKIE_CLOUD_HOST, COOKIE_CLOUD_UUID, COOKIE_CLOUD_PASSWORD);
  // Inject them into a fresh browser context
  const context = await browser.newContext();
  await context.addCookies(cookies);
  page = await context.newPage();
  // From here on the requests carry the cookies — browse as usual
  await page.goto('https://demo.nexusphp.org/index.php');
  await expect(page.getByRole('link', { name: 'magik' })).toHaveText('magik');
  await context.close();
});
```

```javascript
async function cloud_cookie(host, uuid, password, crypto_type = 'legacy') {
  const fetch = require('cross-fetch');
  let url = host + '/get/' + uuid;
  if (crypto_type && crypto_type !== 'legacy') url += `?crypto_type=${crypto_type}`;
  const json = await (await fetch(url)).json();
  let cookies = [];
  if (json && json.encrypted) {
    const useCryptoType = crypto_type || json.crypto_type || 'legacy';
    const { cookie_data } = cookie_decrypt(uuid, json.encrypted, password, useCryptoType);
    for (const key in cookie_data) {
      cookies = cookies.concat(cookie_data[key].map(item => {
        if (item.sameSite == 'unspecified') item.sameSite = 'Lax';
        return item;
      }));
    }
  }
  return cookies;
}
```

## FAQ

1. Synchronization is one-way: one browser uploads while another downloads.
2. The extension officially supports Chrome and Edge. Other Chromium-based browsers should work but are untested. Build a Firefox version yourself with `cd ext && pnpm build:firefox`. Note that Firefox's cookie format differs from Chrome's and cannot be mixed.

![](images/20230121092535.png)

## License

[GPLv3](./LICENSE)
