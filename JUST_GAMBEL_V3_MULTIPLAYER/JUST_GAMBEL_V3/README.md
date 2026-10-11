# JUST GAMBEL!!! V3 — Multiplayer Arcade

Ein kostenloses Online-Arcade-Projekt mit Live-Chat, Admin-Dashboard, 7 Spielen und echten Zweispieler-Lobbys. Keine Zahlungen, Echtgeld-Einsätze, Auszahlungen oder eintauschbaren Preise. Punkte dienen nur als Spielscore und für kosmetische Profile.

## Start auf deinem PC

1. Installiere [Node.js 18+](https://nodejs.org/).
2. Entpacke diese ZIP komplett.
3. Doppelklicke `start-windows.bat` und gib ein sicheres Admin-Passwort ein (mindestens 8 Zeichen).
4. Öffne `http://localhost:3000`.
5. Öffne `ADMIN` und melde dich mit dem gerade gesetzten Serverpasswort an.

Für ein zweites Gerät im gleichen WLAN nutze `http://DEINE-LOKALE-IP:3000` (Firewall muss den Port freigeben). Für Freunde übers Internet ist ein öffentliches Hosting nötig; das Projekt enthält dafür `render.yaml`.

## Das ist neu in V3

- **Niederlage = +0 Punkte** bei Roulette und Twenty One (auch Gleichstand); Risk Reactor gab beim Fehlschlag bereits +0.
- **Lucky Wheel** hat jetzt auch leere Felder mit +0.
- **Signal Hunt**: Von vier Signalen das richtige treffen, sonst +0.
- **Math Blitz**: Zeitbegrenzte Rechenaufgaben, falsch/zu spät = +0.
- **Chaos Chamber Multiplayer**: Host erstellt eine Lobby mit Raumname und optionalem Passwort. Alle sehen Lobbyname, Host, Status und Teilnehmerzahl, aber nicht das Passwort. Zwei Spieler treten bei, nur der Host kann starten. Beide wählen eines von drei versteckten Feldern. Bei richtiger Wahl kann ein Spieler gewinnen und erhält +300 kostenlose Punkte; Verlierer bekommen +0. Ein Gleichstand führt zur nächsten Runde (maximal fünf). Host kann einen Rematch starten, Spieler können ihre Lobby verlassen.
- **Admin: Räume** zeigt öffentliche/gesperrte Räume und erlaubt das Schließen eines Raums.
- **Alte Admin-Funktionen erhalten**: Adminpunkte vergeben, sperren/entsperren, stummschalten, Chatnachrichten löschen, Ankündigungen, Einstellungen und Audit-Logs. Der Anti-Selbstban-Fix bleibt dabei.

## Update von V2 / V2.1 ohne Punktverlust

1. Alten Server beenden.
2. Ein Backup von deiner alten `data.json` anlegen.
3. Neue Projektdateien entpacken und in den bisherigen Projektordner kopieren. **Die alte `data.json` NICHT überschreiben oder löschen.**
4. Server starten.

Alte Accounts und Spielpunkte bleiben erhalten, wenn der Server weiterhin dieselbe `data.json` nutzt. Browser-Cookies für Gastprofile nicht löschen. Aktuelle Chaos-Chamber-Räume werden absichtlich nur im Arbeitsspeicher gehalten und gehen bei einem Serverneustart verloren.

## Im Internet teilen

1. Projekt ohne `data.json` auf GitHub hochladen.
2. Auf [Render](https://render.com/) `New → Blueprint` und das Repository auswählen.
3. Im Dashboard die geheime Umgebungsvariable `ADMIN_PASSWORD` setzen.
4. Den erzeugten öffentlichen Link an deine Freunde weitergeben.

**Achtung:** Der kostenlose Render-Service hat keinen garantierten persistenten Speicher für `data.json`; bei Neustarts/Deploys können Punkte und Chat verschwinden. Für einen dauerhaften öffentlichen Betrieb brauchst du eine Datenbank oder ein persistent gemountetes Laufwerk. Der Server ist ein Hobbyprojekt und kein vollständiger Produktionsdienst mit sicheren, dauerhaft authentifizierten Benutzerkonten. Profilnamen können von Gästen frei gewählt werden.

## Technisches

- Node.js HTTP, keine npm-Abhängigkeiten, serverseitiger Zufallsgenerator (`crypto.randomInt`).
- REST-API für Spiele, Chat und Rooms; Server-Sent Events für Chat, Online-Zahlen, Spielerupdates und alle Lobbyänderungen.
- Das Room-Passwort wird nicht an Clients ausgeliefert, sondern als gesalzener Hash im Server-Arbeitsspeicher gespeichert.
- Spielresultate und Belohnungen werden serverseitig berechnet, nicht aus dem Browser übernommen.
- Alle Niederlagen verdienen +0, gesammelte Kontostände werden nicht als Einsatz abgezogen.
- Tests mit `npm test` (Grundfunktionen, Admin-Selbstban-Fix, Mehrspieler-Lobbys, Passwort-Schutz, Scores).

**Voraussetzung:** Du musst einen Server laufen lassen; eine reine HTML-Datei allein bietet keinen Online-Chat oder Online-Multiplayer.
