#!/usr/bin/env python3
"""
Facebook video downloader via snapsave.app
Usage: python3 fbSnapsave.py <facebook_url>
Returns JSON: { status, title, thumbnail, items: [{url, label, quality}] }
           or { error }
"""
import sys
import urllib.request
import urllib.parse
import re
import json

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)


def decode_snapsave_js(js: str):
    m = re.search(
        r'\("([^"]+)",\s*\d+,\s*"([^"]+)",\s*(\d+),\s*(\d+),\s*\d+\)', js
    )
    if not m:
        return None
    h, n, t, e = m.group(1), m.group(2), int(m.group(3)), int(m.group(4))
    separator = n[e]
    result = []
    for seg in h.split(separator):
        if not seg:
            continue
        s = seg
        for j, c in enumerate(n):
            s = s.replace(c, str(j))
        try:
            result.append(chr(int(s, e) - t))
        except Exception:
            pass
    raw = "".join(result)
    try:
        return urllib.parse.unquote(raw.encode("latin-1").decode("utf-8"))
    except Exception:
        return raw


def fetch_snapsave(url: str, timeout: int = 30) -> str:
    data = urllib.parse.urlencode({"url": url}).encode()
    req = urllib.request.Request(
        "https://snapsave.app/action.php",
        data=data,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": UA,
            "Referer": "https://snapsave.app/",
            "Origin": "https://snapsave.app",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="ignore")


def unescape_js_string(s: str) -> str:
    return (
        s.replace('\\"', '"')
        .replace("\\/", "/")
        .replace("\\n", "\n")
        .replace("\\t", "\t")
        .replace("\\'", "'")
        .replace("\\\\", "\\")
    )


def parse_download_links(inner_html: str):
    items = []
    # Pattern: <td class="video-quality">QUALITY</td> ... <a href="URL" ...>
    # The table row spans multiple tds, so we search each <tr> block
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", inner_html, re.DOTALL)
    for row in rows:
        quality_match = re.search(
            r'class="video-quality"[^>]*>([^<]+)', row
        )
        link_match = re.search(
            r'href="(https://[^"]+)"[^>]*onclick="[^"]*click_download_file',
            row,
        )
        if not link_match:
            link_match = re.search(
                r'href="(https://d\.rapidcdn\.app/[^"]+)"', row
            )
        if not link_match:
            link_match = re.search(
                r'href="(https://[^"]+fbcdn\.net[^"]+)"', row
            )
        if quality_match and link_match:
            quality = quality_match.group(1).strip()
            url = link_match.group(1)
            # Derive a short label
            if "HD" in quality or "720" in quality or "1080" in quality:
                label = "HD"
            elif "SD" in quality or "480" in quality or "360" in quality:
                label = "SD"
            else:
                label = quality or "Download"
            items.append({"url": url, "label": label, "quality": quality})

    # Fallback: any rapidcdn or fbcdn link
    if not items:
        links = re.findall(
            r'href="(https://d\.rapidcdn\.app/[^"]+|https://[^"]+fbcdn\.net/[^"]+)"',
            inner_html,
        )
        for i, link in enumerate(links[:5]):
            items.append(
                {"url": link, "label": f"Download {i + 1}", "quality": ""}
            )

    return items


def download_facebook(url: str):
    js = fetch_snapsave(url)
    decoded = decode_snapsave_js(js)
    if not decoded:
        return {"error": "Failed to decode snapsave response"}

    # Check for error messages (private, invalid, etc.)
    alert_match = re.search(r'#alert["\])[^=]*\.innerHTML\s*=\s*"([^"]+)"', decoded)
    if alert_match and "rapidcdn" not in decoded:
        err_html = alert_match.group(1)
        err_text = re.sub(r"<[^>]+>", "", err_html).strip()
        return {"error": err_text or "Video unavailable or private"}

    if "private" in decoded.lower() and "rapidcdn" not in decoded:
        return {
            "error": "This video is private. Only public Facebook videos can be downloaded."
        }

    # Extract the innerHTML string set into #download-section
    html_match = re.search(
        r'getElementById\("download-section"\)\.innerHTML\s*=\s*"((?:[^"\\]|\\.)*)"',
        decoded,
    )
    if html_match:
        inner_html = unescape_js_string(html_match.group(1))
    else:
        inner_html = decoded

    items = parse_download_links(inner_html)

    if not items:
        if "private" in decoded.lower():
            return {
                "error": "This video is private. Only public Facebook videos can be downloaded."
            }
        return {
            "error": "No download links found. The video may be private or geo-restricted."
        }

    # Extract thumbnail
    thumb_match = re.search(r'<img\s+src="(https://[^"]+)"', inner_html)
    thumbnail = thumb_match.group(1) if thumb_match else None

    # Extract title/description
    title_match = re.search(r'<span class="video-des">([^<]*)</span>', inner_html)
    title = title_match.group(1).strip() if title_match else "Facebook Video"
    if not title:
        title = "Facebook Video"

    return {
        "status": "ok",
        "title": title,
        "thumbnail": thumbnail,
        "items": items,
    }


if __name__ == "__main__":
    fb_url = sys.argv[1] if len(sys.argv) > 1 else ""
    if not fb_url:
        print(json.dumps({"error": "No URL provided"}))
        sys.exit(1)
    try:
        result = download_facebook(fb_url)
        print(json.dumps(result))
    except urllib.error.URLError as exc:
        print(json.dumps({"error": f"Network error: {exc.reason}"}))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
