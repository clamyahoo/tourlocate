// Nutzer-Einstellungen mit localStorage-Persistenz

const DEFAULTS = {
  lang: 'de',          // 'de' | 'en'
  lineMode: 'route',   // 'route' | 'straight' | 'none'
  profile: 'car',      // 'car' | 'bike' | 'foot'
  imgQuality: 'medium' // 'small' | 'medium' | 'large' | 'original'
};

export function getSetting(key) {
  try {
    return localStorage.getItem('tl-' + key) ?? DEFAULTS[key];
  } catch {
    return DEFAULTS[key]; // localStorage kann in Private-Modes fehlen
  }
}

export function setSetting(key, value) {
  try {
    localStorage.setItem('tl-' + key, value);
  } catch { /* best effort */ }
}
