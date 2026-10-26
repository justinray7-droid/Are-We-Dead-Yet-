"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

type Tab = { href: string; label: string; icon: keyof typeof ICONS; badge?: number };

// 24px stroke icons, drawn in currentColor.
const ICONS = {
  home: "M3 11.5 12 4l9 7.5M5.5 9.5V20h13V9.5",
  list: "M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01",
  inbox: "M4 13h4l1.5 3h5l1.5-3h4M4 13l2.5-8h11L20 13v6H4z",
  plus: "M12 5v14M5 12h14",
  scale: "M12 4v16M7 20h10M4 8h16M4 8l-2.5 6a3 3 0 0 0 5 0zM20 8l-2.5 6a3 3 0 0 0 5 0z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
} as const;

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={name === "more" ? 3.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d={ICONS[name]} />
    </svg>
  );
}

/** Bottom tab bar, shown on phones (CSS hides it on wide screens). */
export function TabBar({ isArbiter, pending }: { isArbiter: boolean; pending: number }) {
  const path = usePathname();
  const tabs: Tab[] = [
    { href: "/", label: "Home", icon: "home" },
    { href: "/evidence", label: "Evidence", icon: "list" },
    { href: "/queue", label: isArbiter ? "Review" : "Pending", icon: "inbox", badge: pending },
    isArbiter ? { href: "/rules", label: "Rules", icon: "scale" } : { href: "/evidence/new", label: "Submit", icon: "plus" },
    { href: "/more", label: "More", icon: "more" },
  ];
  // The most specific tab whose path prefixes the current page is active.
  const active = tabs
    .filter((t) => (t.href === "/" ? path === "/" : path === t.href || path.startsWith(t.href + "/")))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const moreActive = ["/rules", "/audit", "/resolution", "/more"].some((p) => path.startsWith(p)) && active !== "/rules";

  return (
    <nav className="tabbar" aria-label="Main">
      {tabs.map((t) => {
        const on = t.href === "/more" ? moreActive : t.href === active;
        return (
          <Link key={t.href} href={t.href} className={on ? "on" : undefined} aria-current={on ? "page" : undefined}>
            <span className="tab-icon">
              <Icon name={t.icon} />
              {t.badge ? <span className="count">{t.badge}</span> : null}
            </span>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * A Home Screen app has no reload button or pull-to-refresh, so fetch fresh
 * data whenever it comes back to the foreground.
 */
export function RefreshOnFocus() {
  const router = useRouter();
  useEffect(() => {
    let hiddenAt = 0;
    const onChange = () => {
      if (document.visibilityState === "hidden") hiddenAt = Date.now();
      else if (Date.now() - hiddenAt > 5_000) router.refresh();
    };
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, [router]);
  return null;
}
