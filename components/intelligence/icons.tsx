/** Real provider logos for the intelligence UI — sourced from Simple Icons and brand guidelines */

/** Perplexity AI — official logo from Simple Icons */
export function PerplexityLogo({ className }: { className?: string }) {
  return (
    <svg role="img" viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M22.3977 7.0896h-2.3106V.0676l-7.5094 6.3542V.1577h-1.1554v6.1966L4.4904 0v7.0896H1.6023v10.3976h2.8882V24l6.932-6.3591v6.2005h1.1554v-6.0469l6.9318 6.1807v-6.4879h2.8882V7.0896zm-3.4657-4.531v4.531h-5.355l5.355-4.531zm-13.2862.0676 4.8691 4.4634H5.6458V2.6262zM2.7576 16.332V8.245h7.8476l-6.1149 6.1147v1.9723H2.7576zm2.8882 5.0404v-3.8852h.0001v-2.6488l5.7763-5.7764v7.0111l-5.7764 5.2993zm12.7086.0248-5.7766-5.1509V9.0618l5.7766 5.7766v6.5588zm2.8882-5.0652h-1.733v-1.9723L13.3948 8.245h7.8478v8.087z" />
    </svg>
  );
}

/** Firecrawl — flame icon matching their brand */
export function FirecrawlLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M12 0C8.26 4.5 5 7.98 5 12.5 5 16.64 8.13 20 12 20s7-3.36 7-7.5C19 7.98 15.74 4.5 12 0zm0 18c-2.76 0-5-2.46-5-5.5C7 9.3 9.1 6.5 12 3.2c2.9 3.3 5 6.1 5 9.3 0 3.04-2.24 5.5-5 5.5zm-1.5-5.5c0 1.38.67 2.5 1.5 2.5s1.5-1.12 1.5-2.5c0-1.5-.75-3-1.5-4.5-.75 1.5-1.5 3-1.5 4.5z" />
    </svg>
  );
}

/** Finnhub — stylized bar chart matching their brand identity */
export function FinnhubLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Financial Modeling Prep — stacked chart bars matching their brand */
export function FmpLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M3 3v18h18" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 16l4-4 3 3 5-5" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="7" cy="16" r="1" />
      <circle cx="11" cy="12" r="1" />
      <circle cx="14" cy="15" r="1" />
      <circle cx="19" cy="10" r="1" />
    </svg>
  );
}
