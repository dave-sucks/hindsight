import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // The guide's markdown is read from disk by the /docs pages (lib/docs/guide.ts), and every
  // agent's instructions from lib/agent/engine/agents/*.md (lib/agent/engine/instructions.ts), and each
  // situation's skill from lib/agent/engine/skills/*.md (lib/agent/situation-skills.ts).
  outputFileTracingIncludes: {
    "/**/*": ["./lib/agent/engine/agents/*.md", "./lib/agent/engine/skills/*.md"],
    "/": ["./lib/agent/engine/agents/*.md", "./lib/agent/engine/skills/*.md"],
    "/docs": ["./docs/guide/**/*.md"],
    "/docs/[slug]": ["./docs/guide/**/*.md"],
    "/how-it-works": ["./docs/guide/**/*.md"],
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
