"""
Scrape CBC RSS feeds and produce a consolidated JSON file.

(… header comment unchanged …)
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
import html  # used for unescaping titles and summaries
import random
from datetime import datetime, timedelta
from typing import Optional

import feedparser
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from readability import Document  # type: ignore
from dateutil import tz
import yaml

from utils import (
    stable_id,
    parse_date,
    summarize,
    compute_bias,
    ensure_nltk_data,   # <-- add this import

)

# Configure logging to write to stderr with timestamps.
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# A browser-like UA helps avoid soft-blocks; forcing Connection: close prevents odd keep-alive resets.
BROWSER_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36"
)


def load_config(path: str) -> dict:
    """Load the YAML configuration file."""
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)
        
def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="Bypass time gate and run now")
    args = parser.parse_args()

    base_dir = os.path.dirname(os.path.abspath(__file__))
    config_path = os.path.join(base_dir, "config.yml")
    config = load_config(config_path)

    ensure_nltk_data()   # <-- add this line

    if not should_run_now(config, force=args.force):
        return

def should_run_now(config: dict, force: bool = False) -> bool:
    """Determine if the scraper should run at the current time (or force)."""
    if force:
        logger.info("Force mode enabled; bypassing allowed_hours gate.")
        return True
    tz_name = config.get("timezone", "UTC")
    allowed = set(config.get("allowed_hours", []))
    now = datetime.now(tz.gettz(tz_name))
    if now.hour in allowed:
        return True
    logger.info(
        "Current hour %s is not in allowed_hours %s; exiting without work.",
        now.hour,
        sorted(allowed),
    )
    return False


def make_session() -> requests.Session:
    """Make a requests session with retries, backoff, and polite headers."""
    s = requests.Session()
    retry = Retry(
        total=6,
        backoff_factor=0.8,  # 0.8, 1.6, 3.2, ...
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset({"GET"}),
        raise_on_status=False,
        respect_retry_after_header=True,
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=4, pool_maxsize=4)
    s.mount("http://", adapter)
    s.mount("https://", adapter)
    s.headers.update(
        {
            "User-Agent": BROWSER_UA,
            "Accept": "application/rss+xml,application/xml;q=0.9,*/*;q=0.8",
            "Connection": "close",  # avoid lingering TCP connections on publisher/CDN
        }
    )
    return s


def fetch_feed_bytes(session: requests.Session, url: str, timeout: int = 20) -> bytes:
    """Fetch an RSS feed as bytes (for feedparser.parse). Adds polite jitter."""
    # short polite pause (0.8–2.0s) before each network call
    time.sleep(0.8 + random.random() * 1.2)
    resp = session.get(url, timeout=timeout)
    resp.raise_for_status()
    return resp.content


def fetch_content(session: requests.Session, url: str) -> Optional[str]:
    """Fetch raw HTML for article extraction when summaries are missing."""
    try:
        # extra-precise headers for HTML fetch
        headers = {
            "User-Agent": BROWSER_UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Connection": "close",
        }
        resp = session.get(url, headers=headers, timeout=15)
        if resp.status_code != 200:
            logger.warning("Failed to fetch %s: status %s", url, resp.status_code)
            return None
        doc = Document(resp.text)
        return doc.summary()
    except Exception as exc:
        logger.warning("Exception fetching %s: %s", url, exc)
        return None


def scrape_section(
    name: str,
    config: dict,
    now: datetime,
    allow_extract: bool,
    session: requests.Session,
) -> list:
    """Scrape a single RSS feed and return a list of normalised items."""
    section_cfg = config["sections"][name]
    url = section_cfg["url"]
    max_items = section_cfg["max_items"]
    logger.info("Fetching feed for section '%s' (%s)", section_cfg["name"], url)

    # Fetch bytes with retries, then parse
    raw = fetch_feed_bytes(session, url, timeout=20)
    feed = feedparser.parse(raw)

    items = []
    tz_name = config.get("timezone", "UTC")
    window_start = now - timedelta(hours=config.get("window_hours", 24))

    for entry in getattr(feed, "entries", []):
        # Publication date
        pub_str = None
        for key in ["published", "updated", "pubDate", "date"]:
            if key in entry:
                pub_str = entry[key]
                break
        if not pub_str:
            continue
        published_at = parse_date(pub_str, tz_name)
        if not published_at:
            continue
        dt = datetime.fromisoformat(published_at)
        if dt < window_start:
            continue

        url_entry = entry.get("link")
        title = html.unescape(entry.get("title", "")).strip()
        summary_raw = entry.get("summary") or entry.get("description") or ""
        summary_auto = summarize(summary_raw, max_chars=500)

        # Try HTML extraction only if summary missing and allowed
        if not summary_auto and allow_extract and url_entry:
            extracted_html = fetch_content(session, url_entry)
            if extracted_html:
                summary_auto = summarize(extracted_html, max_chars=500)

        bias = compute_bias(url_entry or "", title, summary_auto)
        items.append(
            {
                "id": stable_id(url_entry or title),
                "url": url_entry,
                "title": title,
                "published_at": published_at,
                "section": section_cfg["name"],
                "summary_auto": summary_auto,
                "bias_heuristic": bias.to_dict(),
            }
        )

    # Sort by published date desc and cap
    items.sort(key=lambda x: x["published_at"], reverse=True)
    return items[:max_items]


def deduplicate(items: list) -> list:
    """Remove duplicate articles based on URL and title (case-folded)."""
    seen = set()
    deduped = []
    for item in items:
        key = (item.get("url"), (item.get("title") or "").lower())
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="Bypass time gate and run now")
    args = parser.parse_args()

    base_dir = os.path.dirname(os.path.abspath(__file__))
    config_path = os.path.join(base_dir, "config.yml")
    config = load_config(config_path)

    if not should_run_now(config, force=args.force):
        return

    now = datetime.now(tz.gettz(config.get("timezone", "UTC")))
    allow_extract = bool(config.get("allow_extract", False))
    all_items = []

    session = make_session()
    per_request_sleep = float(config.get("rate_limit_seconds", 1.0))

    for sec_key in config.get("sections", {}):
        try:
            items = scrape_section(sec_key, config, now, allow_extract, session)
            all_items.extend(items)
        except Exception as exc:
            logger.error("Error scraping section %s: %s", sec_key, exc)
        finally:
            # jittered delay between sections: (rate_limit_seconds ± 50%)
            jitter = per_request_sleep * (0.5 + random.random())
            time.sleep(max(0.5, jitter))

    # Deduplicate across sections and sort globally by date
    all_items.sort(key=lambda x: x["published_at"], reverse=True)
    deduped = deduplicate(all_items)

    output = {
        "source": "CBC News",
        "generated_at": now.isoformat(),
        "timezone": config.get("timezone", "UTC"),
        "items": deduped,
    }

    # Write to ../data/latest.json relative to scraper directory
    data_dir = os.path.join(base_dir, os.pardir, "data")
    os.makedirs(data_dir, exist_ok=True)
    output_path = os.path.join(data_dir, "latest.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    logger.info("Wrote %d items to %s", len(deduped), output_path)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        logger.info("Interrupted by user")
