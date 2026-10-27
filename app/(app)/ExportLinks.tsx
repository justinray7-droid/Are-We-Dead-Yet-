"use client";

import { useState } from "react";
import { buildExport, EXPORT_FILES, type ExportFile } from "@/lib/data/exportData.ts";

/**
 * One-tap exports, built on the device. On iPhone they open the share sheet
 * (Save to Files, AirDrop, Mail); elsewhere they download.
 */
export function ExportLinks({ as = "inline" }: { as?: "inline" | "menu" }) {
  const [busy, setBusy] = useState<ExportFile | null>(null);
  const [error, setError] = useState("");

  async function run(file: ExportFile) {
    setBusy(file);
    setError("");
    try {
      const { name, type, body } = await buildExport(file);
      const blob = new File([body], name, { type });
      if (navigator.canShare?.({ files: [blob] })) {
        await navigator.share({ files: [blob] }).catch((e: Error) => {
          if (e.name !== "AbortError") throw e;
        });
      } else {
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement("a"), { href: url, download: name });
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const buttons = (Object.entries(EXPORT_FILES) as [ExportFile, string][]).map(([file, label]) => (
    <button key={file} type="button" className="linkish" disabled={busy !== null} onClick={() => run(file)}>
      {busy === file ? "Preparing…" : label}
    </button>
  ));
  return (
    <>
      {as === "menu" ? (
        <ul className="menu card">
          {buttons.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      ) : (
        <span className="row small">Export: {buttons}</span>
      )}
      {error && <p className="error">{error}</p>}
    </>
  );
}
