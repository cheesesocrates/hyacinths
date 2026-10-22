import { PROVIDERS, usableProviders } from './providers.js';

// The player's own API keys ("bring your own key"). They live only in this
// browser's localStorage and are sent nowhere but the provider they belong
// to (see ai/terrain.js) — the site itself ships with no key at all.
//
// Shape: { provider, keys: { [providerId]: key }, models: { [providerId]:
// model }, customUrl } — one key and model per provider, so switching
// providers never loses the others.
const STORAGE_KEY = 'hyacinths.keys';
const IDS = PROVIDERS.map((p) => p.id);

export function emptySettings() {
  return { provider: IDS[0], keys: {}, models: {}, customUrl: '' };
}

// Only known providers, trimmed non-empty strings and a valid selection —
// whatever is in storage (or typed into the panel) collapses to exactly the
// shape the rest of the app expects.
function normalize(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const perProvider = (obj) =>
    Object.fromEntries(
      IDS.map((id) => [id, typeof obj?.[id] === 'string' ? obj[id].trim() : '']).filter(([, v]) => v)
    );
  return {
    provider: IDS.includes(src.provider) ? src.provider : IDS[0],
    keys: perProvider(src.keys),
    models: perProvider(src.models),
    customUrl: typeof src.customUrl === 'string' ? src.customUrl.trim() : ''
  };
}

export function loadKeys() {
  try {
    return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'));
  } catch {
    // Storage blocked (private window, disabled site data) or corrupt JSON.
    return emptySettings();
  }
}

// Returns the normalized settings plus whether they actually persisted —
// when storage is unavailable they still work for this visit, just not the
// next.
export function saveKeys(settings) {
  const clean = normalize(settings);
  try {
    if (usableProviders(clean).length) localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
    else localStorage.removeItem(STORAGE_KEY);
    return { settings: clean, persisted: true };
  } catch {
    return { settings: clean, persisted: false };
  }
}

export function clearKeys() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored, or storage unavailable — either way nothing remains.
  }
  return emptySettings();
}
