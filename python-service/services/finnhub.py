"""Finnhub data fetcher — implemented in DAV-24."""
import os
import finnhub


class FinnhubService:
    def __init__(self):
        api_key = os.getenv("FINNHUB_API_KEY", "")
        self.client = finnhub.Client(api_key=api_key)

    def get_quote(self, ticker: str) -> dict:
        raise NotImplementedError("Implemented in DAV-24")

    def get_company_profile(self, ticker: str) -> dict:
        raise NotImplementedError("Implemented in DAV-24")

    def get_news(self, ticker: str) -> list:
        raise NotImplementedError("Implemented in DAV-24")
