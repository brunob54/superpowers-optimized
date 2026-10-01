#!/usr/bin/env node
/**
 * UserPromptSubmit Hook — Proactive Skill Activation + Memory Recall
 *
 * Analyzes the user's prompt before Claude processes it and injects
 * two types of context:
 *
 * 1. Skill hints — which superpowers-orchestrator skills are relevant to
 *    this prompt (reinforces using-superpowers routing deterministically).
 *
 * 2. Memory recall — relevant past decisions from session-log.md that
 *    match keywords extracted from the prompt. Surfaces historical context
 *    automatically at the moment it's needed, without requiring the AI to
 *    remember to grep the log manually.
 *
 * Features:
 * - Micro-task detection: short, specific prompts skip both features entirely
 * - Agent messages (task notifications, messages from other sessions) skip
 *   both features entirely: the user did not type them
 * - Confidence threshold: only suggests skills when match confidence is meaningful
 * - Memory recall: keyword-based grep of session-log.md, ≤2 entries; an entry
 *   already injected in the same session is not injected again
 * - Smart routing: fewer false positives, zero overhead for simple tasks
 *
 * Input:  stdin JSON with { prompt, session_id, cwd, ... }
 * Output: stdout JSON with additionalContext suggesting relevant skills
 *         and/or surfacing relevant past decisions
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Resolve hooks directory from this script's location
const HOOKS_DIR = __dirname;

// Load skill rules
let RULES = [];
try {
  const rulesPath = path.join(HOOKS_DIR, 'skill-rules.json');
  RULES = JSON.parse(fs.readFileSync(rulesPath, 'utf8')).rules || [];
} catch (e) {
  // If rules can't be loaded, hook is a no-op
  process.stdout.write('{}');
  process.exit(0);
}

const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

// Minimum score threshold — matches below this are discarded as noise
const CONFIDENCE_THRESHOLD = 2;

// ── Memory recall constants ───────────────────────────────────────────────────
const MAX_MEMORY_ENTRIES = 2;    // Never inject more than 2 matched entries
const MIN_KEYWORD_LENGTH = 4;   // Skip tokens shorter than this
const MAX_ENTRY_CHARS = 1500;   // Truncate oversized entries (~250 words / ~375 tokens)

// ── Messages the user did not type ────────────────────────────────────────────
// Claude Code runs UserPromptSubmit for task notifications and for messages
// from other agents too, and its documented payload has no field that names
// the sender (measured: its seven keys are session_id, transcript_path, cwd,
// prompt_id, permission_mode, hook_event_name and prompt). The opening of the
// prompt text is the only signal.
//
// The hook input is NOT the text of the transcript. Claude Code writes the
// line "Another Claude session sent a message:" into the transcript record
// only. Each opening below states how it was measured (2026-10-01):
const AGENT_MESSAGE_OPENINGS = [
  // Hook input logged by a probe hook (Claude Code 2.1.286).
  '<task-notification>',
  // Hook input logged by a probe hook: a message that a named subagent sent.
  '<agent-message',
  // Not measured as hook input. Transcripts store a teammate message in this
  // tag, as they store an agent message in the tag above.
  '<teammate-message',
  // The report that a subagent hands back reaches the hook as its body alone.
  // Replay of one orchestrated run (Claude Code 2.1.278): of 42 recorded hook
  // outputs, 18 are reproduced by this form only, and none by another form only.
  '[Subagent hand-back]',
  // The transcript form, without its colon: a second form reads "… sent a
  // message while you were working:". Kept as a defence; the replays found no
  // run of this release line in which the hook received it.
  'Another Claude session sent a message',
];

// The keys of the recall entries already injected in a session are kept in
// one file per session id in the temporary folder. Nothing resets the file at
// a compaction, so an entry shown before a compaction is not shown again in
// that session (an accepted limit: the SessionStart hook re-injects the last
// session-log entries after a compaction).
const RECALL_STATE_PREFIX = 'sp-recall-';

// Common English words that produce noisy false-positive matches
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'shall', 'can',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
  'into', 'through', 'during', 'before', 'after', 'this', 'that',
  'these', 'those', 'my', 'your', 'his', 'her', 'its', 'our', 'their',
  'what', 'which', 'who', 'when', 'where', 'why', 'how',
  'all', 'both', 'each', 'every', 'any', 'some', 'not', 'only',
  'than', 'too', 'very', 'just', 'now', 'also', 'but', 'and', 'or',
  'if', 'then', 'so', 'let', 'get', 'got', 'go', 'make', 'know',
  'think', 'see', 'look', 'use', 'using', 'used', 'like', 'want',
  'need', 'please', 'here', 'there', 'about', 'more', 'other', 'new',
  'good', 'right', 'well', 'really', 'actually', 'already', 'still',
  'even', 'back', 'thing', 'things', 'way', 'work', 'works', 'worked',
]);

/**
 * Detect micro-tasks that should skip skill routing entirely.
 * Returns true if the prompt is clearly a small, specific action.
 */
