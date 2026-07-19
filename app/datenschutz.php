<?php // Datenschutzerklärung — PLATZHALTER: eigene Angaben eintragen (siehe TODO). ?>
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Datenschutz — Tourlocate</title>
<link rel="icon" type="image/png" href="../img/logo.png">
<style>
  body{margin:0;font-family:system-ui,sans-serif;background:#f4f6f8;color:#1a1a1a}
  .wrap{max-width:720px;margin:32px auto;padding:0 16px 40px}
  .card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:24px 26px}
  h1{font-size:20px;margin:0 0 16px}
  h2{font-size:15px;margin:20px 0 6px}
  p,li{font-size:14px;line-height:1.55;margin:6px 0}
  .todo{background:#fff7e6;border:1px solid #f0d9a8;border-radius:8px;padding:10px 12px;
        font-size:13px;color:#8a5a00;margin:0 0 18px}
  a{color:#2b6cb0}
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <h1>Datenschutzerklärung</h1>
    <p class="todo"><strong>TODO (Betreiber):</strong> Vorlage — Verantwortlichen eintragen,
    Angaben prüfen/ergänzen (ggf. rechtlich beraten lassen) und diesen Kasten entfernen.</p>

    <h2>Verantwortlicher</h2>
    <p>[Vorname Nachname, Anschrift, E-Mail — wie im <a href="impressum.php">Impressum</a>]</p>

    <h2>Welche Daten verarbeitet werden</h2>
    <ul>
      <li><strong>Konto:</strong> E-Mail-Adresse und Passwort (nur als Hash gespeichert);
      optional ein 2FA-Geheimnis, falls Zwei-Faktor-Authentifizierung aktiviert wird.</li>
      <li><strong>Inhalte:</strong> hochgeladene Fotos (verkleinert; können GPS-Position und
      Aufnahmedatum enthalten), Stationsnamen, Links und Präsentationsdaten.</li>
      <li><strong>WebDAV-Verbindung (optional):</strong> Ordner-URL, Benutzername und ein
      App-Passwort. Das App-Passwort wird verschlüsselt gespeichert, muss aber für den
      automatischen Abruf durch den Server entschlüsselbar sein.</li>
      <li><strong>Technisch:</strong> Session-Cookie (nur für die Anmeldung, kein Tracking);
      IP-bezogene Zähler zum Schutz vor Missbrauch (Anmeldeversuche, Meldungen),
      die automatisch wieder gelöscht werden.</li>
    </ul>

    <h2>Öffentliche Teilen-Links</h2>
    <p>Präsentationen sind nur öffentlich einsehbar, wenn ihr Besitzer aktiv einen
    Teilen-Link erzeugt; optional zusätzlich passwortgeschützt. Der Besitzer kann den
    Link jederzeit deaktivieren.</p>

    <h2>Einsicht durch den Betreiber (Moderation)</h2>
    <p>Der Betreiber kann gespeicherte Inhalte einsehen, wenn dafür ein konkreter Anlass
    besteht — insbesondere bei einer Meldung über den Link „Inhalt melden" oder bei
    Hinweisen auf rechtswidrige Inhalte. Jeder dieser Zugriffe wird intern
    protokolliert (Audit-Log). Eine anlasslose Durchsicht privater Inhalte findet
    nicht statt.</p>

    <h2>Externe Dienste</h2>
    <ul>
      <li><strong>Kartenkacheln:</strong> beim Anzeigen der Karte ruft der Browser
      Kacheln von OpenStreetMap-Servern ab (dabei wird die IP-Adresse übertragen).</li>
      <li><strong>Bibliotheken:</strong> JavaScript-Bibliotheken werden über das CDN
      jsDelivr geladen.</li>
      <li><strong>Routing (optional):</strong> für die Routenberechnung werden
      Stations-Koordinaten an die FOSSGIS-OSRM-Instanz (routing.openstreetmap.de)
      übertragen.</li>
    </ul>

    <h2>Speicherdauer und Löschung</h2>
    <p>Inhalte bleiben gespeichert, bis der Nutzer sie selbst löscht oder das Konto
    entfernt wird. Mit dem Löschen einer Präsentation oder eines Kontos werden auch
    die zugehörigen Bilddateien vom Server entfernt.</p>

    <h2>Ihre Rechte</h2>
    <p>Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und
    Widerspruch nach Art. 15–21 DSGVO; Beschwerderecht bei einer
    Datenschutz-Aufsichtsbehörde. Kontakt: siehe oben.</p>

    <p style="margin-top:22px"><a href="impressum.php">Impressum</a> · <a href="index.php">Zur Anmeldung</a></p>
  </div>
</div>
</body>
</html>
