// Nutzer-Einstellungen mit localStorage-Persistenz

const DEFAULTS = {
  lang: 'de',           // 'de' | 'en'
  lineMode: 'route',    // 'route' | 'straight' | 'none'
  profile: 'car',       // 'car' | 'bike' | 'foot'
  imgQuality: 'medium', // 'small' | 'medium' | 'large' | 'original'
  sidebar: '',          // '' = automatisch (Desktop offen, mobil zu), 'open' | 'closed'
  webdavUrl: '',        // WebDAV-Ordner-URL (z. B. Nextcloud)
  webdavUser: '',
  webdavPass: ''        // Hinweis: liegt im localStorage — App-Passwort verwenden
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
