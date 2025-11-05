"""
Scrape CBC RSS feeds and produce a consolidated JSON file.

This script reads the configuration from ``config.yml``, fetches
each RSS feed listed under ``sections``, normalises the data, and
writes a single JSON file at ``../data/latest.json``.  It enforces
rate limiting between requests and respects the configured
execution schedule by checking the current hour.

The output JSON conforms to a simple contract:

.. code-block:: json

    {
      "source": "CBC News",
      "generated_at": "2025-11-05T10:00:00-05:00",
      "timezone": "America/Toronto",
      "items": [
        {
          "id": "...",
          "url": "...",
          "title": "...",
          "published_at": "...",
          "section": "...",
          "summary_auto": "...",
          "bias_heuristic": {
            "article_type": "News",
            "sentiment": 0.123,
            "subjectivity_hint": "low"
          }
        },
        ...
      ]
    }

See README.md for additional documentation.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
import html  # used for unescaping titles and summaries
from datetime import datetime, timedelta

import feedparser
import requests
from readability import Document  # type: ignore
from dateutil import tz
import yaml

from utils import (
    stable_id,
    parse_date,
    summarize,
    compute_bias,
)

# Configure logging to write to stderr with timestamps.
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


def load_config(path: str) -> dict:
    """Load the YAML configuration file."""
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def should_run_now(config: dict) -> bool:
    """Determine if the scraper should run at the current time.

    The script only executes at the hours specified in
    ``config['allowed_hours']`` (local time of the configured timezone).

    Args:
        config: Parsed configuration dictionary.

    Returns:
        True if the current hour is in the allowed set, else False.
    """
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


def fetch_content(url: str, user_agent: str = None) -> Optional[str]:
    """Fetch raw text content of a web page.

    This helper is used when ``allow_extract`` is enabled and no
    summary is provided by the feed.  If a request fails or
    encounters an exception, None is returned instead of raising.

    Args:
        url: The URL to fetch.
        user_agent: Optional user agent string to include in the request.

    Returns:
        A string containing the cleaned article text, or None.
    """
    try:
        headers = {}
        if user_agent:
            headers["User-Agent"] = user_agent
        resp = requests.get(url, headers=headers, timeout=10)
        if resp.status_code != 200:
            logger.warning("Failed to fetch %s: status %s", url, resp.status_code)
            return None
        doc = Document(resp.text)
        return doc.summary()
    except Exception as exc:
        logger.warning("Exception fetching %s: %s", url, exc)
        return None


def scrape_section(name: str, config: dict, now: datetime, allow_extract: bool) -> list:
    """Scrape a single RSS feed and return a list of normalised items.

    Args:
        name: The section key from the configuration.
        config: The full configuration dictionary.
        now: The current datetime (timezone aware) for filtering.
        allow_extract: Whether to fetch full articles when summaries are missing.

    Returns:
        A list of dictionaries representing articles for this section.
    """
    section_cfg = config["sections"][name]
    url = section_cfg["url"]
    max_items = section_cfg["max_items"]
    logger.info("Fetching feed for section '%s' (%s)", section_cfg["name"], url)
    # Parse RSS feed
    feed = feedparser.parse(url)
    items = []
    tz_name = config.get("timezone", "UTC")
    local_tz = tz.gettz(tz_name)
    window_start = now - timedelta(hours=config.get("window_hours", 24))
    for entry in feed.entries:
        # Determine publication date
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
        # Filter out items older than the window
        dt = datetime.fromisoformat(published_at)
        if dt < window_start:
            continue
        url_entry = entry.get("link")
        title = html.unescape(entry.get("title", "")).strip()
        # Use summary or description fields if available
        summary_raw = entry.get("summary") or entry.get("description") or ""
        summary_auto = summarize(summary_raw, max_chars=500)
        # If summary is empty and extraction is enabled, fetch article
        if not summary_auto and allow_extract and url_entry:
            raw_html = fetch_content(url_entry, user_agent="Mozilla/5.0")
            if raw_html:
                summary_auto = summarize(raw_html, max_chars=500)
        bias = compute_bias(url_entry or "", title, summary_auto)
        item = {
            "id": stable_id(url_entry or title),
            "url": url_entry,
            "title": title,
            "published_at": published_at,
            "section": section_cfg["name"],
            "summary_auto": summary_auto,
            "bias_heuristic": bias.to_dict(),
        }
        items.append(item)
    # Sort by published date descending and cap
    items.sort(key=lambda x: x["published_at"], reverse=True)
    return items[:max_items]


def deduplicate(items: list) -> list:
    """Remove duplicate articles based on URL and title.

    If multiple entries share the same (URL, title) pair the most
    recent one (appearing first in the list) is kept.

    Args:
        items: The list of article dictionaries.

    Returns:
        A deduplicated list preserving order.
    """
    seen = set()
    deduped = []
    for item in items:
        key = (item.get("url"), item.get("title").lower())
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped


def main() -> None:
    base_dir = os.path.dirname(os.path.abspath(__file__))
    config_path = os.path.join(base_dir, "config.yml")
    config = load_config(config_path)
    if not should_run_now(config):
        return
    now = datetime.now(tz.gettz(config.get("timezone", "UTC")))
    all_items = []
    allow_extract = bool(config.get("allow_extract", False))
    for sec_key in config.get("sections", {}):
        try:
            items = scrape_section(sec_key, config, now, allow_extract)
            all_items.extend(items)
            # Respect rate limit between feeds
            time.sleep(config.get("rate_limit_seconds", 1))
        except Exception as exc:
            logger.error("Error scraping section %s: %s", sec_key, exc)
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