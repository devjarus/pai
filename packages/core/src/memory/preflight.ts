/**
 * Memory preflight heuristic — determines if a user message likely needs
 * memory context injected into the system prompt.
 *
 * Split into two categories:
 * - EXPLICIT: direct memory requests (always trigger)
 * - PERSONAL_SUBJECT: "tell me about" / "who is" only trigger when
 *   followed by a personal subject (me, a proper name, owner-related words)
 */

/** Always trigger — user is explicitly asking about memory or personal preferences. */
const EXPLICIT_MEMORY_PATTERNS = [
  /\b(what do you (know|remember))\b/i,
  /\b(my|our) (preference|favorite|decision|choice)\b/i,
  /\bmy favorite\b/i,
  /\b(do you (remember|recall)|have (we|you) (discussed|talked))\b/i,
  /\b(check (your )?memory|recall|look up)\b/i,
];

/**
 * Personal subject words — names and self-references that indicate the user
 * is asking about a person known to the system, not a generic topic.
 */
const PERSONAL_SUBJECT = /\b(me|myself|my\b|suraj|monica|owner)\b/i;

/** Trigger only when combined with a personal subject. */
const PERSONAL_SUBJECT_PATTERNS = [
  { pattern: /\btell me about\s+(.+)/i, groupIndex: 1 },
  { pattern: /\bwho is\s+(.+)/i, groupIndex: 1 },
  { pattern: /\bwho's\s+(.+)/i, groupIndex: 1 },
  { pattern: /\babout\s+(\w+)\s*\?$/i, groupIndex: 1 },
  // "what does X like/prefer/want/need/do"
  { pattern: /\bwhat does\s+(\w+)\s+(like|prefer|want|need|do|enjoy|use|think|eat|drink|love|hate)\b/i, groupIndex: 1 },
  // "does X like/prefer/want"
  { pattern: /\bdoes\s+(\w+)\s+(like|prefer|want|need|enjoy|use|love|hate)\b/i, groupIndex: 1 },
  // "what is X's favorite/preference"
  { pattern: /\bwhat(?:'s| is)\s+(\w+)(?:'s|s)?\s+(favorite|preference|name)\b/i, groupIndex: 1 },
  // "how does X feel about / how is X"
  { pattern: /\bhow (?:does|is)\s+(\w+)\b/i, groupIndex: 1 },
];

export function needsMemoryPreflight(message: string): boolean {
  // Check explicit patterns first
  if (EXPLICIT_MEMORY_PATTERNS.some((p) => p.test(message))) {
    return true;
  }

  // Check personal-subject patterns: extract the subject and test it
  for (const { pattern, groupIndex } of PERSONAL_SUBJECT_PATTERNS) {
    const match = pattern.exec(message);
    if (match) {
      const subject = match[groupIndex]?.trim();
      if (subject && PERSONAL_SUBJECT.test(subject)) {
        return true;
      }
      // Also trigger for proper names (capitalized words that aren't common words)
      if (subject && /^[A-Z]/.test(subject) && !isCommonWord(subject)) {
        return true;
      }
    }
  }

  return false;
}

/** Common words that start with a capital letter but are not personal names. */
const COMMON_WORDS = new Set([
  "the", "this", "that", "these", "those", "docker", "typescript",
  "javascript", "react", "python", "rust", "go", "java", "sql",
  "linux", "windows", "macos", "github", "google", "amazon",
  "time", "i", "it", "if",
]);

function isCommonWord(word: string): boolean {
  const first = word.split(/\s/)[0]!.toLowerCase();
  return COMMON_WORDS.has(first);
}
