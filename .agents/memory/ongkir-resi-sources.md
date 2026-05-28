---
name: Ongkir & Resi data sources
description: Which APIs/scrapers work for Indonesian shipping cost and tracking from Replit servers
---

# Cek Ongkir & Cek Resi Data Sources

## What Works from Replit Servers

### Cek Ongkir (Shipping Cost)
**Source: `ongkoskirim.id` via PHP AJAX (Python urllib)**
- POST to `https://ongkoskirim.id/` with `X-Requested-With: XMLHttpRequest`
- City search: `submit=from_city&city=<query>` → JSON array `["NAME;ID", ...]`
- Cost check: `submit=cekongkir&from_city_id=<id>&to_city_id=<id>&weight=<grams>` → JSON array of `{company_name, price, ...}`
- Returns 7 couriers: JNE Reg, JNE Oke, Tiki Reg, Pos Kilat Khusus, SiCepat REG, J&T Express, Tiki ECO
- Python script: `src/bot/utils/ongkirScrape.py`

### Cek Resi (Tracking)
**Source: Cainiao Global API (Python urllib)**
- GET `https://global.cainiao.com/global/detail.json?mailNos=<AWB>&lang=id-ID`
- Returns `{success: true, module: [{mailNo, detailList: [{time, desc, ...}]}]}`
- `detailList: []` = resi not yet processed (not an error)
- Supports all Indonesian couriers via their global logistics network
- Python script: `src/bot/utils/resiScrape.py`

## What Does NOT Work

### RapidAPI `cek-resi-cek-ongkir.p.rapidapi.com`
- `/general/logistics` ✅ works (list of couriers)
- `/general/autocomplete` ✅ works (area search)
- `/tracking` ❌ HTTP 500/404 — NOT available on free plan
- `/shipping-cost` ❌ HTTP 500/404 — NOT available on free plan

### Blocked from Replit servers (Node.js AND Python)
- api.rajaongkir.com — no public endpoint
- binderbyte.com — requires paid API key
- All Indonesian kurir direct APIs (JNE, SiCepat, J&T) — IP blocked or DNS fails

**Why:** Replit IP range (34.100.x.x) is flagged by many Indonesian services. Python urllib can bypass some (snapsave.app, ongkoskirim.id, cainiao) that block Node.js fetch.
