import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keeps the dev indicator off the sidebar's profile button (design/README.md).
  devIndicators: { position: "bottom-right" },
  async redirects() {
    return [
      // Connections was renamed Integrations in the redesign; old links (and query strings,
      // such as the Gmail callback's ?connected=gmail) carry over.
      { source: "/workspace/connections", destination: "/workspace/integrations", permanent: true },
    ];
  },
};

export default nextConfig;
