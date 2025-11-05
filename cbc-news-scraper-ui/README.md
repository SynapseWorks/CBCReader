# CBC News Scraper & Reader

This project scrapes CBC’s public RSS feeds and publishes a lightweight
web application that allows you to browse headlines by section, read
auto‑summaries, and inspect a simple bias heuristic.  The site is
designed to run as a [GitHub Pages](https://pages.github.com) site
hosted from the `/docs` directory, while the scraper runs in a
scheduled GitHub Action and writes a JSON file to `data/latest.json`.

## Features

* **Per‑section feeds** – The scraper consumes the official CBC
  headline feeds for the following sections: Top Stories, Canada,
  World, Business, Technology & Science, Health, Entertainment and
  Opinion.
* **24‑hour window & caps** – Entertainment and Opinion keep only
  the top 5 items in the last 24 hours; all other sections keep
  up to 50 items.
* **Automatic summaries** – Each article summary is condensed to
  roughly 500 characters, derived from the RSS feed’s summary or
  optionally extracted from the page (disabled by default).
* **Bias heuristic (mode B)** – For every article the scraper
  classifies the piece as “Opinion” or “News” based on its URL,
  computes a VADER sentiment score and derives a simple subjectivity
  hint using lexical markers.  These values are exposed on the
  front‑end as small chips.
* **Accessible UI** – The interface provides section filtering,
  keyword search and an “Opinion only” toggle.  It respects the
  system’s dark‑mode preference and uses a muted solarpunk palette
  consistent with the Root & Render brand.
* **Schedule‑aware** – The action triggers every two hours but
  the scraper only runs at 08:00, 14:00 and 20:00 in the
  `America/Toronto` timezone.  This avoids unnecessary network
  traffic and handles daylight saving time transparently.

## Getting Started

### Prerequisites

You’ll need Python 3.11 or newer and a clone of this repository.  To
install the dependencies:

```bash
pip install -r scraper/requirements.txt
```

### Running the scraper locally

From the project root run:

```bash
python scraper/main.py
```

The script writes the latest articles to `data/latest.json`.  If you
want to override the default run schedule (e.g. for testing), simply
comment out the `allowed_hours` entry in `scraper/config.yml` or
invoke `python scraper/main.py` at one of the permitted hours.

### Running the front‑end locally

Open `docs/index.html` in your browser.  The page loads
`../data/latest.json` relative to the `docs` directory, so you need to
run the scraper first.

### Deployment

The repository is configured to publish the contents of the `docs`
directory via GitHub Pages.  The `.github/workflows/scrape.yml` file
defines a workflow that runs every two hours, installs Python,
executes the scraper, and commits any changes to `data/latest.json`.
If you fork this repository you’ll need to enable GitHub Pages on
your own fork and grant the workflow permission to push changes.

## Configuration

The scraper’s behaviour is controlled by `scraper/config.yml`.  Key
values include:

* `timezone` – The IANA timezone name used for date parsing and
  scheduling (default: `America/Toronto`).
* `rate_limit_seconds` – Minimum delay between successive feed
  requests.  CBC’s terms of service ask clients to avoid rapid
  polling; a one second delay is conservative.
* `window_hours` – The age threshold for articles to include.
* `allowed_hours` – List of hours (0–23) when the scraper may
  run.  Empty or missing means the scraper runs whenever it’s
  invoked.
* `sections` – A mapping of keys to feed definitions.  Each
  definition contains a human‑readable `name`, the RSS `url` and
  a `max_items` cap.  You can add or remove sections here; be
  mindful that duplicate stories across sections will be deduplicated.
* `allow_extract` – When set to `true` the scraper will attempt to
  fetch the full article page with `readability-lxml` if no summary
  exists in the feed.  This increases load on CBC’s servers and
  should be used sparingly.

## Compliance & Ethics

This project is designed to respect CBC’s terms of service:

* **Use official RSS feeds** – All URLs come from CBC’s published
  RSS endpoints.  See the configuration for the exact feed URLs
  used.
* **Rate limiting** – The scraper waits at least one second
  between feed requests.  Combined with the three‑times‑daily
  schedule, this results in fewer than 50 requests per day.
* **Robots.txt respect** – The script does not crawl article pages
  unless `allow_extract` is enabled.  Even then it uses a
  polite user agent and honours HTTP error codes.

## Bias Heuristic Explained

The bias values reported by the scraper are illustrative and not
definitive measurements of objectivity.  They are calculated as
follows:

1. **Article type** – If the URL contains “/opinion/” (case
   insensitive) the article is labelled as *Opinion*; otherwise it
   is labelled as *News*.
2. **Sentiment** – The [VADER](https://github.com/cjhutto/vaderSentiment)
   analyser computes a sentiment score from −1 (negative) to +1
   (positive) based on the article title and summary.
3. **Subjectivity hint** – A simple lexical heuristic counts
   first‑person pronouns, modal verbs and evaluative adjectives in
   the combined title and summary.  Zero occurrences yields
   *low*, one or two yields *medium*, and more yields *high*.

These metrics are meant to help you explore patterns in the data, not
to assign labels of trustworthiness or bias.

## Accessibility & UX

The front‑end is built with vanilla HTML, CSS and JavaScript.  It
features semantic elements, form controls with labels, keyboard
navigation and dark‑mode support.  The colour palette uses muted
greens and earth tones inspired by solarpunk aesthetics associated
with the Root & Render brand.

## License

This project is licensed under the MIT License; see the `LICENSE`
file for details.