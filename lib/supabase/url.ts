// Accepts the project URL however it was copied from Supabase: with or without
// a trailing slash or the /rest/v1 API path (supabase-js adds that itself).
export function projectUrl(raw: string | undefined): string {
  return (raw ?? "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/rest\/v1$/, "");
}
