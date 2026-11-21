import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keeps the dev indicator off the sidebar's profile button (design/README.md).
  devIndicators: { position: "bottom-right" },
};

export default nextConfig;
