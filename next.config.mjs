/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    "/api/board/requests/*/rounds/*/minutes": ["./src/assets/fonts/board-minutes/**/*"],
  },
  async headers() {
    return ["/bid/:path*", "/vendor-unsubscribe/:path*", "/sign-in/:path*", "/get-started/:path*"].map(source => ({
      source,
      headers: [
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Cache-Control", value: "private, no-store" },
        { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
      ],
    }));
  },
};

export default nextConfig;
