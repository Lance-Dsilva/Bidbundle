/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    "/api/hoa/communities/*/revenue-share/statements/*": ["./src/assets/fonts/board-minutes/**/*"],
    "/api/admin/communities/*/revenue-share/statements/*": ["./src/assets/fonts/board-minutes/**/*"],
  },
};

export default nextConfig;
