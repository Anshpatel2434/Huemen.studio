import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No floating dev badge over the UI (keeps local screenshots clean).
  devIndicators: false,
};

export default nextConfig;
