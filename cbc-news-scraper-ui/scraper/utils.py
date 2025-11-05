"""
Utility functions for the CBC news scraper.

This module contains helper functions to normalise RSS entries,
generate short summaries, detect article bias heuristics and other
supporting utilities.  Breaking the logic out into a separate
module keeps the main scraper script focused on orchestration.
"""

from __future__ import annotations

import hashlib
import html
import logging
import re
from dataclasses import dataclass
from typing import Dict, Iterable, Optional, Tuple

from dateutil import parser as date_parser
from dateutil import tz
import nltk
from nltk.tokenize import sent_tokenize
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

# Ensure NLTK sentence tokenizer is available.  If the data is
# missing it will be downloaded on first run.  The try/except
# prevents concurrent downloads from racing.
try:
    nltk.data.find("tokenizers/punkt")
except LookupError:
    nltk.download("punkt")


_sentiment_analyzer = SentimentIntensityAnalyzer()


def stable_id(url: str) -> str:
    """Compute a stable identifier for an article based on its URL.

    We use SHA1 here to produce a compact deterministic key.

    Args:
        url: The canonical URL of the article.

    Returns:
        A hex string representing the hash.
    """
    return hashlib.sha1(url.encode("utf-8")).hexdigest()


def parse_date(date_str: str, timezone: str) -> Optional[str]:
    """Parse an arbitrary date string and convert it into ISO‑8601.

    CBC’s RSS feeds typically include `published` or `updated` fields
    that are RFC822 formatted.  We rely on python-dateutil to handle
    these automatically and convert them into the configured
    timezone.

    Args:
        date_str: The date string from the feed.
        timezone: An IANA timezone name (e.g., ``America/Toronto``).

    Returns:
        An ISO‑8601 formatted string, or None if the input could not
        be parsed.
    """
    try:
        dt = date_parser.parse(date_str)
        if not dt.tzinfo:
            dt = dt.replace(tzinfo=tz.tzutc())
        local_tz = tz.gettz(timezone)
        return dt.astimezone(local_tz).isoformat()
    except Exception:
        logging.getLogger(__name__).warning("Failed to parse date %s", date_str)
        return None


def summarize(text: str, max_chars: int = 500) -> str:
    """Create a concise summary up to ``max_chars`` characters.

    The summarisation strategy is deliberately simple: it tokenises
    the text into sentences and concatenates them until the desired
    character limit is reached.  If the text contains no sentences,
    it falls back to truncating the raw text.  HTML entities are
    unescaped prior to tokenisation.

    Args:
        text: The raw content or summary of an article.
        max_chars: Maximum length of the summary in characters.

    Returns:
        A string not exceeding ``max_chars`` characters.
    """
    if not text:
        return ""
    # Unescape any HTML entities and strip tags.
    cleaned = html.unescape(re.sub(r"<[^>]+>", " ", text))
    sentences = sent_tokenize(cleaned)
    summary_parts = []
    total_chars = 0
    for sentence in sentences:
        sentence = sentence.strip()
        if not sentence:
            continue
        if total_chars + len(sentence) + 1 > max_chars:
            break
        summary_parts.append(sentence)
        total_chars += len(sentence) + 1  # account for space
    if summary_parts:
        summary = " ".join(summary_parts)
    else:
        # Fallback: truncate the cleaned text directly.
        summary = cleaned[:max_chars].strip()
    # Ensure the summary is not longer than max_chars.
    return summary[:max_chars].strip()


def detect_article_type(url: str) -> str:
    """Classify the article as either 'Opinion' or 'News'.

    If the URL contains '/opinion/' (case insensitive) we assume
    the story is an opinion piece.  Otherwise it's considered a
    news article.

    Args:
        url: The article URL.

    Returns:
        Either ``'Opinion'`` or ``'News'``.
    """
    return "Opinion" if "/opinion/" in url.lower() else "News"


def sentiment_score(title: str, summary: str) -> float:
    """Compute a VADER sentiment score for the given title and summary.

    The sentiment value ranges between −1 (most negative) and +1 (most
    positive).  The VADER lexicon is oriented toward social media and
    short news headlines, making it a reasonable choice for this task.

    Args:
        title: Article title.
        summary: The auto‐generated summary.

    Returns:
        The compound sentiment score.
    """
    text = f"{title} {summary}".strip()
    score = _sentiment_analyzer.polarity_scores(text)
    return score.get("compound", 0.0)


def subjectivity_hint(text: str) -> str:
    """Produce a basic subjectivity hint based on lexical markers.

    This heuristic inspects the text for first person pronouns,
    modal verbs and evaluative adjectives.  It is deliberately
    simple and intended to provide a low/medium/high indication
    rather than an exact measure of subjectivity.

    Args:
        text: The text to analyse.

    Returns:
        One of ``'low'``, ``'medium'`` or ``'high'``.
    """
    first_person = re.compile(r"\b(I|we|me|us|my|our|mine|ours)\b", re.IGNORECASE)
    modal_verbs = re.compile(r"\b(should|would|could|must|might|may|ought)\b", re.IGNORECASE)
    evaluatives = re.compile(r"\b(important|significant|remarkable|terrible|wonderful|excellent|poor|good|bad)\b", re.IGNORECASE)
    score = 0
    score += len(first_person.findall(text))
    score += len(modal_verbs.findall(text))
    score += len(evaluatives.findall(text))
    if score == 0:
        return "low"
    elif score <= 2:
        return "medium"
    else:
        return "high"


@dataclass
class Bias:
    article_type: str
    sentiment: float
    subjectivity_hint: str

    def to_dict(self) -> Dict[str, object]:
        return {
            "article_type": self.article_type,
            "sentiment": round(self.sentiment, 3),
            "subjectivity_hint": self.subjectivity_hint,
        }


def compute_bias(url: str, title: str, summary: str) -> Bias:
    """Compute the bias heuristic for an article.

    Args:
        url: The article's URL.
        title: The headline.
        summary: Auto‐generated summary.

    Returns:
        A ``Bias`` dataclass containing article type, sentiment and
        subjectivity hint.
    """
    article_type = detect_article_type(url)
    sentiment = sentiment_score(title, summary)
    subj = subjectivity_hint(f"{title} {summary}")
    return Bias(article_type, sentiment, subj)