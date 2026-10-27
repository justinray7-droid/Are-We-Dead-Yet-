import Link from "next/link";

export function NotFound() {
  return (
    <main>
      <h1>Not found</h1>
      <p className="muted">
        That evidence item doesn&apos;t exist. <Link href="/evidence/">Back to the evidence log</Link>
      </p>
    </main>
  );
}
