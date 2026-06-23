# Extension Popup Simplification + Domain Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify the CookieCloud extension popup (fixed server + algorithm, no header/storage toggles) and replace the free-text domain/keep-alive fields with a per-domain checkbox list grouped by registrable domain.

**Architecture:** All work is inside `ext/`. The upload/download wire format (`{ uuid, encrypted, crypto_type }`) is unchanged, so the existing `api/`/`docker/` server is untouched. A new pure helper module computes registrable domains (eTLD+1) via `tldts`; the popup, sync logic, and keep-alive scheduler consume it.

**Tech Stack:** wxt, React 18 + TypeScript, Tailwind, crypto-js, pako, `tldts` (new), `vitest` (new, dev-only).

**Spec:** `docs/superpowers/specs/2026-06-23-ext-popup-simplification-design.md`

**Note:** All `git commit` commands below end with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.

---

## File Structure

- **Create** `ext/utils/domain.ts` — pure `registrable_domain(host)` + `group_domains(hosts)` helpers (imports only `tldts`, no `browser` globals, so it is unit-testable with plain vitest).
- **Create** `ext/utils/domain.test.ts` — vitest unit tests for the helpers.
- **Modify** `ext/package.json` — add `tldts` dep, `vitest` devDep, `test` script.
- **Modify** `ext/utils/functions.ts` — fixed `ENDPOINT`/`CRYPTO_TYPE`; registrable-domain matching; drop header/with_storage/blacklist logic.
- **Modify** `ext/entrypoints/popup/App.tsx` — rewrite the form (remove fields, add the domain checkbox list).
- **Modify** `ext/entrypoints/background.ts` — keep-alive driven by `keep_alive_domains`.
- **Modify** `ext/entrypoints/content.ts` — capture localStorage on every page in upload mode.
- **Modify** `ext/public/_locales/en/messages.json` and `ext/public/_locales/zh_CN/messages.json` — add/remove keys.

---

## Task 1: Add dependencies and the registrable-domain helper (TDD)

**Files:**
- Modify: `ext/package.json`
- Create: `ext/utils/domain.ts`
- Test: `ext/utils/domain.test.ts`

- [ ] **Step 1: Add deps and test script to `ext/package.json`**

In the `"scripts"` block add:
```json
    "test": "vitest run",
```
In `"dependencies"` add:
```json
    "tldts": "^6.1.0",
```
In `"devDependencies"` add:
```json
    "vitest": "^2.1.8",
```

- [ ] **Step 2: Install**

Run: `cd ext && pnpm install`
Expected: completes; `tldts` and `vitest` added to `node_modules`.

- [ ] **Step 3: Write the failing test**

Create `ext/utils/domain.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { registrable_domain, group_domains } from './domain';

describe('registrable_domain', () => {
  it('collapses subdomains to eTLD+1', () => {
    expect(registrable_domain('accounts.google.com')).toBe('google.com');
  });
  it('strips a leading dot', () => {
    expect(registrable_domain('.taobao.com')).toBe('taobao.com');
  });
  it('keeps multi-part public suffixes (CN)', () => {
    expect(registrable_domain('shop.example.com.cn')).toBe('example.com.cn');
  });
  it('falls back to the host for IP literals', () => {
    expect(registrable_domain('192.168.1.1')).toBe('192.168.1.1');
  });
  it('falls back to the host for localhost', () => {
    expect(registrable_domain('localhost')).toBe('localhost');
  });
  it('returns empty string for empty input', () => {
    expect(registrable_domain('')).toBe('');
  });
});

describe('group_domains', () => {
  it('dedupes and sorts registrable domains', () => {
    expect(
      group_domains(['.google.com', 'accounts.google.com', 'b.qq.com', 'a.qq.com'])
    ).toEqual(['google.com', 'qq.com']);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd ext && pnpm test`
Expected: FAIL — cannot resolve `./domain`.

- [ ] **Step 5: Write the helper**

Create `ext/utils/domain.ts`:
```ts
import { getDomain } from 'tldts';

/**
 * Registrable domain (eTLD+1) for a host or cookie domain.
 * Falls back to the host without a leading dot when tldts cannot resolve one
 * (IP literals, localhost, single-label hosts).
 */
export function registrable_domain(host: string): string {
  if (!host) return '';
  const cleaned = host.replace(/^\./, '');
  return getDomain(cleaned) || cleaned;
}

/** Group cookie domains into a sorted, de-duplicated list of registrable domains. */
export function group_domains(hosts: string[]): string[] {
  const set = new Set<string>();
  for (const h of hosts) {
    const d = registrable_domain(h);
    if (d) set.add(d);
  }
  return Array.from(set).sort();
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd ext && pnpm test`
Expected: PASS — all 7 assertions green.

