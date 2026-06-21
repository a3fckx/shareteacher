if (typeof globalThis !== "undefined" && globalThis.localStorage && !globalThis.localStorage.getItem) {
  try {
    delete globalThis.localStorage;
  } catch (e) {
    // ignore
  }
}

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