function isMicroTask(prompt) {
  if (!prompt || typeof prompt !== 'string') return false;

  const lower = prompt.toLowerCase().trim();
  const wordCount = lower.split(/\s+/).length;

  // Very short prompts with specific action words are likely micro-tasks
  if (wordCount <= 8) {
    const microPatterns = [
      /^(fix|change|rename|update|replace|set|remove|delete|add)\s+(the\s+)?(typo|name|variable|import|spacing|indent)/i,
      /^rename\s+\S+\s+to\s+\S+$/i,
      /^(change|update|set)\s+.+\s+(to|=)\s+.+$/i,
      /^remove\s+(the\s+)?(unused|extra|duplicate)\s+/i,
      /^add\s+(a\s+)?(missing\s+)?(import|comma|semicolon|bracket|paren)/i,
      /^fix\s+(the\s+)?(typo|spelling|whitespace|indent(ation)?)/i,
    ];

    if (microPatterns.some(p => p.test(lower))) {
      return true;
    }
  }

  // Single-line file reference with small action
  if (wordCount <= 12 && /line\s+\d+/i.test(lower) && /(fix|change|update|rename|remove)/i.test(lower)) {
    return true;
  }

  return false;
}

/**
 * Score a prompt against skill rules.
 * Returns matched rules sorted by priority, max 3.
 * Applies confidence threshold to filter weak matches.
 */
