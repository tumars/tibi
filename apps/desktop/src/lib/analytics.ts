import mixpanel from 'mixpanel-browser/src/loaders/loader-module-core.js';
import type { Mixpanel } from 'mixpanel-browser';
import { version } from '../../package.json';

const TOKEN = '7c4ccab05daa88f3048b7b6d6997e03c'; // 公开采集标识，无读取权限。
const KEY = 'tibi.analytics.v1';
const events = new Set(['app_opened', 'import_succeeded', 'word_lookup_used', 'review_answered']);
const allowed = new Set(['token', 'distinct_id', '$device_id', '$insert_id', 'time', 'mp_lib', '$lib_version', 'product', 'site', 'platform', 'environment', 'locale', 'app_version', 'schema_version']);
let sdk: Mixpanel | undefined;
let opened = false;

export function analyticsEnabled() {
  try { return localStorage.getItem(KEY) === 'allow' && navigator.doNotTrack !== '1' && !(navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl; } catch { return false; }
}

export function trackUsage(event: 'app_opened' | 'import_succeeded' | 'word_lookup_used' | 'review_answered') {
  const native = '__TAURI_INTERNALS__' in window;
  const production = import.meta.env.PROD && (native || location.hostname === 'app.tibi.ferecord.com');
  if (!analyticsEnabled() || (!production && new URLSearchParams(location.search).get('analytics-test') !== '1')) return;
  try {
    if (!sdk) sdk = mixpanel.init(TOKEN, {
      api_host: 'https://api-js.mixpanel.com', persistence: 'localStorage', persistence_name: 'tibi_usage',
      autocapture: false, track_pageview: false, record_sessions_percent: 0,
      ...{ track_marketing: false, stop_utm_persistence: true, save_referrer: false, skip_first_touch_marketing: true }, ip: false, opt_out_tracking_by_default: true, opt_out_tracking_cookie_prefix: '__tibi_usage_consent_',
      hooks: { before_send_events: data => !analyticsEnabled() || !events.has(data.event) ? null : { ...data, properties: Object.fromEntries(Object.entries(data.properties).filter(([key]) => allowed.has(key))) } },
    }, 'tibi_usage');
    sdk.opt_in_tracking({ track: () => {} });
    sdk.track(event, { product: 'tibi', site: 'app', platform: native ? ('__TIBI_LOCAL_CORE__' in window ? 'mobile' : 'desktop') : 'web', environment: production ? 'production' : 'development', locale: document.documentElement.lang || navigator.language, app_version: version, schema_version: 1 });
  } catch { /* 统计失败不影响阅读与复习。 */ }
}

export function startUsageAnalytics() {
  if (opened || !analyticsEnabled()) return;
  opened = true;
  trackUsage('app_opened');
}

export function setUsageAnalytics(value: boolean) {
  try { localStorage.setItem(KEY, value ? 'allow' : 'deny'); } catch { return false; }
  syncUsageAnalytics();
  dispatchEvent(new Event('tibi-analytics-change'));
  return true;
}

function syncUsageAnalytics() {
  if (analyticsEnabled()) startUsageAnalytics();
  else {
    opened = false;
    if (sdk) { sdk.reset(); sdk.opt_out_tracking({ delete_user: false }); }
  }
}
if (typeof window !== 'undefined') window.addEventListener('storage', e => { if (e.key === KEY || e.key === null) { syncUsageAnalytics(); dispatchEvent(new Event('tibi-analytics-change')); } });
