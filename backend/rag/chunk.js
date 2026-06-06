// Split plain text into overlapping chunks suitable for embedding
export function chunkText(text, maxChars = 400, overlap = 60) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const chunks = [];
  let start = 0;
  // Guard against overlap >= maxChars, which would make the stride <= 0 and loop
  // forever. Always advance at least one character.
  const step = Math.max(1, maxChars - overlap);

  while (start < cleaned.length) {
    const end = Math.min(start + maxChars, cleaned.length);
    const chunk = cleaned.slice(start, end).trim();
    if (chunk.length > 30) chunks.push(chunk);
    if (end >= cleaned.length) break;
    start += step;
  }

  return chunks;
}
