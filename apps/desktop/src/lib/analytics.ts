import type { Dict, Mixpanel } from 'mixpanel-browser';
import { version } from '../../package.json';

const TOKEN = '7c4ccab05daa88f3048b7b6d6997e03c'; // Mixpanel 公开采集标识
const KEY = 'tibi.analytics.v1';
const QUEUE_SCHEMA = 'tibi.analytics.queue_schema';
const SDK_NAME = 'tibi_usage';
const SCHEMA_VERSION = 2;
const BACKGROUND_INTERVAL = 30 * 60 * 1000;
export const USAGE_ANALYTICS_CHANGE = 'tibi-analytics-change';
export const TRAY_LOOKUP_USED = 'tray_lookup_used';

const events = [
  'app_opened', 'import_succeeded', 'reader_opened', 'word_lookup_used',
  'review_answered', 'review_completed', 'podcast_played',
] as const;
const lookupSurfaces = ['reader', 'dictionary', 'tray'] as const;
type UsageEvent = typeof events[number];
type LookupSurface = typeof lookupSurfaces[number];
type UsageArgs = [Exclude<UsageEvent, 'word_lookup_used'>] | ['word_lookup_used', LookupSurface];
const allowedProperties = new Set([
  'token', 'distinct_id', '$device_id', '$insert_id', 'time', 'mp_lib', '$lib_version',
  'product', 'site', 'platform', 'environment', 'locale', 'app_version', 'schema_version',
  'lookup_surface', '$mp_raw_user_agent',
]);

let loader: Promise<typeof import('mixpanel-browser/src/loaders/loader-module-core.js')> | undefined;
let sdk: Mixpanel | undefined;
let optedIn = false;
let consentRevision = 0;
let started = false;
let opened = false;
let backgroundSince: number | undefined;

function platform() {
  if (!('__TAURI_INTERNALS__' in window)) return 'web';
  return '__TIBI_LOCAL_CORE__' in window ? 'mobile' : 'desktop';
}

function environment() {
  if (typeof window === 'undefined') return;
  const { hostname, protocol, search } = window.location;
  if (import.meta.env.PROD && (platform() !== 'web' || (hostname === 'app.tibi.ferecord.com' && protocol === 'https:'))) {
    return 'production';
  }
  if (import.meta.env.DEV && ['localhost', '127.0.0.1', '[::1]'].includes(hostname) &&
      new URLSearchParams(search).get('analytics-test') === '1') {
    return 'development';
  }
}

export function usageAnalyticsBlockReason() {
  if (!environment()) return 'environment';
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  const dnt: unknown[] = [nav.doNotTrack, nav.msDoNotTrack, (window as Window & { doNotTrack?: string }).doNotTrack];
  if (nav.globalPrivacyControl || dnt.some(value => value === true || value === 1 || value === '1' || value === 'yes')) return 'privacy';
}

export function analyticsEnabled() {
  try { return localStorage.getItem(KEY) === 'allow' && !usageAnalyticsBlockReason(); }
  catch { return false; }
}

function removeQueues() {
  for (const suffix of ['ev', 'pp', 'gr']) localStorage.removeItem(`__mpq_${TOKEN}_${suffix}`);
}

function safeProperties(properties: Dict) {
  return Object.fromEntries(Object.entries(properties).filter(([key]) => allowedProperties.has(key)));
}

function initSdk(mixpanel: Pick<Mixpanel, 'init'>) {
  // SDK 恢复旧队列时可跳过发送钩子。先丢弃未经过入队白名单的记录。
  if (localStorage.getItem(QUEUE_SCHEMA) !== String(SCHEMA_VERSION)) {
    removeQueues();
    localStorage.setItem(QUEUE_SCHEMA, String(SCHEMA_VERSION));
  }
  const marketing = { track_marketing: false };
  return mixpanel.init(TOKEN, {
    api_host: 'https://api-js.mixpanel.com',
    persistence: 'localStorage',
    persistence_name: SDK_NAME,
    consent_mode: 'require_consent',
    opt_out_tracking_cookie_prefix: '__tibi_usage_consent_',
    autocapture: false,
    track_pageview: false,
    record_sessions_percent: 0,
    flags: false,
    remote_settings_mode: 'disabled',
    ...marketing,
    stop_utm_persistence: true,
    save_referrer: false,
    skip_first_touch_marketing: true,
    ip: false,
    hooks: {
      on_track: (event, properties) => [event, safeProperties(properties)],
      before_send_events: data => analyticsEnabled() && events.includes(data.event as UsageEvent) ? data : null,
    },
  }, SDK_NAME);
}

