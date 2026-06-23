import React, { useState, useEffect } from 'react';
import { load_data, save_data, derive_uuid } from '../../utils/functions';
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
    uuid: "",
    type: "up",
    expire_minutes: 60 * 24 * 365,
    selected_domains: [],
    keep_alive_domains: [],
  });
  const [allDomains, setAllDomains] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);

  // Load saved config; the uuid is always (re)derived from the password.
  useEffect(() => {
    (async () => {
      try {
        const saved = await load_data("COOKIE_SYNC_SETTING");
        if (saved) {
          const password = saved.password ?? "";
          setData(prev => ({
            ...prev,
            password,
            interval: Number(saved.interval ?? prev.interval),
            uuid: password ? derive_uuid(password) : (saved.uuid ?? prev.uuid),
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

  // Password is the only secret; the uuid is derived from it automatically.
  const setPassword = (password: string) => {
    setData(prev => ({ ...prev, password, uuid: derive_uuid(password) }));
  };

  const toggleInArray = (field: 'selected_domains' | 'keep_alive_domains', domain: string) => {
    setData(prev => {
      const set = new Set(prev[field]);
      if (set.has(domain)) set.delete(domain); else set.add(domain);
      return { ...prev, [field]: Array.from(set) };
    });
  };

  // Always include domains the user has already selected, even if the browser
  // has no current cookies for them, so they can still be seen and unchecked.
  const knownDomains = Array.from(
    new Set([...allDomains, ...data.selected_domains, ...data.keep_alive_domains])
  ).sort();
  const visibleDomains = knownDomains.filter(d => {
    if (!d.includes(filter.trim())) return false;
    if (showSelectedOnly && !data.selected_domains.includes(d)) return false;
    return true;
  });

  const setSyncForVisible = (checked: boolean) => {
    setData(prev => {
      const set = new Set(prev.selected_domains);
      visibleDomains.forEach(d => { if (checked) set.add(d); else set.delete(d); });
      return { ...prev, selected_domains: Array.from(set) };
    });
  };

  const test = async (action: string = msg('test', '测试')) => {
    if (!data.password) {
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
    if (!data.password) {
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

  const passwordGen = () => setPassword(String(short_uid.generate()));
  const onCopySuccess = (label: string) => alert(`${label} ${msg('copySuccess', '已复制到剪贴板')}`);

  const modes: [string, string][] = [
    ['up', msg('upToServer', '上传到服务器')],
    ['down', msg('overwriteToBrowser', '覆盖到浏览器')],
    ['pause', msg('pauseSync', '暂停同步')],
  ];

  return (
    <div className="w-96 overflow-x-hidden bg-white rounded-lg shadow-lg flex flex-col h-[600px] relative">
      <div className="flex-1 overflow-y-auto p-5 pb-20">
        <div className="space-y-4">
          {/* Mode — 3-state segmented control on the first row */}
          <div className="flex rounded-lg bg-gray-100 p-1">
            {modes.map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => handleInputChange('type', val)}
                className={`flex-1 text-xs leading-tight py-2 px-1 rounded-md transition ${data.type === val ? 'bg-white shadow text-gray-800 font-medium' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {data.type === 'down' && (
            <div className="bg-red-600 text-white p-3 rounded">{msg('overwriteModeDesp', '覆盖模式主要用于云端和只读用的浏览器，Cookie和Local Storage覆盖可能导致当前浏览器的登录和修改操作失效；另外部分网站不允许同一个cookie在多个浏览器同时登录，可能导致其他浏览器上账号退出。')}</div>
          )}

          {data.type !== 'pause' && (
            <>
              {/* Password — the only secret; uuid is derived from it */}
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">{msg('syncPassword', '端对端加密密码')}</label>
                <div className="flex">
                  <div className="relative flex-1">
                    <input type="password" className="form-input pl-10 pr-3" placeholder={msg('syncPasswordPlaceholder', '丢失后数据失效，请妥善保管')} value={data.password}
                      onChange={(e) => setPassword(e.target.value)} />
                    <CopyToClipboard text={data.password} onCopy={() => onCopySuccess('Password')}>
                      <button className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600" title="复制密码"><CopyIcon /></button>
                    </CopyToClipboard>
                  </div>
                  <button className="ml-2 px-3 py-2 bg-gray-500 text-white rounded hover:bg-gray-600" onClick={passwordGen}>{msg('generate', '生成')}</button>
                </div>
              </div>

              {/* UUID — derived from the password, read-only, copyable */}
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">{msg('uuid', 'UUID')}</label>
                <div className="relative">
                  <input type="text" readOnly className="form-input pl-10 pr-3 bg-gray-50 text-gray-600 cursor-default" value={data.uuid} />
                  <CopyToClipboard text={data.uuid} onCopy={() => onCopySuccess('UUID')}>
                    <button className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600" title="复制 UUID"><CopyIcon /></button>
                  </CopyToClipboard>
                </div>
              </div>

              {/* Domain list (upload mode only) */}
              {data.type === 'up' && (
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-2">{msg('syncDomains', '同步域名')}</label>
                  <input type="text" className="form-input mb-2" placeholder={msg('domainFilterPlaceholder', '过滤域名')} value={filter}
                    onChange={(e) => setFilter(e.target.value)} />
                  <label className="flex items-center text-xs text-gray-500 mb-2 cursor-pointer">
                    <input type="checkbox" className="mr-1" checked={showSelectedOnly}
                      onChange={(e) => setShowSelectedOnly(e.target.checked)} />
                    {msg('showSelectedOnly', '仅显示已同步')}
                  </label>
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
