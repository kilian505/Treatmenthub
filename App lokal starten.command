#!/bin/bash
# Startet den Treatment Manager lokal unter http://localhost:8000
cd "$(dirname "$0")/app" || exit 1
echo "Treatment Manager läuft unter http://localhost:8000"
echo "Zum Beenden dieses Fenster schließen oder Ctrl+C drücken."
( sleep 1; open "http://localhost:8000" ) &
python3 -m http.server 8000
