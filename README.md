# Repetito

Ein lokal arbeitendes Übungs- und Wiederholungswerkzeug für Obsidian Desktop und iPad.

## Funktionen in Version 0.1.0

- Verschachtelte Ordner und Übungen
- Mehrere Aufgaben-PDFs und Lösungs-PDFs je Übung
- PDFs aus dem Vault zuordnen oder in `Repetito/PDFs` importieren
- Lösungsteil zunächst ausgeblendet
- Repetitions-Timer mit Pause, Fortsetzen, Abschluss und Abbruch
- Bewertung nach Schwierigkeit und Selbstständigkeit
- Tagesziel und Fortschrittsanzeige
- Lernstandsbalken und Filter nach Schwierigkeit, Selbstständigkeit und Favoriten
- Geordnete Repetitionsrunde mit Ordnerwahl und Fortsetzen nach Obsidian-Neustart
- Notizen und Verlauf mit korrigierbaren oder löschbaren Einträgen
- Bestätigungsdialoge beim Löschen; PDF-Originale bleiben erhalten

## Test installation with BRAT

Repetito is not in the Obsidian Community Plugins directory yet. Once this source is in a public GitHub repository and a matching release has been created, you can install it on iPad or desktop with BRAT:

1. In Obsidian, open **Settings → Community plugins → Browse**, search for **BRAT**, install it, and enable it.
2. Open the command palette and run **BRAT: Add a beta plugin for testing**.
3. Enter the GitHub repository address for Repetito and choose the latest release.
4. Enable Repetito under **Settings → Community plugins** if it is not enabled automatically.

BRAT downloads the release assets `main.js`, `manifest.json`, and `styles.css`. The release tag and `manifest.json` version must match.

## Installation (Desktop, manual)

1. Obsidian schliessen.
2. Den Plugin-Ordner `repetito-plugin` nach `<Vault>/.obsidian/plugins/repetito/` kopieren.
3. Die drei Plugin-Dateien müssen dort direkt liegen: `manifest.json`, `main.js` und `styles.css`.
4. Obsidian öffnen, dann **Einstellungen → Community-Plugins** öffnen und Repetito aktivieren. Falls es nicht erscheint, **Community-Plugins neu laden** oder Obsidian neu starten.
5. Über das Abschluss-Hut-Symbol oder den Befehl **Repetito öffnen** starten.

## Speicher

Repetito legt `Repetito/repetito-data.json` und importierte PDFs unter `Repetito/PDFs/` im Vault ab. Dateien, die bereits anderswo im Vault liegen, werden beim Zuordnen nicht verschoben oder gelöscht. Die Synchronisation zwischen Geräten wird durch Obsidian beziehungsweise einen separat eingerichteten Dienst übernommen.

## iPad, manual

Das Plugin verwendet keine Node- oder Electron-APIs und ist für Obsidian Mobile vorgesehen. Zum Aktivieren auf dem iPad muss der Plugin-Ordner in den Vault unter `.obsidian/plugins/repetito/` gelangen. Das klappt beispielsweise über iCloud Drive, Obsidian Sync (Plugin-Konfiguration und Vault-Dateien synchronisieren) oder eine manuelle Dateiübertragung. PDFs und Übungen bleiben im Vault.

## Hinweise

- Pro Vault wird eine laufende Repetitionsrunde gespeichert.
- Beim Schliessen von Obsidian wird die Timerzeit festgehalten und der Timer pausiert.
- Eine Runde muss pro Aufgabe gestartet und nach Abschluss bewertet werden.
- Die erste Version zeigt die Gesamtverteilung der Übungen; einzelne Ordner lassen sich separat filtern.
