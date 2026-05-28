#!/usr/bin/env python3
"""
Track Indonesian shipping resi via multiple sources.
Usage:
  python3 resiScrape.py <tracking_number> [courier_code]

courier_code (optional): jne, jnt, sicepat, pos, tiki, wahana, anteraja, spx, etc.
Priority:
  1. Binderbyte API (if BINDERBYTE_API_KEY env var is set) — supports ALL Indonesian couriers
  2. Cainiao Global (free, works for couriers in Cainiao network)
"""
import sys, json, os, urllib.request, urllib.parse, ssl, re, html

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120",
    "Accept": "application/json, text/html, */*",
    "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
}

# Binderbyte courier code mapping (AWB prefix → binderbyte courier code)
# Full list: https://api.binderbyte.com/v1/couriers
BINDERBYTE_COURIER_MAP = {
    "spx": "spx",          # Shopee Express
    "jnt": "jnt",          # J&T Express
    "jnec": "jne",         # JNE
    "jne": "jne",          # JNE
    "sicepat": "sicepat",  # SiCepat
    "sce": "sicepat",      # SiCepat
    "anteraja": "anteraja",
    "ant": "anteraja",
    "pos": "pos",          # Pos Indonesia
    "tiki": "tiki",        # TIKI
    "wahana": "wahana",    # Wahana
    "ninja": "ninja",      # Ninja Xpress
    "lion": "lion",        # Lion Parcel
    "lp": "lion",          # Lion Parcel
    "jx": "jnt",           # J&T TikTok = J&T
    "jp": "jnt",           # J&T Express
}

def detect_courier(awb: str) -> tuple[str, str]:
    """
    Guess courier from AWB pattern.
    Returns (display_name, binderbyte_code).
    """
    awb_up = awb.upper()
    # Shopee Express Indonesia: SPXID...
    if awb_up.startswith("SPXID") or awb_up.startswith("SPX"):
        return ("Shopee Express (SPX)", "spx")
    # J&T Express: JX..., JP..., JTP...
    if re.match(r'^JX\d', awb_up) or awb_up.startswith("JP") or awb_up.startswith("JTP"):
        return ("J&T Express", "jnt")
    # JNE: CGKE..., JNEP...
    if awb_up.startswith("CGKE") or awb_up.startswith("JNEP") or awb_up.startswith("JNE"):
        return ("JNE", "jne")
    # SiCepat: BEST..., SCE..., 000...
    if awb_up.startswith("BEST") or awb_up.startswith("SCE") or re.match(r'^000\d', awb_up):
        return ("SiCepat", "sicepat")
    # TIKI: 10 digit number
    if re.match(r'^\d{10}$', awb_up):
        return ("TIKI", "tiki")
    # Lion Parcel: LP...
    if awb_up.startswith("LP"):
        return ("Lion Parcel", "lion")
    # Anteraja: ANT...
    if awb_up.startswith("ANT"):
        return ("Anteraja", "anteraja")
    # Ninja Xpress: NVX...
    if awb_up.startswith("NVX") or awb_up.startswith("NINJA"):
        return ("Ninja Xpress", "ninja")
    # Pos Indonesia: EE/RR... or 8/9 digit number
    if re.match(r'^[A-Z]{2}\d{8}ID$', awb_up):
        return ("Pos Indonesia", "pos")
    # SiCepat also: numeric patterns
    if re.match(r'^\d{12,}$', awb_up):
        return ("SiCepat / J&T", "sicepat")
    return ("Unknown", "")

def track_via_binderbyte(awb: str, courier_code: str = "") -> dict | None:
    """
    Track via Binderbyte API (free 100 req/day, supports all Indonesian couriers).
    Requires BINDERBYTE_API_KEY environment variable.
    """
    api_key = os.environ.get("BINDERBYTE_API_KEY", "").strip()
    if not api_key:
        return None

    # If no courier code given, detect it
    if not courier_code:
        _, courier_code = detect_courier(awb)
    if not courier_code:
        return None

    url = f"https://api.binderbyte.com/v1/track?api_key={urllib.parse.quote(api_key)}&courier={urllib.parse.quote(courier_code)}&awb={urllib.parse.quote(awb)}"
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        resp = urllib.request.urlopen(req, timeout=15, context=ctx).read()
        d = json.loads(resp)
        if d.get("status") != 200:
            return None
        data = d.get("data", {})
        summary = data.get("summary", {})
        history = data.get("history", [])

        courier_name = summary.get("courier_name", courier_code.upper())
        status = summary.get("status", "")
        events = []
        for ev in history:
            events.append({
                "time": ev.get("date", ""),
                "desc": ev.get("desc", ""),
                "location": ev.get("location", ""),
            })

        return {
            "source": "Binderbyte",
            "awb": awb,
            "courier": courier_name,
            "status": status,
            "events": events,
        }
    except Exception:
        return None

def track_via_cainiao(awb: str) -> dict | None:
    """Try Cainiao global tracking (works from Replit, but limited to Cainiao network)."""
    url = f"https://global.cainiao.com/global/detail.json?mailNos={urllib.parse.quote(awb)}&lang=id-ID"
    req = urllib.request.Request(url, headers={**HEADERS, "Referer": "https://global.cainiao.com/"})
    try:
        resp = urllib.request.urlopen(req, timeout=12, context=ctx).read()
        d = json.loads(resp)
        if not d.get("success"):
            return None
        module = d.get("module", [{}])[0] if d.get("module") else {}
        details = module.get("detailList", [])
        if not details:
            return None
        events = []
        for item in details:
            events.append({
                "time": item.get("time", ""),
                "desc": html.unescape(item.get("desc", item.get("standerdDesc", ""))),
                "location": item.get("actionCode", ""),
            })
        return {
            "source": "Cainiao",
            "awb": awb,
            "courier": module.get("cpCode", ""),
            "status": module.get("statusDesc", details[0].get("desc", "") if details else ""),
            "events": events,
        }
    except Exception:
        return None

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: resiScrape.py <awb> [courier_code]"}))
        return

    awb = sys.argv[1].strip()
    courier_arg = sys.argv[2].strip().lower() if len(sys.argv) > 2 else ""

    detected_name, detected_code = detect_courier(awb)
    courier_code = courier_arg or detected_code

    # 1. Try Binderbyte (if API key is set)
    result = track_via_binderbyte(awb, courier_code)

    # 2. Fallback: Cainiao (free, but only works for couriers in their network)
    if not result:
        result = track_via_cainiao(awb)

    if result:
        events = result.get("events", [])
        print(json.dumps({
            "awb": awb,
            "courier": result.get("courier") or detected_name,
            "status": result.get("status", ""),
            "source": result.get("source", ""),
            "events_count": len(events),
            "events": events[:10],
        }))
    else:
        # Check if binderbyte key is missing — give better error message
        has_key = bool(os.environ.get("BINDERBYTE_API_KEY", "").strip())
        if not has_key and detected_code in ("spx", "jnt"):
            msg = (
                f"Kurir {detected_name} tidak dapat dilacak tanpa API key Binderbyte. "
                "Minta admin bot untuk mengatur BINDERBYTE_API_KEY."
            )
        else:
            msg = f"Resi tidak ditemukan. Pastikan nomor resi benar dan sudah diproses oleh {detected_name}."

        print(json.dumps({
            "error": "not_found",
            "awb": awb,
            "detected_courier": detected_name,
            "needs_api_key": not has_key,
            "message": msg,
        }))

if __name__ == "__main__":
    main()
