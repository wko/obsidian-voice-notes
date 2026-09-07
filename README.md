# Voice Append

Eigenständiges Obsidian-Plugin für diktierte Ergänzungen. Entwicklungsversion 0.3.0, mit Desktop-Unterstützung und iPhone als mobiler Zielplattform. OpenAI wird direkt angesprochen; kein Atlas-Server, kein Webhook und kein Git-Schreibzugriff sind erforderlich.

## Entwicklungsumgebung

Der benachbarte Ordner `../Voice Append Lab` ist der separate Entwicklungs-Vault. Er ist bereits in Obsidian registriert und enthält das aktivierte Plugin sowie Testnotizen. Der persönliche Vault wurde für die Entwicklung nicht verändert.

```sh
npm ci
npm run build
npm test
npm run dev
```

`build` prüft TypeScript, baut das Plugin und kopiert `main.js`, `manifest.json` und `styles.css` automatisch in den Test-Vault. `dev` beobachtet Quelldateien und baut nach Änderungen neu. Zum Laden neuer Builds das Plugin im Test-Vault aus- und einschalten oder nach dem Speichern der Testnotizen den Obsidian-Befehl „Reload app without saving“ ausführen. Es wird kein zusätzliches Hot-Reload-Plugin benötigt.

Der Lab-Build enthält zusätzlich **Lab: Preview progress (no API)** für eine kurze Vorschau aller drei Spinner-Phasen ohne Aufnahme, Netzwerk oder Änderung der Notiz.

Nur der Lab-Build enthält den Befehl **Voice Append: Lab: Test-Ergänzung ohne Mikrofon und API**. Er hängt vorbereiteten Beispieltext an die geöffnete Notiz an und prüft dabei denselben Speicher-, Queue- und Schreibpfad. Er benutzt weder Mikrofon noch Netzwerk. Jeder Aufruf ist eine neue Ergänzung.

`npm run release` baut ein Paket ohne Lab-Befehl und ohne Source Map nach `dist/`. Für eine manuelle Installation die drei Dateien aus `dist/` nach `.obsidian/plugins/voice-append/` im jeweiligen Vault kopieren und Community Plugins aktivieren. Mindestens Obsidian 1.11.4 ist für Secret Storage nötig.

## Benutzung

1. Einstellungen → Voice Append → OpenAI-Schlüssel: genau einen Schlüssel in das verdeckte Textfeld einfügen und „Save“/„Speichern“ wählen. Keine Schlüsselliste oder Verknüpfungsauswahl mehr. Intern wird der Wert in einem eigenen Obsidian-Secret-Storage-Eintrag gesichert. Ein zuvor verknüpfter Schlüssel bleibt bis zum Ersetzen nutzbar; andere gemeinsam verwendete Schlüssel werden nicht verändert.
2. Transkriptionsmodell, Bereinigungsmodell und Prompt auswählen. Defaults: `gpt-transcribe`, `gpt-5.6-luna` und eine behutsame Bereinigung wie in der bisherigen App. Modellverfügbarkeit hängt vom API-Konto ab.
3. In einer Markdown-Notiz am Ende auf **Gedanken ergänzen** tippen. Der Einstieg funktioniert in Live Preview, im Quellmodus und in der Leseansicht; alternativ über Befehlspalette oder Ribbon.
4. **Stoppen & anhängen** (englisch: **Stop & append**) sichert die Aufnahme lokal und startet bei Verbindung die Verarbeitung. Schließen während der Aufnahme stoppt und sichert ebenfalls. Sichtbarkeitsverlust versucht die Aufnahme zu stoppen; das ist keine Garantie gegen Betriebssystem-Abbruch.
5. Über **Aufnahmen und Status öffnen** lassen sich Ergebnisse prüfen, Audiodateien herunterladen, fehlgeschlagene Aufträge wiederholen, ein fehlendes Ziel neu zuordnen und Aufnahmen nach Rückfrage löschen.

## Architektur

`recorder.ts` → IndexedDB (`store.ts`) → fortsetzbare Verarbeitung (`core.ts`) → OpenAI (`provider.ts`) → Obsidian-Editor/Vault (`main.ts`).

