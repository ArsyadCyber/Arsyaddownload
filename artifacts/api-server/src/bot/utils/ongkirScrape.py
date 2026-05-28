#!/usr/bin/env python3
"""
Scrape ongkoskirim.id for shipping cost and city search.
Usage:
  python3 ongkirScrape.py city <query>
  python3 ongkirScrape.py cost <from_city_id> <to_city_id> <weight_grams>
"""
import sys, json, urllib.request, urllib.parse, ssl

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": "https://ongkoskirim.id/",
    "Origin": "https://ongkoskirim.id",
}

def search_city(query: str) -> list:
    """Return list of {id, name} matching query."""
    for submit_key in ("from_city", "to_city"):
        data = urllib.parse.urlencode({"submit": submit_key, "city": query.lower()}).encode()
        req = urllib.request.Request("https://ongkoskirim.id/", data=data, headers=HEADERS)
        try:
            raw = urllib.request.urlopen(req, timeout=12, context=ctx).read().decode(errors="ignore")
            items = json.loads(raw)
            if isinstance(items, list) and items:
                results = []
                for item in items:
                    parts = str(item).split(";")
                    if len(parts) >= 2:
                        results.append({"id": parts[1].strip(), "name": parts[0].strip()})
                return results
        except Exception:
            pass
    return []

def check_cost(from_id: str, to_id: str, weight: str) -> list:
    """Return list of {company_name, price} for all couriers."""
    data = urllib.parse.urlencode({
        "submit": "cekongkir",
        "from_city_id": from_id,
        "to_city_id": to_id,
        "weight": weight,
    }).encode()
    req = urllib.request.Request("https://ongkoskirim.id/", data=data, headers=HEADERS)
    raw = urllib.request.urlopen(req, timeout=15, context=ctx).read().decode(errors="ignore")
    items = json.loads(raw)
    if not isinstance(items, list):
        return []
    return [{"company_name": i.get("company_name",""), "price": i.get("price","0")} for i in items]

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        if cmd == "city":
            query = sys.argv[2] if len(sys.argv) > 2 else ""
            print(json.dumps(search_city(query)))
        elif cmd == "cost":
            from_id, to_id, weight = sys.argv[2], sys.argv[3], sys.argv[4]
            print(json.dumps(check_cost(from_id, to_id, weight)))
        else:
            print(json.dumps({"error": "Unknown command"}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
