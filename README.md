# Nearby Planner (no-build PWA)

A simple offline-capable PWA (installable on Android) to store:
- Places (with categories, optional opening hours, optional coordinates)
- Events (with recurrence: none/weekly/monthly/yearly, optional coordinates or linked place)
- Favorites
- Export/Import (JSON), and ICS export per event + ICS import into Events

## Run locally
Any static server works.

### Option A: Python (recommended)
```bash
cd nearby-planner-pwa
python -m http.server 5173
```
Open http://localhost:5173

### Option B: Node
```bash
npx serve .
```

## Install on Android
1. Host it (or run locally from your PC and access via LAN).
2. Open in Chrome.
3. Menu → **Install app** / **Add to Home screen**.

## Notes
- Location: device GPS (if allowed) or manual city/coordinates in Settings.
- Geocoding uses OpenStreetMap Nominatim.


## Quick import on mobile (ChatGPT copy/paste)
1) Open **Settings → Quick import (ChatGPT)**  
2) Tap **Copy template** and paste it into ChatGPT.
3) Give ChatGPT a screenshot / description, and tell it to output **ONLY JSON**.
4) Copy the JSON back into **Paste ChatGPT JSON** → **Preview** → **Import**.

Tip: In ChatGPT, you can attach an event screenshot; the template is designed so the output can be pasted directly into the app.
