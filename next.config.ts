import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // The guide's markdown is read from disk by the /docs pages (lib/docs/guide.ts).
  outputFileTracingIncludes: {
    "/docs": ["./docs/guide/**/*.md"],
    "/docs/[slug]": ["./docs/guide/**/*.md"],
    "/how-it-works": ["./docs/guide/**/*.md"],
  },
  // /settings has no page of its own. Redirecting here, before render, keeps
  // a navigation that also swaps the whole shell (main app -> settings) from
  // hitting redirect() mid-render, which left the previous page's table
  // painted under the settings page (seen 3x, 2026-10).
  async redirects() {
    return [{ source: "/settings", destination: "/settings/profile", permanent: false }];
  },
  images: {
    remotePatterns: [
      { hostname: "www.google.com" },          // Google Favicons S2
      { hostname: "static2.finnhub.io" },      // Finnhub logo
      { hostname: "www.redditstatic.com" },     // Reddit icon
    ],
  },
};

export default nextConfig;