- TypeScript ohne React. Ein optionaler, strikt auf macOS-Desktop begrenzter Electron-Aufruf fragt die Mikrofonfreigabe beim ersten Zugriff an, wie Obsidian selbst. Auf iPhone/Android wird dieser Pfad nicht geladen; Aufnahme und Verarbeitung verwenden dort ausschließlich Web-/Obsidian-APIs.
- CodeMirror-Widget am Dokumentende im Editor; separater, beim Rendern wiederhergestellter Footer in der Leseansicht. Der DOM-Selektor der Leseansicht ist eine Kompatibilitätsstelle, die bei Obsidian-Updates geprüft werden muss.
- Getrennte `Transcriber`- und `Cleaner`-Schnittstellen. Ein weiterer Provider kann diese implementieren, ohne Aufnahme oder Notizschreiber zu ändern. Eine Provider-Auswahloberfläche ist noch nicht implementiert.
- Direkte OpenAI-Requests über Obsidian `requestUrl`, einschließlich binärem Multipart-Upload auf mobilen Geräten; Responses API mit `store: false` und strukturiertem Ergebnis.
- Der Bereinigungs-Prompt wird pro Aufnahme eingefroren. Bereits erfolgreiche Transkription/Bereinigung wird beim Wiederholen nicht erneut ausgeführt.
- Es wird nur neue Sprache bearbeitet. Optional kann ein beim Aufnahmestart eingefrorener Ausschnitt der Zielnotiz als Referenz an OpenAI gehen (maximal 16.000 Zeichen, ohne Frontmatter und HTML-Kommentare). Bei längeren Notizen werden Anfang und Ende verwendet. Das ist standardmäßig aus. Kontext ist Referenzmaterial, kein Schreibauftrag: Das Modell soll ausschließlich die neue Ergänzung liefern.
- Ein optionales Feld für bekannte Namen/Konzepte (maximal 2.000 Zeichen) unterstützt sowohl die Transkription als auch die Bereinigung. Leeres Feld bedeutet keine zusätzlichen Hinweise.
- Das Originaltranskript bleibt für Wiederherstellung lokal gespeichert, wird aber standardmäßig nicht an die Notiz angehängt. Der Schalter „Include original transcript“/„Originaltranskript anhängen“ aktiviert den eingeklappten Abschnitt.
- Während der Verarbeitung erscheint direkt am Ende der Zielnotiz ein Spinner mit der aktuellen Phase: Transkription, Bereinigung oder Anhängen. Wartende Aufträge zeigen eine Uhr, Fehler einen statischen Hinweis mit Link zum Status. Erfolgreiche Aufträge verschwinden aus dieser Anzeige. Live Preview und Leseansicht verwenden denselben Status; bei reduzierten Animationen bleibt das Symbol statisch. Es wird kein Status-Markdown in die Notiz geschrieben.
- Oberfläche und Button folgen Obsidian: Deutsch und Englisch; andere Sprachen fallen auf Englisch zurück. Benutzerdefinierte Prompts werden nicht automatisch übersetzt.
- Der offene Editor wird am aktuellen Ende ergänzt; geschlossene Dateien werden mit `Vault.process()` aktualisiert. Der Editor-Schreibvorgang gilt erst nach Prüfung der gespeicherten Datei als erledigt.

## Zielnotiz ohne zusätzliche Notiz-ID

Keine neue Frontmatter-Eigenschaft und keine `voice_note_id`. Während der Sitzung hält das Plugin das Obsidian-`TFile` fest; für Neustarts speichert es den Pfad und den vorhandenen Dateierstellungszeitpunkt als Plausibilitätsprüfung. Datei- und Ordnerumbenennungen während der Sitzung werden verfolgt. Fehlt das Ziel oder scheint die Datei ersetzt worden zu sein, bleibt die Aufnahme zur manuellen Zuordnung erhalten. Änderungen des Erstellungszeitpunkts durch Sync können ebenfalls eine erneute Zuordnung erforderlich machen.

Die Notizen enthalten ausschließlich den gewünschten Text, keine technischen Kommentare oder IDs. Ein lokaler Schreibplan erkennt bereits angehängte Ergänzungen nach einer Unterbrechung. Ist die Zuordnung wegen nachträglicher Änderungen nicht eindeutig, stoppt der Wiederholungsversuch zur Prüfung. Alte Plugin-Kommentare werden einmalig entfernt. Keine Garantie für globale Konfliktfreiheit bei parallelen Änderungen durch mehrere Geräte oder externe Git-Prozesse.

## Speicherung und aktuelle Grenzen

