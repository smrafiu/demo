/** Map free-text Indian cities to official state names (india-maps-data st_nm). */
const CITY_TO_STATE: Array<{ match: RegExp; state: string }> = [
  { match: /\b(delhi|new delhi|ncr)\b/i, state: "Delhi" },
  { match: /\b(gurugram|gurgaon)\b/i, state: "Haryana" },
  { match: /\b(noida|greater noida|lucknow|kanpur|varanasi)\b/i, state: "Uttar Pradesh" },
  { match: /\b(bengaluru|bangalore|mysuru|mysore)\b/i, state: "Karnataka" },
  { match: /\b(mumbai|pune|nagpur|nashik|thane)\b/i, state: "Maharashtra" },
  { match: /\b(hyderabad|secunderabad)\b/i, state: "Telangana" },
  { match: /\b(chennai|coimbatore|madurai)\b/i, state: "Tamil Nadu" },
  { match: /\b(kolkata|howrah)\b/i, state: "West Bengal" },
  { match: /\b(jaipur|udaipur)\b/i, state: "Rajasthan" },
  { match: /\b(ahmedabad|surat|vadodara)\b/i, state: "Gujarat" },
  { match: /\b(chandigarh|mohali)\b/i, state: "Chandigarh" },
  { match: /\b(kochi|trivandrum|thiruvananthapuram)\b/i, state: "Kerala" },
  { match: /\b(indore|bhopal)\b/i, state: "Madhya Pradesh" },
  { match: /\b(bhubaneswar)\b/i, state: "Odisha" },
  { match: /\b(patna)\b/i, state: "Bihar" },
  { match: /\b(goa|panaji)\b/i, state: "Goa" },
];

const COUNTRY_NAMES: Record<string, string> = {
  IN: "India",
  US: "United States of America",
  USA: "United States of America",
  CA: "Canada",
  DE: "Germany",
  GB: "United Kingdom",
  UK: "United Kingdom",
  SG: "Singapore",
  JP: "Japan",
  AU: "Australia",
  AE: "United Arab Emirates",
};

/** world-atlas@2 numeric ids (ISO 3166-1 numeric as string). */
export const COUNTRY_ISO2_TO_NUMERIC: Record<string, string> = {
  IN: "356",
  US: "840",
  CA: "124",
  DE: "276",
  GB: "826",
  SG: "702",
  JP: "392",
  AU: "036",
  AE: "784",
  FR: "250",
  NL: "528",
};

export function normalizeCountryCode(raw?: string | null): string {
  if (!raw) return "UNK";
  const t = raw.trim().toUpperCase();
  if (t === "INDIA") return "IN";
  if (t === "USA" || t === "UNITED STATES" || t === "UNITED STATES OF AMERICA") return "US";
  if (t === "UK" || t === "UNITED KINGDOM") return "GB";
  if (t === "GERMANY") return "DE";
  if (t === "CANADA") return "CA";
  if (t === "SINGAPORE") return "SG";
  if (t === "JAPAN") return "JP";
  if (t.length === 2) return t;
  return t.slice(0, 3);
}

export function countryDisplayName(code: string): string {
  return COUNTRY_NAMES[code] || code;
}

export function resolveIndiaState(city?: string | null, location?: string | null): string | null {
  const text = `${city || ""} ${location || ""}`.trim();
  if (!text) return null;
  for (const row of CITY_TO_STATE) {
    if (row.match.test(text)) return row.state;
  }
  return null;
}

export function bump(map: Map<string, number>, key: string, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

export function mapToSortedRows(
  map: Map<string, number>,
  nameFn: (key: string) => string = (k) => k,
): Array<{ code: string; name: string; value: number }> {
  return Array.from(map.entries())
    .map(([code, value]) => ({ code, name: nameFn(code), value }))
    .sort((a, b) => b.value - a.value);
}
