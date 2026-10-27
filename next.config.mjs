/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Plain static files for GitHub Pages: no server. Phones talk to Supabase directly.
  output: "export",
  trailingSlash: true,
  // GitHub Pages serves a project site under /<repo-name>; the deploy workflow sets this.
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
  images: { unoptimized: true },
};

export default nextConfig;