- Vollständig gestoppte Aufnahme, Transkript und bereinigtes Ergebnis liegen in IndexedDB auf dem Aufnahmegerät. Diese Warteschlange wird nicht mit dem Vault synchronisiert.
- Erfolgreiche Audiodateien werden beim nächsten Plugin-Start nach sieben Tagen entfernt. Offene/fehlgeschlagene Aufnahmen bleiben bis zur Erledigung oder manuellen Löschung erhalten. Das fertige Markdown bleibt bestehen.
- IndexedDB ist App-Speicher, kein Backup: App-Daten löschen, Deinstallation oder Speicherbereinigung kann ihn entfernen. Wichtige offene Aufnahmen lassen sich exportieren.
- Erste Version: eine Aufnahme pro Ergänzung, maximal zehn Minuten und 24 MiB. „Weiter aufnehmen“ mit mehreren Segmenten folgt später.
- Während der laufenden Aufnahme liegen Chunks im Speicher; erst `stop` erzeugt die dauerhaft gespeicherte Datei. Bei abruptem Beenden kann der laufende Abschnitt verloren gehen. Hintergrundaufnahme wird nicht zugesagt.
- Offline-Aufträge starten beim Öffnen/Zurückkehren und bei wiederhergestellter Verbindung. Fehlgeschlagene Aufträge werden bewusst über „Erneut versuchen“ fortgesetzt.
- HTTP-Aufrufe haben ein 120-Sekunden-Wartebudget. Ein Timeout kann den externen Request nicht sicher abbrechen; ein Wiederholungsversuch kann erneut API-Kosten verursachen, aber nicht dieselbe Ergänzung doppelt schreiben.
- Desktop-Mikrofonaufnahme nach erteilter macOS-Berechtigung gestartet, gestoppt und lokal gespeichert. Der lokale Text-Append wurde mit vorbereiteten Daten geprüft. Der Nutzer hat inzwischen echte Diktate im Test-Vault angehängt. Hardwaretests auf dem iPhone stehen noch aus.

## Verifikation dieser Version

- TypeScript-Prüfung und Build erfolgreich.
- 33 automatisierte Tests (einschließlich Desktop-Berechtigungspfad, mobiler Isolation, Lokalisierung und optionalem Kontext): Textbewahrung, Idempotenz nach simuliertem Absturz, leere Sprache, Wiederaufnahme nach Fehlern, Prompt-Snapshot, persistente Audiodaten, Aufbewahrung, Vault-Isolation und OpenAI-Protokoll mit simuliertem Transport.
- In Obsidian 1.14.0 auf macOS geladen: Einstellungen, Endbutton in Live Preview und Leseansicht, leere Notiz, lokaler Beispiel-Append, Speicherung im Markdown und abgeschlossener Auftragsstatus nach Reload geprüft.

## Mikrofonfreigabe auf dem Desktop

Nach einer verweigerten Freigabe zeigt der Aufnahmedialog konkrete Schritte, einen Link zu den Mikrofoneinstellungen auf macOS/Windows und „Try again“/„Erneut versuchen“. Auf macOS unter Systemeinstellungen → Datenschutz & Sicherheit → Mikrofon Obsidian aktivieren. Ggf. Obsidian neu starten. Ein fehlendes oder belegtes Mikrofon wird separat erklärt. Die Freigabe kann das Plugin nicht erzwingen.

## Nächste Prüfungen auf dem iPhone

Mit einem Test-Vault und persönlichem API-Schlüssel: 30 Sekunden deutsches Diktat, Eigennamen, längere Aufnahme, Mikrofon verweigern/erlauben, offline stoppen und nach Rückkehr verarbeiten, Displaysperre, App-Wechsel, Neustart nach dem Stoppen, manuelle Änderungen während der Verarbeitung, Umbenennung und gelöschtes Ziel. Mobile Emulation am Mac ersetzt diese Hardwaretests nicht.

## Offizielle Grundlagen

- [Obsidian: Build a plugin](https://docs.obsidian.md/Plugins/Getting%20started/Build%20a%20plugin)
- [Obsidian: Mobile development](https://docs.obsidian.md/Plugins/Getting%20started/Mobile%20development)
- [Obsidian: Editor decorations](https://docs.obsidian.md/Plugins/Editor/Decorations)
- [Obsidian: Vault](https://docs.obsidian.md/Plugins/Vault)
- [Obsidian TypeScript API](https://github.com/obsidianmd/obsidian-api)
- [OpenAI: File transcription](https://developers.openai.com/api/docs/guides/speech-to-text)

Die bestehende Voice-App und ihre Specs dienten als Referenz für Bereinigungsregeln, Fehlerbehandlung und Wiederholbarkeit. Das Plugin hat keine Abhängigkeit von deren Server oder Vault-Schreiber.
