export const km = (m: number) => `${(m / 1000).toFixed(2)} km`;
export const metres = (m: number | null) => (m === null ? "—" : `${m.toLocaleString()} m`);

export function duration(seconds: number | null): string {
  if (seconds === null) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function shortDate(iso: string | null): string {
  if (!iso) return "Undated";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
