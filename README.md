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
