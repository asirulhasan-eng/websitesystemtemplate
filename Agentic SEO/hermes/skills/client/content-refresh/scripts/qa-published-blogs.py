#!/usr/bin/env python3
"""Audit published blogs for depth and parity.

Usage examples:
  python3 scripts/qa-published-blogs.py --index blog/index.html --source-root . --date 'June 1, 2026'
  python3 scripts/qa-published-blogs.py --index blog/index.html --source-root . --date 'June 1, 2026' --live-url https://{{DOMAIN}}/blog/index.html
"""

import argparse
import hashlib
import json
import re
import ssl
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

try:
    from bs4 import BeautifulSoup  # optional but preferred
    _HAS_BS4 = True
except Exception:
    BeautifulSoup = None
    _HAS_BS4 = False


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class CardParser(HTMLParser):
    """Fallback parser when bs4 is unavailable."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.cards = []
        self.in_card = False
        self.in_meta = False
        self.buf = ""
        self.current = None

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        cls = attrs_dict.get("class", "")
        classes = cls.split()

        if tag == "div" and "blog-card" in classes:
            self.in_card = True
            self.current = {"slug": "", "meta": "", "title_hint": ""}
            self.cards.append(self.current)
            return

        if not self.in_card or self.current is None:
            return

        if tag == "a" and "blog-card__image-link" in attrs_dict.get("class", "").split():
            self.current["slug"] = attrs_dict.get("href", "").strip().lstrip("/")

        if tag == "p" and "blog-card__meta" in attrs_dict.get("class", "").split():
            self.in_meta = True
            self.buf = ""

    def handle_endtag(self, tag):
        if self.in_meta and tag == "p":
            self.in_meta = False
            if self.current is not None:
                self.current["meta"] = " ".join(self.buf.split())
        if self.in_card and tag == "div":
            self.in_card = False

    def handle_data(self, data):
        if self.in_meta:
            self.buf += data


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore")


def _parse_html(text: str):
    if _HAS_BS4:
        return BeautifulSoup(text, "html.parser")
    p = CardParser()
    p.feed(text)
    return p


def extract_cards(index_html: str, date_filter: str):
    soup = _parse_html(index_html)

    if _HAS_BS4:
        cards = soup.select(".blog-card")
        out = []
        for c in cards:
            meta = c.select_one(".blog-card__meta")
            d = meta.get_text(" ", strip=True) if meta else ""
            link = c.select_one(".blog-card__image-link")
            href = (link.get("href") or "").strip() if link else ""
            title = c.select_one(".blog-card__title")
            title_txt = title.get_text(" ", strip=True) if title else ""
            if date_filter and date_filter not in d:
                continue
            if href:
                out.append({"slug": href.strip().lstrip("/"), "meta": d, "title_hint": title_txt})
        return out

    cards = soup.cards
    return [c for c in cards if (not date_filter or date_filter in c.get("meta", "")) and c.get("slug")]


def words_count(text: str) -> int:
    return len(re.findall(r"\b\w+[\w'-]*\b", re.sub(r"<[^>]+>", " ", text)))


def article_metrics(html: str):
    if _HAS_BS4:
        soup = BeautifulSoup(html, "html.parser")
        h2 = len(soup.find_all("h2"))
        imgs = soup.find_all("img")
        lazy = sum(1 for i in imgs if (i.get("loading") or "").lower() == "lazy")
        ctas = 0
        for a in soup.find_all("a", href=True):
            t = (a.get_text(" ", strip=True) or "").lower()
            if any(k in t for k in ["contact", "book", "call", "audit", "quote", "schedule", "consult"]):
                ctas += 1
        faq = 0
        for s in soup.find_all("script", type="application/ld+json"):
            try:
                payload = json.loads(s.string or "{}")
            except Exception:
                continue
            if not isinstance(payload, list):
                payload = [payload]
            for item in payload:
                if isinstance(item, dict) and item.get("@type") == "FAQPage":
                    faq = max(faq, len(item.get("mainEntity") or []))
        return {
            "words": words_count(html),
            "h2": h2,
            "faq": faq,
            "images": len(imgs),
            "lazy": lazy,
            "ctas": ctas,
            "has_canonical": bool(soup.find("link", rel="canonical")),
            "has_og": bool(soup.find("meta", attrs={"property": "og:title"})),
            "has_author": any(
                (isinstance(item, dict) and item.get("@type") == "BlogPosting" and item.get("author"))
                for sc in soup.find_all("script", type="application/ld+json")
                for item in ([json.loads(sc.string or "{}")] if sc.string else [{}])
            ),
            "has_blog_posting": any(
                (isinstance(item, dict) and item.get("@type") == "BlogPosting")
                for sc in soup.find_all("script", type="application/ld+json")
                for item in ([json.loads(sc.string or "{}")] if sc.string else [{}])
            ),
        }

    return {
        "words": words_count(html),
        "h2": html.lower().count("<h2"),
        "faq": html.lower().count("faqpage"),
        "images": html.lower().count("<img"),
        "lazy": len(re.findall(r"loading=['\"]lazy['\"]", html, flags=re.I)),
        "ctas": len(re.findall(r">\s*(contact|book|call|audit|quote|schedule|consult)", html, flags=re.I)),
        "has_canonical": "rel=\"canonical\"" in html.lower(),
        "has_og": "property=\"og:title\"" in html.lower(),
        "has_author": "\"author\"" in html,
        "has_blog_posting": "\"@type\":\"BlogPosting\"" in html,
    }


def grade(m):
    score = 0
    score += 2 if m["words"] >= 2500 else 1
    score += 1 if m["h2"] >= 10 else 0
    score += 1 if m["faq"] >= 6 else 0
    score += 1 if m["images"] >= 5 else 0
    score += 1 if m["lazy"] >= 4 else 0

    if score >= 6:
        return "A"
    if score >= 5:
        return "B"
    if score >= 4:
        return "C"
    return "D"


def issues(m):
    out = []
    if m["words"] < 2500:
        out.append("Add 300-500 practical words")
    if m["h2"] < 10:
        out.append("Add 1-3 clear H2 sections")
    if m["faq"] < 6:
        out.append("Increase FAQ to 6+ questions")
    if m["images"] < 5:
        out.append("Add supporting images/diagrams")
    if m["lazy"] < max(2, m["images"] // 2):
        out.append("Apply loading='lazy' to non-hero images")
    if m["ctas"] == 0:
        out.append("Add at least one clear CTA")
    if not (m["has_canonical"] and m["has_og"]):
        out.append("Restore canonical + OG tags")
    if not (m["has_author"] and m["has_blog_posting"]):
        out.append("Restore BlogPosting author schema")
    return out


def fetch_status(url: str) -> int:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, context=ssl._create_unverified_context(), timeout=30) as r:
        return r.status


def parse_live_index(url: str, date_filter: str):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, context=ssl._create_unverified_context(), timeout=30) as r:
        body = r.read().decode("utf-8", "ignore")
        return sha256(body), extract_cards(body, date_filter), len(body)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--index", required=True)
    p.add_argument("--source-root", default=".")
    p.add_argument("--date", required=True)
    p.add_argument("--live-url", default="")
    a = p.parse_args()

    root = Path(a.source_root)
    index_html = read(root / a.index)
    cards = extract_cards(index_html, a.date)
    print(f"TOTAL_SLUGS_BY_DATE={len(cards)}")

    rows = []
    for c in cards:
        slug = c["slug"].strip().lstrip("/")
        path = root / "blog" / f"{slug}.html"
        if not path.exists():
            rows.append((slug, "D", 404, {"words": 0, "h2": 0, "faq": 0, "images": 0, "lazy": 0, "ctas": 0, "has_canonical": False, "has_og": False, "has_author": False, "has_blog_posting": False}))
            continue
        html = read(path)
        m = article_metrics(html)
        g = grade(m)
        st = 0
        try:
            st = fetch_status(f"https://{{DOMAIN}}/blog/{slug}.html")
        except Exception:
            st = 0
        rows.append((slug, g, st, m, issues(m)))

    rows_sorted = sorted(rows, key=lambda x: ("ABCD".index(x[1]), x[0]))
    for slug, g, st, m, iss in rows_sorted:
        print(f"{slug}\t{g}\tHTTP={st}\twords={m['words']}\tH2={m['h2']}\tFAQ={m['faq']}\tIMG={m['images']}\tLAZY={m['lazy']}\tissues={'; '.join(iss)}")

    if a.live_url:
        live_sha, live_cards, live_len = parse_live_index(a.live_url, a.date)
        local_slugs = sorted(c["slug"] for c in cards)
        live_slugs = sorted(c["slug"] for c in live_cards)
        print(f"LIVE_SHA={live_sha}")
        print(f"LIVE_LEN={live_len}")
        missing_in_live = [s for s in local_slugs if s not in live_slugs]
        extra_live = [s for s in live_slugs if s not in local_slugs]
        print(f"MISSING_IN_LIVE={','.join(missing_in_live)}")
        print(f"EXTRA_LIVE={','.join(extra_live)}")


if __name__ == "__main__":
    main()