- [ ] **Step 7: Commit**

```bash
git add ext/package.json ext/pnpm-lock.yaml ext/utils/domain.ts ext/utils/domain.test.ts
git commit -m "feat(ext): add registrable-domain helper backed by tldts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Rewrite sync logic in `functions.ts`

**Files:**
- Modify: `ext/utils/functions.ts`

- [ ] **Step 1: Add the import and constants**

Replace:
```ts
import CryptoJS from 'crypto-js';
import { gzip } from 'pako';
```
with:
```ts
import CryptoJS from 'crypto-js';
import { gzip } from 'pako';
import { registrable_domain } from './domain';

const ENDPOINT = 'https://cookie.readtheone.com';
const CRYPTO_TYPE = 'aes-128-cbc-fixed';
```

- [ ] **Step 2: Replace the `UploadPayload` and `DownloadPayload` interfaces**

Replace the two interface blocks with:
```ts
interface UploadPayload {
  uuid: string;
  password: string;
  type?: string;
  interval?: number;
  selected_domains?: string[];
  keep_alive_domains?: string[];
  no_cache?: number;
  expire_minutes?: number;
}

interface DownloadPayload {
  uuid: string;
  password: string;
  expire_minutes?: number;
}
```

- [ ] **Step 3: Replace `upload_cookie`**

Replace the whole `upload_cookie` function with:
```ts
export async function upload_cookie(payload: UploadPayload): Promise<any> {
  const { uuid, password } = payload;
  if (!password || !uuid) {
    alert("Invalid parameters");
    showBadge("err");
    return false;
  }
  const selected_domains = Array.isArray(payload.selected_domains) ? payload.selected_domains : [];

  const cookies = await get_cookie_by_domains(selected_domains);
  const local_storages = await get_local_storage_by_domains(selected_domains);

  const headers: any = { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' };

  const data_to_encrypt = JSON.stringify({ "cookie_data": cookies, "local_storage_data": local_storages, "update_time": new Date() });
  const encrypted = cookie_encrypt(uuid, data_to_encrypt, password, CRYPTO_TYPE);
  const endpoint = ENDPOINT + '/update';

  const sha256 = CryptoJS.SHA256(uuid + "-" + password + "-" + endpoint + "-" + data_to_encrypt).toString();
  const last_uploaded_info = await load_data('LAST_UPLOADED_COOKIE');
  // If identical content was uploaded within 24 hours, skip.
  if ((!payload.no_cache || parseInt(payload.no_cache.toString()) < 1) && last_uploaded_info && last_uploaded_info.sha256 === sha256 && new Date().getTime() - last_uploaded_info.timestamp < 1000 * 60 * 60 * 24) {
    console.log("same data in 24 hours, skip1");
    return { action: 'done', note: 'Local Cookie data unchanged, not uploading' };
  }

  const payload2 = { uuid, encrypted, crypto_type: CRYPTO_TYPE };
  try {
    showBadge("↑", "green");
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: gzip(JSON.stringify(payload2)) as any
    });
    const result = await response.json();
    if (result && result.action === 'done')
      await save_data('LAST_UPLOADED_COOKIE', { "timestamp": new Date().getTime(), "sha256": sha256 });
    return result;
  } catch (error) {
    console.log("error", error);
    showBadge("err");
    return false;
  }
}
```

- [ ] **Step 4: Replace `download_cookie`**

Replace the whole `download_cookie` function with:
```ts
export async function download_cookie(payload: DownloadPayload): Promise<any> {
  const { uuid, password, expire_minutes } = payload;
  const endpoint = ENDPOINT + '/get/' + uuid;
  try {
    showBadge("↓", "blue");
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    const result = await response.json();
    if (result && result.encrypted) {
      const useCryptoType = result.crypto_type || CRYPTO_TYPE;
      const { cookie_data, local_storage_data } = cookie_decrypt(uuid, result.encrypted, password, useCryptoType);
      let action = 'done';
      if (cookie_data) {
        for (let domain in cookie_data) {
          if (Array.isArray(cookie_data[domain])) {
            for (let cookie of cookie_data[domain]) {
              let new_cookie: any = {};
              ['name', 'value', 'domain', 'path', 'secure', 'httpOnly', 'sameSite'].forEach(key => {
                if (key == 'sameSite' && cookie[key].toLowerCase() == 'unspecified' && is_firefox()) {
                  new_cookie['sameSite'] = 'no_restriction';
                } else {
                  new_cookie[key] = cookie[key];
                }
              });
              if (expire_minutes) {
                const now = parseInt((new Date().getTime() / 1000).toString());
                new_cookie.expirationDate = now + parseInt(expire_minutes.toString()) * 60;
              }
              new_cookie.url = buildUrl(cookie.secure, cookie.domain, cookie.path);
              try {
                await browser.cookies.set(new_cookie);
              } catch (error) {
                showBadge("err");
                console.log("set cookie error", error);
              }
            }
          }
        }
      } else {
        action = 'false';
      }

      if (local_storage_data) {
        for (let domain in local_storage_data) {
          const key = 'LS-' + domain;
          await save_data(key, local_storage_data[domain]);
        }
      }

      return { action };
    }
  } catch (error) {
    console.log("error", error);
    showBadge("err");
    return false;
  }
}
```

- [ ] **Step 5: Replace `get_local_storage_by_domains`**

Replace the whole function with:
```ts
export async function get_local_storage_by_domains(domains: string[] = []): Promise<LocalStorageData> {
  let ret_storage: LocalStorageData = {};
  if (!Array.isArray(domains) || domains.length === 0) return ret_storage;
  const local_storages = await browser_load_all('LS-'); // keys are hosts (prefix stripped)
  for (const host in local_storages) {
    if (domains.includes(registrable_domain(host))) {
      ret_storage[host] = local_storages[host];
    }
  }
  return ret_storage;
}
```

- [ ] **Step 6: Replace `get_cookie_by_domains`**

Replace the whole function with:
```ts
async function get_cookie_by_domains(domains: string[] = []): Promise<CookieData> {
  let ret_cookies: CookieData = {};
  if (browser.cookies && Array.isArray(domains) && domains.length > 0) {
    const cookies = await browser.cookies.getAll({ partitionKey: {} });
    for (const domain of domains) ret_cookies[domain] = [];
    for (const cookie of cookies) {
      if (!cookie.domain) continue;
      const root = registrable_domain(cookie.domain);
      if (ret_cookies[root]) {
        ret_cookies[root].push(cookie);
      }
    }
  }
  return ret_cookies;
}
```

- [ ] **Step 7: Typecheck**

Run: `cd ext && pnpm compile`
Expected: PASS — no TypeScript errors. (`cookie_encrypt`/`cookie_decrypt` are unchanged and still present.)

- [ ] **Step 8: Commit**

```bash
git add ext/utils/functions.ts
git commit -m "feat(ext): fix endpoint+algorithm, match cookies by registrable domain

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Rewrite the popup form

