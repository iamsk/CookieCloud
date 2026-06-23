# CookieCloud

[中文](./README_cn.md) | [English](./README.md)

![](ext/public/icon/icon.png)

CookieCloud 是一个和自架服务器同步 Cookie 的小工具，可以将浏览器的 Cookie 及 Local Storage 同步到手机和云端，内置端对端加密，可设定同步时间间隔。

当前版本使用 **[wxt](https://wxt.dev)** 重写（Manifest V3，React + TypeScript），支持同域名下 Local Storage 的同步，并提供两种加密算法：原有的 CryptoJS 算法（动态 IV）和标准的 **AES-128-CBC** 算法（固定 IV，便于任意语言的主流加密库解密）。

[Telegram 频道](https://t.me/CookieCloudTG) | [Telegram 交流群](https://t.me/CookieCloudGroup)

## 仓库结构

这是一个 monorepo，每个顶层目录都是一个独立模块：

| 目录 | 技术栈 | 职责 |
| ---- | ------ | ---- |
| [`ext/`](#ext--浏览器扩展) | wxt + React + TypeScript + Tailwind | 浏览器扩展——采集 Cookie / Local Storage，加密后与服务器同步。项目的核心。 |
| [`api/`](#api--服务器端) | Node.js + Express | 当前的服务器端。按 UUID 存储加密后的密文并按需返回。 |
| [`docker/`](#docker--发布镜像) | Node.js + Express | 用于构建已发布的 `easychen/cookiecloud` Docker 镜像的精简服务端。 |
| [`web/`](#web--落地页) | Vite + React + Tailwind | 双语营销 / 落地页，不参与同步。 |
| [`examples/`](#examples--解密与使用示例) | 多语言 | 解密 CookieCloud 数据以及在无头浏览器中使用的参考实现。 |
| `design/` | Adobe XD | Logo 源文件（`logo.xd`）。 |
| `.github/` | GitHub Actions | 打 tag 时构建 Chrome/Firefox 扩展并发布到商店的 CI。 |
| `RoboFile.php` | Robo | 本地开发、Docker 镜像、扩展构建的任务快捷方式。 |

### `ext/` — 浏览器扩展

扩展是唯一会接触你 Cookie 的组件，使用 [wxt](https://wxt.dev) 构建，以 Manifest V3 发布。

- **`entrypoints/popup/App.tsx`** — React 配置界面。可设置工作模式（上传 / 覆盖 / 暂停）、服务器地址、UUID、端对端密码、加密算法、Cookie 过期时间、同步间隔、是否包含 Local Storage、附加请求 Header、同步域名关键词、域名黑名单以及 Keep Alive 的 URL。配置以 `COOKIE_SYNC_SETTING` 为键保存在本地。
- **`entrypoints/background.ts`** — 后台 Service Worker。注册一个 1 分钟的 alarm，每次触发时读取配置，当经过的分钟数能被同步间隔整除时执行上传或下载（暂停模式则跳过）。同时实现 **Cookie Keep Alive**：定期在后台标签页打开指定 URL 以保持会话活跃。
- **`entrypoints/content.ts`** — 注入到所有页面的内容脚本。上传模式下读取页面的 `localStorage` 并暂存到扩展存储的 `LS-<host>`；覆盖（down）模式下把此前同步的 `LS-<host>` 写回页面的 `localStorage`。由于后台 Worker 无法直接读取页面 `localStorage`，Local Storage 的同步正是通过它实现的。
- **`utils/functions.ts`** — 核心逻辑，**也是唯一进行加密的地方**。按域名 / 黑名单采集 Cookie，收集 Local Storage，执行 `cookie_encrypt` / `cookie_decrypt`，上传（gzip 压缩，并带 24 小时 SHA-256 去重，内容未变则不重复上传），以及下载（通过 `browser.cookies.set` 写入 Cookie，并存下 Local Storage 供内容脚本应用）。详见[加解密算法](#cookie-加解密算法)。
- **`utils/messaging.ts`** — 轻量分发器，将配置载荷路由到 `upload_cookie` 或 `download_cookie`。
- **`public/_locales/`** — `en` 与 `zh_CN` 的 i18n 文案。
- **`wxt.config.ts`** — wxt/manifest 配置。申请的权限：`cookies`、`tabs`、`storage`、`alarms`、`unlimitedStorage` 以及 `<all_urls>` 主机访问。
- **`scripts/release.mjs`** — 交互式发布脚本，负责升版本号、提交、打 tag（`build-v*` / `release-v*`）并推送以触发 CI。

### `api/` — 服务器端

可自托管的 Express 服务（`api/app.js`）。服务器永远拿不到你的密码，只存储密文。

- `POST /update` — 将 `{ encrypted, crypto_type }` 保存到 `data/<uuid>.json`。
- `GET|POST /get/:uuid` — 返回存储的数据。若请求体带 `password` 则在服务端解密并返回解析后的对象，否则返回原始密文字符串。可用 `?crypto_type=` 查询参数指定算法。
- `GET /health` — 健康检查。
- 已加固：CORS、gzip 压缩、限流（单 IP 每 15 分钟 100 次请求）、Winston 文件日志（`api/utils/logger.js`）以及优雅关闭。

### `docker/` — 发布镜像

精简版服务端（`docker/app.js`）加 `docker/Dockerfile`（基于 `node:16-alpine`），是已发布的 [`easychen/cookiecloud`](https://hub.docker.com/r/easychen/cookiecloud) 镜像的源。提供同样的 `/update` 与 `/get/:uuid` 接口。

### `web/` — 落地页

一个静态的 Vite + React + Tailwind 落地页（中英双语），用于宣传项目并链接到商店。纯展示用途，不参与同步流程。

### `examples/` — 解密与使用示例

- **`examples/decrypt.py`** — 获取并解密数据的 Python 脚本，同时支持两种加密算法。
- **`examples/fixediv/`** — `aes-128-cbc-fixed` 算法在 **Node.js、Python、Java（Maven 版与零依赖版）、Go、PHP** 中可直接运行的解密实现，附带共享测试数据和跨语言验证脚本 `test_all.sh`。
- **`examples/playwright/`** — 拉取云端 Cookie 并注入 Playwright 上下文的无头浏览器示例。

## 浏览器插件

1. 商店安装：[Edge 商店](https://microsoftedge.microsoft.com/addons/detail/cookiecloud/bffenpfpjikaeocaihdonmgnjjdpjkeo) | [Chrome 商店](https://chrome.google.com/webstore/detail/cookiecloud/ffjiejobkoibkjlhjnlgmcnnigeelbdl)（商店版本因审核会有延迟）。
2. 手动下载安装：见 Release。

### 从源码构建

```bash
cd ext
pnpm install
pnpm build:chrome      # 或：pnpm build:firefox
pnpm zip:chrome        # 打包成可分发的 zip
```

> Firefox 的 Cookie 格式与 Chrome 系有差异，两者不能混用。

## 官方教程

![](images/20230121141854.png)

1. 视频教程：[B站](https://www.bilibili.com/video/BV1fR4y1a7zb) | [Youtube](https://youtu.be/3oeSiGHXeQw)
2. 图文教程：[掘金](https://juejin.cn/post/7190963442017108027)

## 服务器端 · 自行架设

> 自行架设服务器可以让数据完全掌握在自己手中。

### 方案一：Docker（简单、推荐）

支持架构：linux/amd64、linux/arm64 等。

#### 用 Docker 命令启动

```bash
docker run -p=8088:8088 easychen/cookiecloud:latest
```

默认端口 8088，镜像地址 [easychen/cookiecloud](https://hub.docker.com/r/easychen/cookiecloud)。

##### 指定 API 子目录（可选）

添加环境变量 `-e API_ROOT=/二级目录`（需以斜杠开头）即可指定二级目录：

```bash
docker run -e API_ROOT=/cookie -p=8088:8088 easychen/cookiecloud:latest
```

#### 用 Docker Compose 启动

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

[docker-compose.yml 由 aitixiong 提供](https://github.com/easychen/CookieCloud/issues/42)

### 方案二：Node

> 适用于没有 Docker 但已安装 Node 的环境。

```bash
cd api && yarn install && node app.js
```

默认端口 8088，同样支持 `API_ROOT` 环境变量。

## 调试和日志查看

进入浏览器插件列表，点击 CookieCloud 的 service worker，会弹出一个面板，可查看运行日志。

![](images/20230121095327.png)

## API 接口

上传：

- method：`POST`
- url：`/update`
- 参数：
  - `uuid`
  - `encrypted`：本地加密后的字符串
  - `crypto_type`：可选，所用算法（`legacy` 或 `aes-128-cbc-fixed`）

下载：

- method：`POST` / `GET`
- url：`/get/:uuid`
- 参数：
  - `password`：可选。不提供则返回加密后的字符串，提供则在服务端解密并返回内容。
  - `crypto_type`：可选查询参数，用于强制指定算法。

## Cookie 加解密算法

CookieCloud 是端对端加密的：**UUID** 与 **密码** 不会一起离开你的浏览器，服务器只存储密文。加密与解密都位于 [`ext/utils/functions.ts`](ext/utils/functions.ts)。

### 密钥推导（两种算法共用）

```
the_key = MD5(uuid + '-' + password).hex().substring(0, 16)   // 16 个字符的字符串
```

### 明文格式

加密前的载荷是如下 JSON：

```json
{
  "cookie_data": { "<域名>": [ /* cookie 对象 */ ] },
  "local_storage_data": { "LS-<host>": { "<key>": "<value>" } },
  "update_time": "<ISO 时间戳>"
}
```

解密后再 `JSON.parse` 得到 `{ cookie_data, local_storage_data }`。

### 算法一 — `legacy`（默认，「CryptoJS / 动态 IV」）

`the_key` 作为**口令（passphrase）**传给 CryptoJS。CryptoJS 生成随机的 8 字节 salt，并用 OpenSSL 的 `EVP_BytesToKey`（MD5）派生出真正的 key + IV，得到 **AES-256-CBC**、PKCS7 填充。输出为 OpenSSL 的 `"Salted__" + salt + 密文` 信封并经 Base64 编码——因此每条消息的 IV 都是随机且不同的。

```js
function cookie_decrypt(uuid, encrypted, password) {
  const CryptoJS = require('crypto-js');
  const the_key = CryptoJS.MD5(uuid + '-' + password).toString().substring(0, 16);
  const decrypted = CryptoJS.AES.decrypt(encrypted, the_key).toString(CryptoJS.enc.Utf8);
  return JSON.parse(decrypted);
}
```

### 算法二 — `aes-128-cbc-fixed`（标准，「固定 IV」）

`the_key` 被**直接作为 AES-128 的 16 字节原始密钥**使用，配合**固定的全零 IV**和 PKCS7 填充。输出为原始密文的 Base64（无 `Salted__` 信封）。由于没有自定义 KDF 或 salt 头，这种格式可以用任意语言的标准加密库轻松解密。

- 算法：AES-128-CBC
- 密钥：`MD5(uuid + '-' + password).substring(0, 16)`（作为 UTF-8 字节）
- IV：16 个零字节
- 填充：PKCS7
- 编码：Base64

```js
function cookie_decrypt_fixed(uuid, encrypted, password) {
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

### 其他语言的解密

- **`aes-128-cbc-fixed`** — Node.js、Python、Java、Go、PHP 的可直接运行实现位于 [`examples/fixediv/`](examples/fixediv/)，并附带验证它们输出一致的 `test_all.sh`。
- **`legacy`** — Python 及其他语言参考：见 [`examples/decrypt.py`](examples/decrypt.py)、[PyCookieCloud](https://github.com/lupohan44/PyCookieCloud)、[Python 加解密文章](https://blog.homurax.com/2022/08/12/python-crypto/)、[Go 参考](https://github.com/easychen/CookieCloud/issues/49) 以及 [Deno 参考](https://github.com/easychen/CookieCloud/issues/41)。

## 无头浏览器使用 CookieCloud

请参考 [`examples/playwright/tests/example.spec.js`](examples/playwright/tests/example.spec.js)。

```javascript
test('使用CookieCloud访问nexusphp', async ({ page, browser }) => {
  // 读取云端 cookie 并解密
  const cookies = await cloud_cookie(COOKIE_CLOUD_HOST, COOKIE_CLOUD_UUID, COOKIE_CLOUD_PASSWORD);
  // 注入到全新的浏览器上下文
  const context = await browser.newContext();
  await context.addCookies(cookies);
  page = await context.newPage();
  // 这之后请求已带着 Cookie，按正常流程访问
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

1. 目前只支持单向同步，即一个浏览器上传，一个浏览器下载。
2. 浏览器扩展只官方支持 Chrome 和 Edge。其他 Chrome 内核浏览器可用，但未经测试。可用 `cd ext && pnpm build:firefox` 自行编译 Firefox 版本。注意 Firefox 的 Cookie 格式和 Chrome 系有差异，不能混用。

![](images/20230121092535.png)

## 许可协议

[GPLv3](./LICENSE)