export function trackUsage(...[event, surface]: UsageArgs) {
  if (!analyticsEnabled() || !events.includes(event)) return false;
  if (event === 'word_lookup_used' && !lookupSurfaces.includes(surface)) return false;

  const revision = consentRevision;
  const properties = {
    product: 'tibi', site: 'app', platform: platform(), environment: environment(),
    locale: document.documentElement.lang === 'en' ? 'en' : 'zh-CN',
    app_version: version, schema_version: SCHEMA_VERSION, time: Date.now() / 1000,
    $mp_raw_user_agent: 'Tibi', // Mixpanel 用这个值生成事件属性，否则会读请求的 User-Agent。
    ...(event === 'word_lookup_used' ? { lookup_surface: surface } : {}),
  };
  loader ??= import('mixpanel-browser/src/loaders/loader-module-core.js').catch(error => {
    loader = undefined;
    throw error;
  });
  void loader.then(({ default: mixpanel }) => {
    if (revision !== consentRevision || !analyticsEnabled()) return;
    const instance = sdk ??= initSdk(mixpanel);
    if (!optedIn) {
      instance.opt_in_tracking({ track: () => undefined });
      optedIn = true;
    }
    instance.track(event, properties);
  }).catch(() => undefined);
  return true;
}

function recordBackground() {
  backgroundSince ??= Date.now();
}

function recordForeground() {
  if (document.visibilityState === 'hidden') { recordBackground(); return; }
  if (backgroundSince !== undefined && Date.now() - backgroundSince >= BACKGROUND_INTERVAL) opened = false;
  backgroundSince = undefined;
  if (!opened) opened = trackUsage('app_opened');
}

export function startUsageAnalytics() {
  if (started || !environment()) return;
  started = true;
  document.addEventListener('visibilitychange', recordForeground);
  window.addEventListener('storage', event => {
    if (event.key === KEY || event.key === null) syncUsageAnalytics();
  });
  if (platform() === 'desktop') {
    window.addEventListener('blur', recordBackground);
    window.addEventListener('focus', recordForeground);
    void import('@tauri-apps/api/event')
      .then(({ listen }) => listen(TRAY_LOOKUP_USED, () => trackUsage('word_lookup_used', 'tray'), { target: 'main' }))
      .catch(() => undefined);
  }
  syncUsageAnalytics();
}

export function setUsageAnalytics(value: boolean) {
  if (value && usageAnalyticsBlockReason()) return false;
  try { localStorage.setItem(KEY, value ? 'allow' : 'deny'); } catch { return false; }
  syncUsageAnalytics();
  return true;
}

function syncUsageAnalytics() {
  if (analyticsEnabled()) recordForeground();
  else {
    opened = false;
    consentRevision++;
    if (sdk && optedIn) {
      optedIn = false;
      try {
        sdk.opt_out_tracking({ delete_user: false });
        sdk.reset();
      } catch { /* 继续清理本机存储。 */ }
    }
    try {
      removeQueues();
      localStorage.removeItem(`mp_${SDK_NAME}`);
      sessionStorage.removeItem(`mp_tab_id_${SDK_NAME}_${TOKEN}`);
      sessionStorage.removeItem(`mp_gen_new_tab_id_${SDK_NAME}_${TOKEN}`);
    } catch { /* 存储不可用时不会发送统计。 */ }
  }
  window.dispatchEvent(new Event(USAGE_ANALYTICS_CHANGE));
}
