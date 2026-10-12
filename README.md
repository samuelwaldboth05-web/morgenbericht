# Morgenbericht

Ein persönliches Dashboard mit Schlaf, Bewegung, Terminen, Weltnachrichten und einem Zitat des Tages.

- `index.html` zeigt den Bericht. Beim Öffnen fragt die Seite nach einem Passwort und entschlüsselt die Daten erst im Browser.
- `data.enc.json` enthält die Tagesdaten, verschlüsselt. Eine geplante Routine erzeugt sie jeden Morgen neu.
- `keys.json` enthält den öffentlichen Schlüssel und den mit dem Passwort geschützten privaten Schlüssel.
- `setup.html` erzeugt die Schlüssel einmalig im Browser. Das Passwort verlässt den Browser nie.
- `scripts/` enthält die Skripte der Routine, `ROUTINE.md` ihre Anleitung.

Die Daten sind mit AES-256-GCM verschlüsselt, der Schlüssel ist mit RSA-OAEP für den öffentlichen Schlüssel verpackt. Der private Schlüssel liegt nur mit PBKDF2 (600.000 Runden) und AES-GCM geschützt im Repository. Die Stärke des Schutzes hängt daher vom Passwort ab.
