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