**Files:**
- Modify: `ext/entrypoints/popup/App.tsx`

- [ ] **Step 1: Replace the entire file**

Replace the full contents of `ext/entrypoints/popup/App.tsx` with:
```tsx
import React, { useState, useEffect } from 'react';
import { load_data, save_data } from '../../utils/functions';
import { handleConfigMessage } from '../../utils/messaging';
import { group_domains } from '../../utils/domain';
import short_uid from 'short-uuid';
import browser from 'webextension-polyfill';
import { CopyToClipboard } from 'react-copy-to-clipboard';

const CopyIcon: React.FC<{ className?: string }> = ({ className = "w-4 h-4" }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
  </svg>
);

interface ConfigData {
  password: string;
  interval: number;
  uuid: string;
  type: string;
  expire_minutes: number;
  selected_domains: string[];
  keep_alive_domains: string[];
}

const msg = (key: string, fallback: string) => browser.i18n.getMessage(key) || fallback;

const CookieCloudPopup: React.FC = () => {
  const [data, setData] = useState<ConfigData>({
    password: "",
    interval: 10,
    uuid: String(short_uid.generate()),
    type: "up",
    expire_minutes: 60 * 24 * 365,
    selected_domains: [],
    keep_alive_domains: [],
  });
  const [allDomains, setAllDomains] = useState<string[]>([]);
  const [filter, setFilter] = useState("");

  // Load saved config, dropping removed keys.
  useEffect(() => {
    (async () => {
      try {
        const saved = await load_data("COOKIE_SYNC_SETTING");
        if (saved) {
          setData(prev => ({
            ...prev,
            password: saved.password ?? prev.password,
            interval: Number(saved.interval ?? prev.interval),
            uuid: saved.uuid ?? prev.uuid,
            type: saved.type ?? prev.type,
            expire_minutes: Number(saved.expire_minutes ?? prev.expire_minutes),
            selected_domains: Array.isArray(saved.selected_domains) ? saved.selected_domains : [],
            keep_alive_domains: Array.isArray(saved.keep_alive_domains) ? saved.keep_alive_domains : [],
          }));
        }
      } catch (error) {
        console.error('Failed to load data:', error);
      }
    })();
  }, []);

  // Enumerate the browser's cookie domains (upload mode only).
  useEffect(() => {
    if (data.type !== 'up') return;
    (async () => {
      try {
        const cookies = await browser.cookies.getAll({});
        setAllDomains(group_domains(cookies.map(c => c.domain || '').filter(Boolean)));
      } catch (error) {
        console.error('Failed to load domains:', error);
      }
    })();
  }, [data.type]);

  const handleInputChange = (field: keyof ConfigData, value: string | number) => {
    setData(prev => ({ ...prev, [field]: value }));
  };

  const toggleInArray = (field: 'selected_domains' | 'keep_alive_domains', domain: string) => {
    setData(prev => {
      const set = new Set(prev[field]);
      if (set.has(domain)) set.delete(domain); else set.add(domain);
      return { ...prev, [field]: Array.from(set) };
    });
  };

  const visibleDomains = allDomains.filter(d => d.includes(filter.trim()));

  const setSyncForVisible = (checked: boolean) => {
    setData(prev => {
      const set = new Set(prev.selected_domains);
      visibleDomains.forEach(d => { if (checked) set.add(d); else set.delete(d); });
      return { ...prev, selected_domains: Array.from(set) };
    });
  };

  const test = async (action: string = msg('test', '测试')) => {
    if (!data.password || !data.uuid || !data.type) {
      alert(msg("fullMessagePlease", "请填写完整的信息"));
      return;
    }
    if (data.type === 'pause') {
      alert(msg("actionNotAllowedInPause", "暂停状态下无法进行此操作"));
      return;
    }
    try {
      const ret = await handleConfigMessage({ ...data, no_cache: 1 });
      if (ret && ret.message === 'done') {
        alert(ret.note ? ret.note : action + msg('success', '成功'));
      } else {
        alert(action + msg('failedCheckInfo', '失败，请检查填写的信息是否正确'));
      }
    } catch (error) {
      console.error('Test failed:', error);
      alert(action + msg('failedCheckInfo', '失败，请检查填写的信息是否正确'));
    }
  };

  const save = async () => {
    if (!data.password || !data.uuid || !data.type) {
      alert(msg("fullMessagePlease", "请填写完整的信息"));
      return;
    }
    try {
      await save_data("COOKIE_SYNC_SETTING", data);
      alert(msg("saveSucess", "保存成功"));
    } catch (error) {
      console.error('Save failed:', error);
      alert('Save failed');
    }
  };

  const uuidRegen = () => handleInputChange('uuid', String(short_uid.generate()));
  const passwordGen = () => handleInputChange('password', String(short_uid.generate()));
  const onCopySuccess = (type: 'UUID' | 'Password') => alert(`${type} ${msg('copySuccess', '已复制到剪贴板')}`);

  const modes: [string, string][] = [
    ['up', msg('upToServer', '上传到服务器')],
    ['down', msg('overwriteToBrowser', '覆盖到浏览器')],
    ['pause', msg('pauseSync', '暂停同步')],
  ];

  return (
    <div className="w-96 overflow-x-hidden bg-white rounded-lg shadow-lg flex flex-col h-[600px] relative">
      <div className="flex-1 overflow-y-auto p-5 pb-20">
        <div className="text-center mb-5 pb-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-800">CookieCloud</h2>
        </div>

        <div className="space-y-4">
          {/* Working Mode */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-2">{msg('workingMode', '工作模式')}</label>
            <div className="flex flex-wrap gap-4">
              {modes.map(([val, label]) => (
                <label key={val} className="flex items-center">
                  <input type="radio" name="type" value={val} checked={data.type === val}
                    onChange={(e) => handleInputChange('type', e.target.value)} className="mr-2" />
                  {label}
                </label>
              ))}
            </div>
            {data.type === 'down' && (
              <div className="bg-red-600 text-white p-3 mt-2 rounded">{msg('overwriteModeDesp', '覆盖模式主要用于云端和只读用的浏览器，Cookie和Local Storage覆盖可能导致当前浏览器的登录和修改操作失效；另外部分网站不允许同一个cookie在多个浏览器同时登录，可能导致其他浏览器上账号退出。')}</div>
            )}
          </div>

          {data.type !== 'pause' && (
            <>
              {/* UUID */}
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">{msg('uuid', 'User KEY · UUID')}</label>
                <div className="flex">
                  <div className="relative flex-1">
                    <input type="text" className="form-input pl-10 pr-3" value={data.uuid}
                      onChange={(e) => handleInputChange('uuid', e.target.value)} />
                    <CopyToClipboard text={data.uuid} onCopy={() => onCopySuccess('UUID')}>
                      <button className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600" title="复制 UUID"><CopyIcon /></button>
                    </CopyToClipboard>
                  </div>
                  <button className="ml-2 px-3 py-2 bg-gray-500 text-white rounded hover:bg-gray-600" onClick={uuidRegen}>{msg('reGenerate', '重新生成')}</button>
                </div>
              </div>

              {/* Password */}
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">{msg('syncPassword', '端对端加密密码')}</label>
                <div className="flex">
                  <div className="relative flex-1">
                    <input type="password" className="form-input pl-10 pr-3" placeholder={msg('syncPasswordPlaceholder', '丢失后数据失效，请妥善保管')} value={data.password}
                      onChange={(e) => handleInputChange('password', e.target.value)} />
                    <CopyToClipboard text={data.password} onCopy={() => onCopySuccess('Password')}>
                      <button className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600" title="复制密码"><CopyIcon /></button>
                    </CopyToClipboard>
                  </div>
                  <button className="ml-2 px-3 py-2 bg-gray-500 text-white rounded hover:bg-gray-600" onClick={passwordGen}>{msg('generate', '生成')}</button>
                </div>
              </div>

              {/* Cookie Expiration */}
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">{msg('cookieExpireMinutes', 'Cookie过期时间·分钟')}</label>
                <input type="number" className="form-input" placeholder={msg('cookieExpireMinutesPlaceholder', '0为关闭浏览器后立刻过期')} value={data.expire_minutes}
                  onChange={(e) => handleInputChange('expire_minutes', parseInt(e.target.value) || 0)} />
              </div>

              {/* Sync Interval */}
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">{msg('syncTimeInterval', '同步时间间隔·分钟')}</label>
                <input type="number" className="form-input" min="1" placeholder={msg('syncTimeIntervalPlaceholder', '最少10分钟')} value={data.interval}
                  onChange={(e) => handleInputChange('interval', parseInt(e.target.value) || 10)} />
              </div>

              {/* Domain list (upload mode only) */}
              {data.type === 'up' && (
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-2">{msg('syncDomains', '同步域名')}</label>
                  <input type="text" className="form-input mb-2" placeholder={msg('domainFilterPlaceholder', '过滤域名')} value={filter}
                    onChange={(e) => setFilter(e.target.value)} />
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-1 px-1">
                    <div className="flex gap-2">
                      <span className="w-8 text-center">{msg('columnSync', '同步')}</span>
                      <span className="w-8 text-center">{msg('columnKeepAlive', '保活')}</span>
                    </div>
                    <div className="space-x-2">
                      <button className="text-blue-600 hover:underline" onClick={() => setSyncForVisible(true)}>{msg('selectAll', '全选')}</button>
                      <button className="text-blue-600 hover:underline" onClick={() => setSyncForVisible(false)}>{msg('clearAll', '清空')}</button>
                    </div>
                  </div>
                  <div className="border border-gray-200 rounded max-h-60 overflow-y-auto divide-y divide-gray-100">
                    {visibleDomains.length === 0 && (
                      <div className="p-3 text-sm text-gray-400 text-center">{msg('noCookiesFound', '未找到Cookie域名')}</div>
                    )}
                    {visibleDomains.map(domain => (
                      <div key={domain} className="flex items-center px-2 py-1.5 text-sm">
                        <input type="checkbox" className="w-8" checked={data.selected_domains.includes(domain)}
                          onChange={() => toggleInArray('selected_domains', domain)} />
                        <input type="checkbox" className="w-8" checked={data.keep_alive_domains.includes(domain)}
                          onChange={() => toggleInArray('keep_alive_domains', domain)} />
                        <span className="flex-1 ml-2 truncate text-gray-700">{domain}</span>
                      </div>
                    ))}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">{msg('keepAliveHint', '保活：每小时后台访问一次该域名以保持登录')}</div>
                </div>
              )}
            </>
          )}

          {data.type === 'pause' && (
            <div className="bg-blue-400 text-white p-3 rounded">{msg('keepLiveStop', '暂停同步和保活')}</div>
          )}
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4">
        <div className="flex justify-between">
          <div className="space-x-2">
            {data.type !== 'pause' && (
              <>
                <button className="btn btn-primary text-sm px-3 py-2" onClick={() => test(msg('syncManual', '手动同步'))}>{msg('syncManual', '手动同步')}</button>
                <button className="btn btn-primary text-sm px-3 py-2" onClick={() => test(msg('test', '测试'))}>{msg('test', '测试')}</button>
              </>
            )}
          </div>
          <button className="btn btn-success text-sm px-4 py-2" onClick={save}>{msg('save', '保存')}</button>
        </div>
      </div>
    </div>
  );
};

export default CookieCloudPopup;
```

