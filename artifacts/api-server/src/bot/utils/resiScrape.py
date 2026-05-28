#!/usr/bin/env python3
"""
Track Indonesian shipping resi via multiple sources.
Usage:
  python3 resiScrape.py <tracking_number> [courier_code]

courier_code (optional): jne, jnt, sicepat, pos, tiki, wahana, anteraja, etc.
"""
import sys, json, urllib.request, urllib.parse, ssl, re, html

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120",
    "Accept": "application/json, text/html, */*",
    "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
}

def track_via_cainiao(awb: str) -> dict | None:
    """Try Cainiao global tracking (works from Replit)."""
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

def track_via_ongkoskirim(awb: str) -> dict | None:
    """Try ongkoskirim.id tracking (same domain, try track submit)."""
    data = urllib.parse.urlencode({"submit": "track", "resi": awb}).encode()
    hdrs = {**HEADERS, "Content-Type": "application/x-www-form-urlencoded", "Referer": "https://ongkoskirim.id/"}
    req = urllib.request.Request("https://ongkoskirim.id/", data=data, headers=hdrs)
    try:
        resp = urllib.request.urlopen(req, timeout=10, context=ctx).read().decode(errors="ignore")
        if resp and resp.strip() != "null" and resp.strip() != "":
            d = json.loads(resp)
            if d and isinstance(d, dict) and d.get("manifest"):
                return {"source": "OngkosKirim", "awb": awb, "status": d.get("status",""), "events": d.get("manifest", [])}
    except Exception:
        pass
    return None

COURIER_PAGE_MAP = {
    "jne": ("https://cekresi.jne.co.id/", "check_awb", "cekresi.jne.co.id"),
}

def track_via_kurir_website(awb: str, courier: str) -> dict | None:
    """Scrape kurir website result page (limited support)."""
    return None  # Placeholder - most sites require JS rendering

def detect_courier(awb: str) -> str:
    """Guess courier from AWB pattern."""
    awb_up = awb.upper()
    if awb_up.startswith("JNE") or awb_up.startswith("CGKE") or awb_up.startswith("JNEP"):
        return "JNE"
    if awb_up.startswith("JP") or awb_up.startswith("JTP"):
        return "J&T"
    if awb_up.startswith("BEST") or awb_up.startswith("SCE") or re.match(r'^000\d', awb):
        return "SiCepat"
    if awb_up.startswith("TIKI") or re.match(r'^\d{10,12}$', awb) and awb.startswith("00"):
        return "TIKI"
    if awb_up.startswith("LP") or re.match(r'^\d{10}$', awb):
        return "Lion Parcel"
    if awb_up.startswith("ANT"):
        return "Anteraja"
    return "Unknown"

def format_result(result: dict) -> str:
    """Format tracking result for Telegram."""
    events = result.get("events", [])
    courier = result.get("courier", "")
    status = result.get("status", "")
    awb = result.get("awb", "")
    source = result.get("source", "")

    lines = []
    if events:
        for ev in events[:10]:  # max 10 events
            t = ev.get("time", "")
            d = ev.get("desc", "")
            loc = ev.get("location", "")
            if d:
                lines.append(f"🕐 {t}\n   {d}" + (f"\n   📍 {loc}" if loc else ""))
    return json.dumps({
        "awb": awb,
        "courier": courier,
        "status": status,
        "source": source,
        "events_count": len(events),
        "events": events[:10],
        "formatted": lines,
    })

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: resiScrape.py <awb> [courier]"}))
        return

    awb = sys.argv[1].strip()
    courier = sys.argv[2].strip() if len(sys.argv) > 2 else ""

    # Try sources in order
    result = track_via_cainiao(awb)
    if not result:
        result = track_via_ongkoskirim(awb)

    if result:
        print(format_result(result))
    else:
        detected = detect_courier(awb)
        print(json.dumps({
            "error": "not_found",
            "awb": awb,
            "detected_courier": detected,
            "message": f"Resi tidak ditemukan. Pastikan nomor resi benar dan pengiriman sudah diproses oleh {detected}."
        }))

if __name__ == "__main__":
    main()
