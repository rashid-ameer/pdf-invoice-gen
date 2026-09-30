/** Format state/province + country for invoice PDFs (international). */
export function formatRegionCountry(
  region?: string | null,
  country?: string | null,
): string {
  const parts = [region, country].map((p) => (p ?? "").trim()).filter(Boolean);
  return parts.join(", ");
}

export function countryLabel(code?: string | null): string {
  const raw = (code ?? "").trim();
  if (!raw) return "";
  if (raw.length === 2) {
    try {
      const name = new Intl.DisplayNames(["en"], { type: "region" }).of(
        raw.toUpperCase(),
      );
      if (name) return name;
    } catch {
      /* ignore */
    }
  }
  return raw;
}

export function formatRegionCountryDisplay(
  region?: string | null,
  country?: string | null,
): string {
  return formatRegionCountry(region, countryLabel(country));
}
