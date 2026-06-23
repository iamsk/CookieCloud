import { load_data, save_data, remove_data } from '../utils/functions';

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    console.log('CookieCloud Content Script Loaded');
    
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
  },
});