- [ ] **Step 2: Typecheck**

Run: `cd ext && pnpm compile`
Expected: PASS — no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add ext/entrypoints/popup/App.tsx
git commit -m "feat(ext): rewrite popup with domain checkbox picker

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Keep-alive from `keep_alive_domains` in the background worker

**Files:**
- Modify: `ext/entrypoints/background.ts`

- [ ] **Step 1: Replace the keep-alive block**

Replace this block:
```ts
        if (config.keep_live) {
          // Split by lines, each line format: url|interval
          const keep_live = config.keep_live?.trim()?.split("\n");
          for (let i = 0; i < keep_live.length; i++) {
            const line = keep_live[i];
            // 如果 line 以 #开头，则跳过
            if (line.trim().startsWith("#")) continue;
            const parts = line.split("|");
            const url = parts[0];
            const interval = parts[1] ? parseInt(parts[1]) : 60;
            if (interval > 0 && minute_count % interval == 0) {
              // Start visit
              console.log(`keep live ${url} ${minute_count} ${interval}`);
              
              // Check if target page is already open, if so, don't open again
              // Besides being unnecessary, it also avoids duplicate opening due to network delays
              const [exists_tab] = await browser.tabs.query({"url": `${url.trim().replace(/\/+$/, '')}/*`});
              if (exists_tab && exists_tab.id) {
                console.log(`tab exists ${exists_tab.id}`, exists_tab);
                if (!exists_tab.active) {
                  // refresh tab
                  console.log(`Background status, refresh page`);   
                  await browser.tabs.reload(exists_tab.id);
                } else {
                  console.log(`Foreground status, skip`);   
                }
                return true;
              } else {
                console.log(`tab not exists, open in background`);
              }

              // chrome tab create 
              const tab = await browser.tabs.create({"url": url, "active": false, "pinned": true});
              // Wait 5 seconds then close
              await sleep(5000);
              if (tab.id) {
                await browser.tabs.remove(tab.id);
              }
            }
          }
        }
```
with:
```ts
        // Keep-alive: visit each selected domain once per hour in the background.
        if (Array.isArray(config.keep_alive_domains) && config.keep_alive_domains.length > 0 && minute_count % 60 == 0) {
          for (const domain of config.keep_alive_domains) {
            const url = `https://${domain}/`;
            console.log(`keep live ${url} ${minute_count}`);

            // If a tab for this URL already exists, just refresh it when backgrounded.
            const [exists_tab] = await browser.tabs.query({ "url": `${url.replace(/\/+$/, '')}/*` });
            if (exists_tab && exists_tab.id) {
              if (!exists_tab.active) {
                console.log(`Background status, refresh page`);
                await browser.tabs.reload(exists_tab.id);
              } else {
                console.log(`Foreground status, skip`);
              }
              continue;
            }

            const tab = await browser.tabs.create({ "url": url, "active": false, "pinned": true });
            await sleep(5000);
            if (tab.id) {
              await browser.tabs.remove(tab.id);
            }
          }
        }
```

- [ ] **Step 2: Typecheck**

Run: `cd ext && pnpm compile`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add ext/entrypoints/background.ts
git commit -m "feat(ext): hourly keep-alive driven by keep_alive_domains

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Capture localStorage on every page in upload mode

**Files:**
- Modify: `ext/entrypoints/content.ts`

- [ ] **Step 1: Replace the `main()` body**

Replace the whole `window.addEventListener("load", async () => { ... });` block with:
```ts
    window.addEventListener("load", async () => {
      const host = window.location.hostname;
      const config = await load_data("COOKIE_SYNC_SETTING");

      if (config?.type === 'down') {
        // Overwrite mode: apply any synced localStorage for this host, then clear it.
        const the_data = await load_data("LS-" + host);
        if (the_data) {
          for (const key in the_data) {
            localStorage.setItem(key, the_data[key]);
          }
          await remove_data("LS-" + host);
        }
      } else {
        // Upload mode: stash this page's localStorage; the upload step filters by selected domains.
        const all = localStorage;
        const keys = Object.keys(all);
        const values = Object.values(all);
        const result: any = {};
        for (let i = 0; i < keys.length; i++) {
          result[keys[i]] = values[i];
        }
        if (Object.keys(result).length > 0) {
          await save_data("LS-" + host, result);
        }
      }
    });
```

- [ ] **Step 2: Typecheck**

Run: `cd ext && pnpm compile`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add ext/entrypoints/content.ts
git commit -m "feat(ext): capture localStorage on every page in upload mode

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Update locale messages

**Files:**
- Modify: `ext/public/_locales/en/messages.json`
- Modify: `ext/public/_locales/zh_CN/messages.json`

- [ ] **Step 1: Replace `ext/public/_locales/en/messages.json`**

Replace the entire file with:
```json
{
    "appTitle": {
        "message": "CookieCloud"
    },
    "appDesc": {
        "message": "CookieCloud is a tool for syncing browser cookies to a self-hosted server.",
        "description": "Uses end-to-end encryption to ensure your cookies are secure."
    },
    "test": {
        "message": "Test"
    },
    "fullMessagePlease": {
        "message": "Please fill in all the information"
    },
    "actionNotAllowedInPause": {
        "message": "This action cannot be performed while paused"
    },
    "success": {
        "message": "Success"
    },
    "failedCheckInfo": {
        "message": "Failed, please check if the information entered is correct"
    },
    "saveSucess": {
        "message": "Save Successful"
    },
    "workingMode": {
        "message": "Mode"
    },
    "upToServer": {
        "message": "Upload to Server"
    },
    "overwriteToBrowser": {
        "message": "Overwrite to Browser"
    },
    "pauseSync": {
        "message": "Pause Sync"
    },
    "overwriteModeDesp": {
        "message": "Overwrite mode is mainly used for cloud and read-only browsers. Overwriting Cookies and Local Storage may cause current browser login and modification operations to fail; moreover, some websites do not allow the same cookie to be logged in on multiple browsers at the same time, which may cause account logouts on other browsers."
    },
    "uuid": {
        "message": "User KEY · UUID"
    },
    "reGenerate": {
        "message": "Regenerate"
    },
    "syncPassword": {
        "message": "End-to-End Encryption Password"
    },
    "syncPasswordPlaceholder": {
        "message": "Data will be unable to be decrypted if lost"
    },
    "generate": {
        "message": "Generate"
    },
    "cookieExpireMinutes": {
        "message": "Cookie Expiry Time · Minutes"
    },
    "cookieExpireMinutesPlaceholder": {
        "message": "0 means it expires immediately after closing the browser"
    },
    "syncTimeInterval": {
        "message": "Sync Interval · Minutes"
    },
    "syncTimeIntervalPlaceholder": {
        "message": "At least 10 minutes"
    },
    "syncDomains": {
        "message": "Sync Domains"
    },
    "domainFilterPlaceholder": {
        "message": "Filter domains"
    },
    "columnSync": {
        "message": "Sync"
    },
    "columnKeepAlive": {
        "message": "Alive"
    },
    "selectAll": {
        "message": "Select All"
    },
    "clearAll": {
        "message": "Clear"
    },
    "noCookiesFound": {
        "message": "No cookie domains found"
    },
    "keepAliveHint": {
        "message": "Keep Alive: visits the domain in the background once per hour to keep the session logged in"
    },
    "keepLiveStop": {
        "message": "Pause Sync and Keep Alive"
    },
    "syncManual": {
        "message": "Manual Sync"
    },
    "save": {
        "message": "Save"
    },
    "copySuccess": {
        "message": "Copied to clipboard"
    },
    "copyFailed": {
        "message": "Copy failed, please copy manually"
    }
}
```

- [ ] **Step 2: Replace `ext/public/_locales/zh_CN/messages.json`**

Replace the entire file with:
```json
{
    "appTitle": {
        "message": "CookieCloud"
    },
    "appDesc": {
        "message": "CookieCloud是一款向自架服务器同步浏览器Cookie的工具。",
        "description": "采用端对端加密，保证您的Cookie安全。"
    },
    "test": {
        "message": "测试"
    },
    "fullMessagePlease": {
        "message": "请填写完整的信息"
    },
    "actionNotAllowedInPause": {
        "message": "暂停状态下无法进行此操作"
    },
    "success": {
        "message": "成功"
    },
    "failedCheckInfo": {
        "message": "失败，请检查填写的信息是否正确"
    },
    "saveSucess": {
        "message": "保存成功"
    },
    "workingMode": {
        "message": "工作模式"
    },
    "upToServer": {
        "message": "上传到服务器"
    },
    "overwriteToBrowser": {
        "message": "覆盖到浏览器"
    },
    "pauseSync": {
        "message": "暂停同步"
    },
    "overwriteModeDesp": {
        "message": "覆盖模式主要用于云端和只读用的浏览器，Cookie和Local Storage覆盖可能导致当前浏览器的登录和修改操作失效；另外部分网站不允许同一个cookie在多个浏览器同时登录，可能导致其他浏览器上账号退出。"
    },
    "uuid": {
        "message": "用户KEY · UUID"
    },
    "reGenerate": {
        "message": "重新生成"
    },
    "syncPassword": {
        "message": "端对端加密密码"
    },
    "syncPasswordPlaceholder": {
        "message": "丢失后数据失效，请妥善保管"
    },
    "generate": {
        "message": "自动生成"
    },
    "cookieExpireMinutes": {
        "message": "Cookie过期时间·分钟"
    },
    "cookieExpireMinutesPlaceholder": {
        "message": "0为关闭浏览器后立刻过期"
    },
    "syncTimeInterval": {
        "message": "同步时间间隔·分钟"
    },
    "syncTimeIntervalPlaceholder": {
        "message": "最少10分钟"
    },
    "syncDomains": {
        "message": "同步域名"
    },
    "domainFilterPlaceholder": {
        "message": "过滤域名"
    },
    "columnSync": {
        "message": "同步"
    },
    "columnKeepAlive": {
        "message": "保活"
    },
    "selectAll": {
        "message": "全选"
    },
    "clearAll": {
        "message": "清空"
    },
    "noCookiesFound": {
        "message": "未找到Cookie域名"
    },
    "keepAliveHint": {
        "message": "保活：每小时后台访问一次该域名以保持登录"
    },
    "keepLiveStop": {
        "message": "暂停同步和保活"
    },
    "syncManual": {
        "message": "手动同步"
    },
    "save": {
        "message": "保存"
    },
    "copySuccess": {
        "message": "已复制到剪贴板"
    },
    "copyFailed": {
        "message": "复制失败，请手动复制"
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add ext/public/_locales/en/messages.json ext/public/_locales/zh_CN/messages.json
git commit -m "feat(ext): update locale messages for the new popup

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Full build + manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Run unit tests + typecheck + build**

Run: `cd ext && pnpm test && pnpm compile && pnpm build:chrome`
Expected: tests PASS, no type errors, build writes `ext/dist/`.

- [ ] **Step 2: Load the unpacked extension and smoke test**

Load `ext/dist/chrome-mv3` (the `outDir: 'dist'` build output) as an unpacked extension in Chrome, then verify:
1. Popup opens; with mode = "Upload to Server", the domain list shows the browser's current cookie domains grouped by registrable domain, all unchecked.
2. The filter box narrows the list; "Select All" / "Clear" toggle the sync column for the visible rows.
3. Check sync for one domain, set UUID + password, Save, then click Manual Sync → only that domain's cookies upload (verify against the server's stored blob or by decrypting).
4. On a second browser/profile in "Overwrite to Browser" mode with the same UUID + password, Manual Sync sets the cookies, and a selected domain's localStorage round-trips after visiting the page.
5. Check keep-alive for a domain; confirm (via the service-worker console) that `keep live https://<domain>/` fires on the next hour boundary.
6. There is no server-address field, no algorithm selector, no request-header field, no with-storage toggle, and no blacklist field.

- [ ] **Step 3: Final confirmation**

No commit needed (verification task). If any check fails, fix in the relevant task's file and re-run Step 1.

---

## Notes / known trade-offs

- **No config migration:** upgraded users start with an empty selection and re-pick domains (intentional; the selection model changed).
- **Broad localStorage capture:** the content script stores every visited page's localStorage locally under `LS-<host>`; only `selected_domains` are uploaded. This keeps a selected domain's storage available without a re-visit. It never leaves the device unless selected.
- **Legacy decryption retained:** `cookie_decrypt` still supports the `legacy` algorithm so older blobs decrypt; all new uploads use `aes-128-cbc-fixed`.
