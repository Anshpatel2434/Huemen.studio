import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No floating dev badge over the UI (keeps local screenshots clean).
  devIndicators: false,
  // Dev only: lets several local browser sessions run side by side on
  // <name>.localhost hosts (each keeps its own sign-in cookie).
  allowedDevOrigins: ["*.localhost"],
  // No other site may put the app in a frame (clickjacking), and browsers
  // must not guess file types. /api/storage sets its own stricter headers.
  async headers() {
    return [{
      source: "/((?!api/storage).*)",
      headers: [
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      ],
    }];
  },
};

export default nextConfig;
