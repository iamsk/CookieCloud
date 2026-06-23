import { upload_cookie, download_cookie, load_data, save_data, sleep } from '../utils/functions';
import browser from 'webextension-polyfill';

export default defineBackground(() => {
  console.log('CookieCloud Background Script Started', { id: browser.runtime.id });

  browser.runtime.onInstalled.addListener(function (details) {
    if (details.reason == "install") {
      browser.alarms.create('bg_1_minute', {
        when: Date.now(),
        periodInMinutes: 1
      });
    }
    else if (details.reason == "update") {
      browser.alarms.create('bg_1_minute', {
        when: Date.now(),
        periodInMinutes: 1
      });
    }
  });

  browser.alarms.onAlarm.addListener(async a => {
    if (a.name == 'bg_1_minute') {
      // console.log( 'bg_1_minute' );
      const config = await load_data("COOKIE_SYNC_SETTING");
      if (config) {
        if (config.type && config.type == 'pause') {
          console.log("Pause mode, no sync");
          return true;
        }

        // Get current minute count
        const now = new Date();
        const minute = now.getMinutes();
        const hour = now.getHours();
        const day = now.getDate();
        const minute_count = (day * 24 + hour) * 60 + minute;

        if (config.uuid) {
          // If current minute count is divisible by interval, execute sync
          if (parseInt(config.interval) < 1 || minute_count % config.interval == 0) {
            // Start sync
            console.log(`Execute sync ${minute_count} ${config.interval}`);
            if (config.type && config.type == 'down') {
              // Download cookies from server and write to local
              const result = await download_cookie(config);
              if (result && result['action'] == 'done') 
                console.log("Download success");
              else
                console.log(result);
            } else {
              const result = await upload_cookie(config);
              if (result && result['action'] == 'done') 
                console.log("Upload success");
              else
                console.log(result);
            }
          } else {
            // console.log(`Not sync time yet ${minute_count} ${config.interval}`);
          }
        }

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
      }
    }
  });
});
