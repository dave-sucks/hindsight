"""SEC EDGAR filings fetcher — free, no API key required.

Fetches recent SEC filings (10-K, 10-Q, 8-K, etc.) for a given ticker.
Uses the public EDGAR full-text search and company filings APIs.
"""
import logging
from datetime import date, timedelta

import httpx

logger = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": "Hindsight Research Bot research@hindsight.app",
    "Accept": "application/json",
}
_TIMEOUT = 10.0

# Filing types we care about for trading research
_RELEVANT_TYPES = {"10-K", "10-Q", "8-K", "S-1", "DEF 14A", "13F-HR", "4"}


async def get_recent_filings(ticker: str, limit: int = 10) -> list[dict]:
    """Fetch recent SEC filings for a ticker from EDGAR.

    Returns list of {type, date, description, url} dicts.
    """
    try:
        # Step 1: Look up CIK from ticker
        async with httpx.AsyncClient() as client:
            tickers_resp = await client.get(
                "https://www.sec.gov/files/company_tickers.json",
                headers=_HEADERS,
                timeout=_TIMEOUT,
            )
            tickers_resp.raise_for_status()
            tickers_data = tickers_resp.json()

            cik = None
            for entry in tickers_data.values():
                if entry.get("ticker", "").upper() == ticker.upper():
                    cik = str(entry["cik_str"]).zfill(10)
                    break

            if not cik:
                logger.debug("SEC: No CIK found for %s", ticker)
                return []

            # Step 2: Fetch recent filings
            filings_url = f"https://data.sec.gov/submissions/CIK{cik}.json"
            filings_resp = await client.get(
                filings_url,
                headers=_HEADERS,
                timeout=_TIMEOUT,
            )
            filings_resp.raise_for_status()
            filings_data = filings_resp.json()

            recent = filings_data.get("filings", {}).get("recent", {})
            forms = recent.get("form", [])
            dates = recent.get("filingDate", [])
            descriptions = recent.get("primaryDocDescription", [])
            accession_numbers = recent.get("accessionNumber", [])
            primary_docs = recent.get("primaryDocument", [])

            results = []
            for i in range(min(len(forms), 50)):
                form_type = forms[i]
                if form_type not in _RELEVANT_TYPES:
                    continue

                accession = accession_numbers[i].replace("-", "")
                doc = primary_docs[i] if i < len(primary_docs) else ""
                url = f"https://www.sec.gov/Archives/edgar/data/{cik.lstrip('0')}/{accession}/{doc}" if doc else None

                results.append({
                    "type": form_type,
                    "date": dates[i] if i < len(dates) else "",
                    "description": descriptions[i] if i < len(descriptions) else form_type,
                    "url": url,
                })

                if len(results) >= limit:
                    break

            logger.debug("SEC: Found %d filings for %s", len(results), ticker)
            return results

    except Exception as exc:
        logger.warning("SEC filings fetch failed for %s: %s", ticker, exc)
        return []


async def get_insider_filings(ticker: str) -> list[dict]:
    """Fetch recent Form 4 (insider transaction) filings from EDGAR.

    Returns list of {filer, date, url} dicts for the most recent insider filings.
    """
    try:
        async with httpx.AsyncClient() as client:
            # EDGAR full-text search for Form 4
            resp = await client.get(
                "https://efts.sec.gov/LATEST/search-index",
                params={
                    "q": f'"{ticker}"',
                    "dateRange": "custom",
                    "startdt": (date.today() - timedelta(days=30)).isoformat(),
                    "enddt": date.today().isoformat(),
                    "forms": "4",
                },
                headers=_HEADERS,
                timeout=_TIMEOUT,
            )
            if resp.status_code != 200:
                return []

            data = resp.json()
            hits = data.get("hits", {}).get("hits", [])

            results = []
            for hit in hits[:5]:
                source = hit.get("_source", {})
                results.append({
                    "filer": source.get("display_names", ["Unknown"])[0],
                    "date": source.get("file_date", ""),
                    "url": f"https://www.sec.gov/Archives/edgar/data/{source.get('entity_id', '')}/{source.get('file_num', '')}",
                })

            return results
    except Exception as exc:
        logger.debug("SEC insider filings failed for %s: %s", ticker, exc)
        return []
