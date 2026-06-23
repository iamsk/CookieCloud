import CryptoJS from 'crypto-js';
import { gzip } from 'pako';
import { registrable_domain } from './domain';

const ENDPOINT = 'https://cookie.readtheone.com';
const CRYPTO_TYPE = 'aes-128-cbc-fixed';

interface CookieData {
  [domain: string]: any[];
}

interface LocalStorageData {
  [key: string]: any;
}

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

function is_firefox(): boolean {
  return navigator.userAgent.toLowerCase().indexOf('firefox') > -1;
}


export async function browser_set(key: string, value: any): Promise<void> {
  return await browser.storage.local.set({ [key]: value });
}

export async function browser_get(key: string): Promise<any> {
  const result = await browser.storage.local.get(key);
  if (result[key] === undefined) return null;
  else return result[key];
}

export async function browser_remove(key: string): Promise<void> {
  return await browser.storage.local.remove(key);
}

export async function storage_set(key: string, value: any): Promise<boolean> {
  try {
    await browser.storage.local.set({ [key]: value });
    return true;
  } catch (error) {
    return false;
  }
}

export async function storage_get(key: string): Promise<any> {
  try {
    const result = await browser.storage.local.get([key]);
    return result[key] === undefined ? null : result[key];
  } catch (error) {
    return null;
  }
}

export async function storage_remove(key: string): Promise<any> {
  try {
    await browser.storage.local.remove([key]);
    return true;
  } catch (error) {
    return false;
  }
}

export async function browser_load_all(prefix: string | null = null): Promise<any> {
  const result = await browser.storage.local.get(null);
  let ret = result;
  // Only return properties with keys starting with prefix
  if (prefix) {
    ret = {};
    for (let key in result) {
      if (key.startsWith(prefix)) {
        // remove prefix from key
        ret[key.substring(prefix.length)] = JSON.parse(result[key] as string) ?? result[key];
      }
    }
  }
  return ret;
}

export async function load_all(prefix: string | null = null): Promise<any> {
  try {
    const result = await browser.storage.local.get(null);
    let ret = result;
    // Only return properties with keys starting with prefix
    if (prefix) {
      ret = {};
      for (let key in result) {
        if (key.startsWith(prefix)) {
           // remove prefix from key
           const value = result[key];
           ret[key.substring(prefix.length)] = typeof value === 'string' ? (JSON.parse(value) ?? value) : value;
         }
      }
    }
    return ret;
  } catch (error) {
    return {};
  }
}

export async function load_data(key: string): Promise<any> {
  const data = browser?.storage ? await browser_get(key) : window.localStorage.getItem(key);
  // console.log("load",key,data);
  try {
    return JSON.parse(data as string);
  } catch (error) {
    return data || [];
  }
}

export async function remove_data(key: string): Promise<any> {
  const ret = browser?.storage ? await browser_remove(key) : window.localStorage.removeItem(key);
  return ret;
}

export async function save_data(key: string, data: any): Promise<any> {
  // chrome.storage.local.set({key:JSON.stringify(data)});
  const ret = browser?.storage ? await browser_set(key, JSON.stringify(data)) : window.localStorage.setItem(key, JSON.stringify(data));
  return ret;
}

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

function cookie_decrypt(uuid: string, encrypted: string, password: string, crypto_type: string = 'legacy'): any {
  const hash = CryptoJS.MD5(uuid + '-' + password).toString();
  const the_key = hash.substring(0, 16);
  
  if (crypto_type === 'aes-128-cbc-fixed') {
    // 新的标准 AES-128-CBC 算法，使用固定 IV
    const fixedIv = CryptoJS.enc.Hex.parse('00000000000000000000000000000000'); // 16字节的0
    const options = {
      iv: fixedIv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7
    };
    // 直接解密原始加密数据
    const decrypted = CryptoJS.AES.decrypt(encrypted, CryptoJS.enc.Utf8.parse(the_key), options).toString(CryptoJS.enc.Utf8);
    const parsed = JSON.parse(decrypted);
    return parsed;
  } else {
    // 原有的 legacy 算法
    const decrypted = CryptoJS.AES.decrypt(encrypted, the_key).toString(CryptoJS.enc.Utf8);
    const parsed = JSON.parse(decrypted);
    return parsed;
  }
}

function cookie_encrypt(uuid: string, data: string, password: string, crypto_type: string = 'legacy'): string {
  const hash = CryptoJS.MD5(uuid + '-' + password).toString();
  const the_key = hash.substring(0, 16);
  
  if (crypto_type === 'aes-128-cbc-fixed') {
    // 新的标准 AES-128-CBC 算法，使用固定 IV
    const fixedIv = CryptoJS.enc.Hex.parse('00000000000000000000000000000000'); // 16字节的0
    const options = {
      iv: fixedIv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7
    };
    // 使用原始加密数据，不包含 CryptoJS 格式包装
    const encrypted = CryptoJS.AES.encrypt(data, CryptoJS.enc.Utf8.parse(the_key), options);
    return encrypted.ciphertext.toString(CryptoJS.enc.Base64);
  } else {
    // 原有的 legacy 算法
    const encrypted = CryptoJS.AES.encrypt(data, the_key).toString();
    return encrypted;
  }
}

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

function buildUrl(secure: boolean, domain: string, path: string): string {
  if (domain.startsWith('.')) {
    domain = domain.substr(1);
  }
  return `http${secure ? 's' : ''}://${domain}${path}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function showBadge(text: string, color: string = "red", delay: number = 5000): void {
  (browser.action ?? browser.browserAction).setBadgeText({ text: text });
  (browser.action ?? browser.browserAction).setBadgeBackgroundColor({ color: color });
    setTimeout(() => {
      (browser.action ?? browser.browserAction).setBadgeText({ text: '' });
    }, delay);
}