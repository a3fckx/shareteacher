/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Adapters that touch native/node-only SDKs stay server-side.
  serverExternalPackages: ["postgres"],
  env: {
    NEXT_PUBLIC_APP_NAME: "ShareTeacher",
  },
};

export default nextConfig;
