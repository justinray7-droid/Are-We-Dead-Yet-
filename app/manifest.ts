import type { MetadataRoute } from "next";

// Web app manifest: name, icons and full-screen display when installed.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "2031 AI Wager",
    short_name: "AI Wager",
    description: "Alex, Justin and Shaun's five-year bet on autonomous AI research.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0c0a09",
    theme_color: "#0c0a09",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
