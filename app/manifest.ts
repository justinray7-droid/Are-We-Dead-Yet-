import type { MetadataRoute } from "next";

// GitHub Pages serves the app under /<repo-name>; paths here must include it.
const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const dynamic = "force-static";

// Web app manifest: name, icons and full-screen display when installed.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "2031 AI Wager",
    short_name: "AI Wager",
    description: "Alex, Justin and Shaun's five-year bet on autonomous AI research.",
    id: `${base}/`,
    start_url: `${base}/`,
    scope: `${base}/`,
    display: "standalone",
    orientation: "portrait",
    background_color: "#0c0a09",
    theme_color: "#0c0a09",
    icons: [
      { src: `${base}/icons/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `${base}/icons/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `${base}/icons/maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