function matchSkills(prompt) {
  if (!prompt || typeof prompt !== 'string') return [];

  const lower = prompt.toLowerCase();
  const matches = [];

  for (const rule of RULES) {
    let score = 0;

    // Check keywords (case-insensitive, left-boundary aware)
    for (const kw of rule.keywords || []) {
      const kwLower = kw.toLowerCase();
      // Multi-word keywords: use substring match (boundary is implicit)
      // Single-word keywords: use left word boundary to avoid partial matches
      // (e.g. "fix" in "prefix") while still allowing inflected forms (e.g. "errors" for "error")
      if (kwLower.includes(' ')) {
        if (lower.includes(kwLower)) score += 1;
      } else {
        const re = new RegExp(`\\b${kwLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
        if (re.test(lower)) score += 1;
      }
    }

    // Check intent patterns (regex)
    for (const pattern of rule.intentPatterns || []) {
      try {
        const re = new RegExp(pattern, 'i');
        if (re.test(prompt)) {
          score += 2; // Intent patterns weighted higher
        }
      } catch {
        // Skip invalid regex
      }
    }

    // Apply confidence threshold — single keyword matches are noise
    if (score >= CONFIDENCE_THRESHOLD) {
      matches.push({
        skill: rule.skill,
        priority: rule.priority,
        type: rule.type,
        score,
      });
    }
  }

  // Sort by priority (critical first), then by score (highest first)
  matches.sort((a, b) => {
    const pDiff = (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99);
    if (pDiff !== 0) return pDiff;
    return b.score - a.score;
  });

  return matches.slice(0, 3);
}

/**
 * Build the context injection message for matched skills.
 */
function buildContext(matches) {
  if (matches.length === 0) return null;

  const skillList = matches
    .map(m => `  - superpowers-orchestrator:${m.skill} (${m.priority})`)
    .join('\n');

  return [
    '<user-prompt-submit-hook>',
    'Skill activation hint: The following skills are relevant to this prompt.',
    'Remember: invoke superpowers-orchestrator:using-superpowers FIRST as the mandatory entry point,',
    'then follow its routing to these suggested skills:',
    skillList,
    'IMPORTANT: If the user names a skill directly (e.g. "use brainstorming"), invoke it via the Skill tool.',
    'Do NOT re-implement the skill\'s purpose with ad-hoc agents or manual steps.',
    '</user-prompt-submit-hook>',
  ].join('\n');
}

// ── Memory recall ─────────────────────────────────────────────────────────────

/**
 * Extract distinctive keywords from a prompt for session-log searching.
 * Strips stop words, punctuation (preserving hyphens), and short tokens.
 * Returns a deduplicated array of lowercase keyword strings.
 */
function extractKeywords(prompt) {
  if (!prompt || typeof prompt !== 'string') return [];

  const tokens = prompt
    .toLowerCase()
    // Remove punctuation except hyphens (preserves compound terms like "session-log")
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= MIN_KEYWORD_LENGTH && !STOP_WORDS.has(t));

  return [...new Set(tokens)];
}

/**
 * Search session-log.md for [saved] entries matching the given keywords.
 * Skips [superseded] entries. Returns up to MAX_MEMORY_ENTRIES matches,
 * most recent first. Each entry is trimmed to MAX_ENTRY_CHARS.
 *
 * A match requires at least 1 keyword hit in the entry text.
 * (Threshold is low because keywords are already filtered for distinctiveness.)
 */
function searchSessionLog(cwd, keywords) {
  if (!keywords || keywords.length === 0) return [];

  const logPath = path.join(cwd, 'session-log.md');
  let content;
  try {
    content = fs.readFileSync(logPath, 'utf8');
  } catch {
    return []; // File absent — silent no-op
  }

  // Parse file into individual [saved] entries (preserve order: oldest first)
  const entries = [];
  let current = null;

  for (const line of content.split('\n')) {
    if (/^## .+\[saved\]/.test(line)) {
      // Flush previous entry
      if (current !== null) entries.push(current.trim());
      // Skip superseded entries — they represent overturned decisions
      if (/\[superseded/.test(line)) {
        current = null;
      } else {
        current = line;
      }
    } else if (current !== null) {
      current += '\n' + line;
    }
  }
  // Flush last entry
  if (current !== null) entries.push(current.trim());

  if (entries.length === 0) return [];

  // Weighted scoring: keyword density (70%) + recency (30%)
  // Replaces flat boolean matching to reduce false positives and surface
  // the most relevant entries, not just the most recent ones.
  const scored = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const entryLower = entry.toLowerCase();
    const hits = keywords.filter(kw => entryLower.includes(kw)).length;
    if (hits === 0) continue;

    const densityScore = hits / keywords.length;
    const recencyScore = (i + 1) / entries.length;
    const score = (densityScore * 0.7) + (recencyScore * 0.3);
    scored.push({ entry, score });
  }

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, MAX_MEMORY_ENTRIES).map(s => {
    return s.entry.length > MAX_ENTRY_CHARS
      ? s.entry.slice(0, MAX_ENTRY_CHARS).trimEnd() + '\n*(entry truncated)*'
      : s.entry;
  });
}

/**
 * Format matched session-log entries for injection as additional context.
 */
function buildMemoryContext(entries) {
  if (!entries || entries.length === 0) return null;

  return [
    '<session-memory-recall>',
    'Relevant past decisions matching this prompt (from session-log.md):',
    '',
    entries.join('\n\n'),
    '',
    '*(Full history searchable in session-log.md)*',
    '</session-memory-recall>',
  ].join('\n');
}

// ── Known-issues recall ───────────────────────────────────────────────────────

/**
 * Search known-issues.md for open (non-fixed) entries matching the given keywords.
 * Fixed entries (## ~~...~~) are skipped. Returns up to MAX_MEMORY_ENTRIES matches,
 * most recent first. Each entry is trimmed to MAX_ENTRY_CHARS.
 */
function searchKnownIssues(cwd, keywords) {
  if (!keywords || keywords.length === 0) return [];

  const filePath = path.join(cwd, 'known-issues.md');
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return []; // File absent — silent no-op
  }

  // Parse into open entries (skip fixed entries with ## ~~ header)
  const entries = [];
  let current = null;

  for (const line of content.split('\n')) {
    if (line.startsWith('## ')) {
      if (current !== null) entries.push(current.trim());
      // Fixed entries have strikethrough: ## ~~...~~
      current = line.startsWith('## ~~') ? null : line;
    } else if (current !== null) {
      current += '\n' + line;
    }
  }
  if (current !== null) entries.push(current.trim());

  if (entries.length === 0) return [];

  // Weighted scoring: keyword density (70%) + recency (30%)
  const scored = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const entryLower = entry.toLowerCase();
    const hits = keywords.filter(kw => entryLower.includes(kw)).length;
    if (hits === 0) continue;

    const densityScore = hits / keywords.length;
    const recencyScore = (i + 1) / entries.length;
    const score = (densityScore * 0.7) + (recencyScore * 0.3);
    scored.push({ entry, score });
  }

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, MAX_MEMORY_ENTRIES).map(s => {
    return s.entry.length > MAX_ENTRY_CHARS
      ? s.entry.slice(0, MAX_ENTRY_CHARS).trimEnd() + '\n*(entry truncated)*'
      : s.entry;
  });
}

/**
 * Format matched known-issues entries for injection as additional context.
 */
function buildKnownIssuesContext(entries) {
  if (!entries || entries.length === 0) return null;

  return [
    '<known-issues-recall>',
    'Relevant known issues matching this prompt (from known-issues.md):',
    '',
    entries.join('\n\n'),
    '',
    '*(Full list in known-issues.md)*',
    '</known-issues-recall>',
  ].join('\n');
}

// ── Context pressure gate ─────────────────────────────────────────────────────

/**
 * Patterns that indicate the user is about to start plan execution
 * or heavy implementation work.
 */
const EXECUTION_TRIGGER_PATTERNS = [
  /\bexecute\s+(the\s+)?plan\b/i,
  /\bstart\s+build(ing)?\b/i,
  /\bstart\s+implement(ing|ation)?\b/i,
  /\bfollow\s+(the\s+)?plan\b/i,
  /\bimplement\s+(the\s+)?plan\b/i,
  /\blet'?s\s+(build|implement|execute)\b/i,
  /\brun\s+(the\s+)?plan\b/i,
  /\bbegin\s+implement(ing|ation)?\b/i,
  /\bbegin\s+(the\s+)?plan\b/i,
];

const CONTEXT_WINDOW_SIZE = 200000; // Fallback window when the statusline cache is absent
const CONTEXT_PRESSURE_THRESHOLD = 0.60; // Default hard-block ratio (60%)
const PRESSURE_THRESHOLD_MIN = 10; // Percent bounds for the env override
const PRESSURE_THRESHOLD_MAX = 90;

/**
 * Active gate threshold as a ratio. Overridable per user via the
 * SUPERPOWERS_PRESSURE_THRESHOLD env var (a percentage, e.g. "50"),
 * typically set in settings.json's `env` block so it survives plugin
 * updates. Values outside 10–90 or unparseable fall back to the default.
 * Read at call time so a changed environment takes effect immediately.
 */
function pressureThreshold() {
  const n = parseFloat(process.env.SUPERPOWERS_PRESSURE_THRESHOLD);
  if (Number.isFinite(n) && n >= PRESSURE_THRESHOLD_MIN && n <= PRESSURE_THRESHOLD_MAX) {
    return n / 100;
  }
  return CONTEXT_PRESSURE_THRESHOLD;
}
const CONTEXT_CACHE_MAX_AGE_MS = 30 * 60 * 1000; // Statusline cache staleness cutoff
const CONTEXT_CACHE_FILE = 'context-window.cache.json';

/**
 * Returns true if the prompt is triggering plan execution or heavy implementation.
 */
function isExecutionTrigger(prompt) {
  if (!prompt || typeof prompt !== 'string') return false;
  return EXECUTION_TRIGGER_PATTERNS.some(p => p.test(prompt));
}

/**
 * Convert a filesystem cwd path to the Claude Code project directory name.
 * Examples:
 *   Windows: "C:\Users\Tjerk Pieksma\..."       → "c--Users-Tjerk-Pieksma-..."
 *   Unix:    "/home/user/AI_Coding/My_tools"    → "-home-user-AI-Coding-My-tools"
 */
function cwdToProjectDir(cwd) {
  return cwd
    .replace(/^([A-Za-z]):/, (_, d) => d.toLowerCase() + '-') // C: → c-
    .replace(/[^A-Za-z0-9]/g, '-') // every other non-alphanumeric → -
    .replace(/-+$/, '');           // trim trailing dashes
}

/**
 * Absolute path of the Claude Code project directory for a cwd.
 */
function claudeProjectPath(cwd) {
  const homeDir = process.env.USERPROFILE || process.env.HOME || '';
  return path.join(homeDir, '.claude', 'projects', cwdToProjectDir(cwd));
}

/**
 * Read the statusline bridge cache (written by statusline-context-cache.js).
 * The cache carries the harness's authoritative context_window data — including
 * the TRUE window size (200K, 1M, …) — but only for the main session that the
 * statusline renders. It is used only when its session id matches the asking
 * session and it is fresh; anything else returns null and the caller falls
 * back to transcript parsing.
 */
function readContextWindowCache(sessionId) {
  if (!sessionId) return null;
  const homeDir = process.env.USERPROFILE || process.env.HOME || '';
  const file = path.join(homeDir, '.claude', 'hooks-logs', CONTEXT_CACHE_FILE);

  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  if (Date.now() - stat.mtimeMs > CONTEXT_CACHE_MAX_AGE_MS) return null;

  let cache;
  try {
    cache = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (!cache || cache.session_id !== sessionId) return null;
  const windowSize = cache.context_window_size;
  const total = cache.input_tokens_total;
  if (!(windowSize > 0) || !(total > 0)) return null;

  const threshold = pressureThreshold();
  const ratio = total / windowSize;
  return {
    inputK: Math.round(total / 1000),
    percent: Math.round(ratio * 100),
    overThreshold: ratio >= threshold,
    windowK: Math.round(windowSize / 1000),
    thresholdPercent: Math.round(threshold * 100),
  };
}

/**
 * Read the current session JSONL and return context pressure info.
 * Prefers the statusline bridge cache (true window size) when it matches this
 * session; otherwise uses the last assistant turn's total input tokens from
 * the transcript against the 200K fallback window.
 * Returns null if neither source has usable data.
 */
function getContextPressure(cwd, sessionId) {
  if (!sessionId) return null;

  const cached = readContextWindowCache(sessionId);
  if (cached) return cached;

  const jsonlPath = path.join(claudeProjectPath(cwd), sessionId + '.jsonl');

  let content;
  try {
    content = fs.readFileSync(jsonlPath, 'utf8');
  } catch {
    return null; // File absent or unreadable — silent no-op
  }

  // Use the last assistant turn's input total as context size.
  // input + cache_creation + cache_read = total tokens in context window for that turn.
  // Later turns always have more context, so the last value is the current state.
  let lastInputTotal = 0;

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'assistant' && obj.message && obj.message.usage) {
        const u = obj.message.usage;
        const turnInput = (u.input_tokens || 0)
          + (u.cache_creation_input_tokens || 0)
          + (u.cache_read_input_tokens || 0);
        if (turnInput > 0) lastInputTotal = turnInput;
      }
    } catch {
      // Skip malformed lines
    }
  }

  if (lastInputTotal === 0) return null;

  const threshold = pressureThreshold();
  const ratio = lastInputTotal / CONTEXT_WINDOW_SIZE;
  return {
    inputK: Math.round(lastInputTotal / 1000),
    percent: Math.round(ratio * 100),
    overThreshold: ratio >= threshold,
    windowK: Math.round(CONTEXT_WINDOW_SIZE / 1000),
    thresholdPercent: Math.round(threshold * 100),
  };
}

/**
 * Find the most recently modified session JSONL for this project.
 * Used when the caller does not know its own session id (e.g. --pressure CLI).
 * Returns the full path, or null if the project dir is absent or has no sessions.
 */
function findLatestSessionJsonl(cwd) {
  const projectPath = claudeProjectPath(cwd);

  let files;
  try {
    files = fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl'));
  } catch {
    return null;
  }

  let latest = null;
  let latestMtime = -1;
  for (const f of files) {
    const full = path.join(projectPath, f);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (st.mtimeMs > latestMtime) {
      latestMtime = st.mtimeMs;
      latest = full;
    }
  }
  return latest;
}

/**
 * Context pressure from the most recently modified session JSONL.
 * Same return shape as getContextPressure; null when unmeasurable.
 */
function getContextPressureAuto(cwd) {
  const jsonlPath = findLatestSessionJsonl(cwd);
  if (!jsonlPath) return null;
  return getContextPressure(cwd, path.basename(jsonlPath, '.jsonl'));
}

/**
 * Build the hard block message injected when context pressure ≥60%.
 * Returned as additionalContext — Claude sees this instead of skill hints.
 */
function buildContextPressureBlock(pressure) {
  return [
    '<context-pressure-gate>',
    `STOP — Do not start implementation yet.`,
    ``,
    `Context window: ~${pressure.inputK}K tokens consumed (${pressure.percent}% of ${pressure.windowK || 200}K limit).`,
    `Starting implementation at ≥${pressure.thresholdPercent || 60}% risks Auto Compact firing mid-task, destroying`,
    `variable names, file paths, and discovered facts at the worst possible moment.`,
    ``,
    `Required actions before proceeding:`,
    `1. Invoke the context-management skill to write state.md. Include:`,
    `   - Path to the plan file`,
    `   - Starting task number (e.g. "Task 1 — fresh start")`,
    `   - Any research-phase facts (exact file paths, variable names, non-obvious`,
    `     constraints) that the plan references but does not spell out explicitly.`,
    `2. Tell the user: "Context is at ${pressure.percent}%. Saving state and compacting`,
    `   before implementation — this prevents Auto Compact firing mid-task."`,
    `3. Run /compact.`,
    `4. After compaction, read state.md and resume with executing-plans.`,
    ``,
    `Do NOT begin implementation without completing steps 1–3.`,
    `</context-pressure-gate>`,
  ].join('\n');
}

// ── Agent messages and recall already shown ───────────────────────────────────

/**
 * Returns true if the prompt is a task notification or a message from another
 * agent, not text the user typed. Only the opening of the prompt is tested, so
 * a typed prompt that quotes such a marker later is still enriched.
 */
function isAgentMessage(prompt) {
  if (!prompt || typeof prompt !== 'string') return false;
  const opening = prompt.trimStart();
  return AGENT_MESSAGE_OPENINGS.some(marker => opening.startsWith(marker));
}

/** The path of the file that holds the recall keys of one session. */
function recallStatePath(sessionId) {
  const safeId = String(sessionId).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  return path.join(os.tmpdir(), `${RECALL_STATE_PREFIX}${safeId}.json`);
}

/** The keys already injected in this session; empty when none are known. */
function readShownKeys(sessionId) {
  if (!sessionId) return new Set();
  try {
    const keys = JSON.parse(fs.readFileSync(recallStatePath(sessionId), 'utf8')).keys;
    return new Set(Array.isArray(keys) ? keys : []);
  } catch {
    return new Set();
  }
}

/**
 * Records the keys as injected. A write failure only means that an entry may
 * be injected again later, so it is ignored.
 */
function rememberShownKeys(sessionId, keys) {
  if (!sessionId) return;
  try {
    fs.writeFileSync(recallStatePath(sessionId), JSON.stringify({ keys: [...keys] }));
  } catch {
    // ignored on purpose, see the comment above
  }
}

/**
 * An entry is identified by a hash of its whole text: headings repeat (many
 * session-log headings carry only a date).
 */
function entryKey(entry) {
  return crypto.createHash('sha1').update(entry).digest('hex');
}

/**
 * Builds the hook output for one UserPromptSubmit payload: `{}` or
 * `{ hookSpecificOutput }`. Shared by the Claude Code entry point below and by
 * hooks/codex/user-prompt-submit-adapter.js.
 */
function evaluatePrompt(data) {
  if (!data || typeof data !== 'object') return {};

  const prompt = typeof data.prompt === 'string' ? data.prompt : '';
  // Micro tasks and messages the user did not type skip all enrichment.
  if (!prompt || isMicroTask(prompt) || isAgentMessage(prompt)) return {};

  const cwd = typeof data.cwd === 'string' && data.cwd ? data.cwd : process.cwd();
  const sessionId = typeof data.session_id === 'string' ? data.session_id : null;

  // Context pressure gate: if the user is about to start implementation and
  // the context window is ≥60% full, block and require compact-first.
  // Returns early — pressure block replaces all other hints when it fires.
  if (isExecutionTrigger(prompt)) {
    const pressure = getContextPressure(cwd, sessionId);
    if (pressure && pressure.overThreshold) {
      return {
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: buildContextPressureBlock(pressure),
        },
      };
    }
  }

  // Run all pipelines independently. The two recall searches keep their own
  // ranking; an entry already injected in this session is then dropped and
  // not replaced by a weaker match.
  const matches = matchSkills(prompt);
  const keywords = extractKeywords(prompt);
  const shown = readShownKeys(sessionId);
  const isNew = entry => !shown.has(entryKey(entry));
  const memoryEntries = searchSessionLog(cwd, keywords).filter(isNew);
  const knownIssueEntries = searchKnownIssues(cwd, keywords).filter(isNew);

  const recalled = [...memoryEntries, ...knownIssueEntries];
  if (recalled.length > 0) {
    recalled.forEach(entry => shown.add(entryKey(entry)));
    rememberShownKeys(sessionId, shown);
  }

  const skillContext = buildContext(matches);
  const memoryContext = buildMemoryContext(memoryEntries);
  const knownIssuesContext = buildKnownIssuesContext(knownIssueEntries);

  if (!skillContext && !memoryContext && !knownIssuesContext) return {};

  // Combine: skill hint first (routing), known issues second (avoid known errors),
  // memory last (historical context)
  const combined = [skillContext, knownIssuesContext, memoryContext].filter(Boolean).join('\n\n');

  return {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: combined,
    },
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  try {
    process.stdout.write(JSON.stringify(evaluatePrompt(JSON.parse(input))));
  } catch {
    process.stdout.write('{}');
  }
}

if (require.main === module) {
  if (process.argv[2] === '--pressure') {
    // CLI mode: report context pressure for the given (or current) cwd.
    // Used by subagent-driven-development's batched autonomous mode between tasks.
    const pressure = getContextPressureAuto(process.argv[3] || process.cwd());
    process.stdout.write(JSON.stringify(pressure || { error: 'unmeasurable' }));
  } else {
    main();
  }
} else {
  module.exports = {
    matchSkills,
    buildContext,
    isMicroTask,
    extractKeywords,
    searchSessionLog,
    buildMemoryContext,
    searchKnownIssues,
    buildKnownIssuesContext,
    isExecutionTrigger,
    cwdToProjectDir,
    readContextWindowCache,
    getContextPressure,
    findLatestSessionJsonl,
    getContextPressureAuto,
    buildContextPressureBlock,
    isAgentMessage,
    evaluatePrompt,
    recallStatePath,
    RULES,
    CONFIDENCE_THRESHOLD,
    STOP_WORDS,
    MAX_MEMORY_ENTRIES,
    CONTEXT_WINDOW_SIZE,
    CONTEXT_PRESSURE_THRESHOLD,
    pressureThreshold,
  };
}
