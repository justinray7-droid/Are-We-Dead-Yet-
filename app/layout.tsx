import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "2031 AI Wager",
  applicationName: "AI Wager",
  description: "Alex, Justin and Shaun's five-year bet on autonomous AI research.",
  robots: { index: false, follow: false },
  // Added to the iPhone Home Screen it opens full screen, named "AI Wager".
  appleWebApp: { capable: true, title: "AI Wager", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false, email: false, address: false, date: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Draw under the notch and home indicator; CSS pads with the safe-area insets.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf9" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0a09" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
