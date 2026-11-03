/**
 * The only service worker registration. Never in dev, preview, iframes or with ?sw=off (those also unregister it).
 * Updates are taken silently by the next load: the page is never reloaded while the user edits,
 * and the outbox lives in IndexedDB, which updates do not touch.
 */
const refused = () => {
  const h = location.hostname;
  return !import.meta.env.PROD
    || window.self !== window.top
    || h.startsWith('id-preview--') || h.startsWith('preview--')
    || h === 'lovableproject.com' || h.endsWith('.lovableproject.com')
    || h === 'lovableproject-dev.com' || h.endsWith('.lovableproject-dev.com')
    || h === 'beta.lovable.dev' || h.endsWith('.beta.lovable.dev')
    || new URLSearchParams(location.search).get('sw') === 'off';
};

export async function registerAppWorker(onOfflineReady?: () => void) {
  if (!('serviceWorker' in navigator)) return;
  if (refused()) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.filter(r => r.active?.scriptURL.endsWith('/sw.js') || r.installing?.scriptURL.endsWith('/sw.js')).map(r => r.unregister()));
    return;
  }
  const first = !navigator.serviceWorker.controller;
  const reg = await navigator.serviceWorker.register('/sw.js');
  if (first) {
    const w = reg.installing ?? reg.waiting;
    if (w) w.addEventListener('statechange', () => { if (w.state === 'activated') onOfflineReady?.(); });
  }
}
