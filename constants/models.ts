/**
 * Kurisu's brain: Gemini 3.5 Flash-Lite, Google's fastest stable model. It supports Google Search
 * grounding, and with minimal thinking it answers quickly enough for a live voice call.
 */
export const BRAIN_MODEL = {
  id: 'gemini-3.5-flash-lite',
  name: 'Gemini 3.5 Flash-Lite',
  tagline: 'GOOGLE GEMINI · CLOUD · GOOGLE SEARCH GROUNDING',
  /** Lowest-latency thinking level this model supports. */
  thinkingLevel: 'MINIMAL',
  /** Where users create a free API key. */
  keyUrl: 'https://aistudio.google.com/apikey',
} as const;

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.round(bytes / 1e3)} KB`;
}
