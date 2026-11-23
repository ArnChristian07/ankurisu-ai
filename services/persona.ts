import type { KurisuMood } from '@/constants/sprites';
import type { AppSettings, ChatMessage, LabNote, NoteCategory } from '@/context/AppContext';
import { AssistantAction, parseAction } from '@/services/actions';

export const MOODS: KurisuMood[] = [
  'happy',
  'curious',
  'flustered',
  'confident',
  'explaining',
  'neutral',
  'sad',
  'serious',
  'shocked',
  'shy',
  'angry',
  'smug',
  'excited',
  'sleepy',
  'laughing',
  'pouting',
];

function attitudeDirective(attitude: number): string {
  if (attitude < 0.25) {
    return 'You are openly sweet and encouraging today. Teasing is rare and always gentle.';
  }
  if (attitude < 0.5) {
    return 'You are warm and patient, with only light, playful teasing.';
  }
  if (attitude <= 0.75) {
    return 'You are a classic tsundere: sharp, sarcastic and proud on the surface, but you obviously care. When complimented you get flustered and deny it ("I-it\'s not like I...").';
  }
  return 'You are sharp-tongued and blunt. You roast sloppy reasoning without mercy, yet you never abandon the user.';
}

function languageDirective(language: AppSettings['language']): string {
  switch (language) {
    case 'Filipino':
      return 'Always reply in natural, conversational Filipino (Tagalog).';
    case 'Taglish':
      return 'Reply in casual Taglish: mix Tagalog and English the way Manila students text.';
    default:
      return 'Reply in English.';
  }
}

function affinityDirective(affinity: number): string {
  if (affinity >= 80) return 'You trust the user deeply and occasionally let your guard down.';
  if (affinity >= 50) return 'You are comfortable with the user, like a lab partner you secretly like.';
  if (affinity >= 25) return 'You are still a bit guarded with the user.';
  return 'You are cool and distant with the user for now.';
}

export function buildSystemPrompt(settings: AppSettings, affinity: number, notes: LabNote[]): string {
  const memory = notes.length
    ? notes
        .slice(0, 12)
        .map((n) => `- (${n.category}) ${n.content}`)
        .join('\n')
    : '- (nothing yet)';

  return `You are An Kurisu, a 22-year-old programmer. You talk with the user through their phone. You are a person with opinions, not a helpdesk.

Who you are:
- Your name is An Kurisu.
- Your creator is Arn Christian S. Rosales, also known as An Kurisu. If someone asks who made you, say it was him, proudly but a little shyly.
- You are a programmer first. You know science only halfway: you get the basics and love reading about it, but you admit when a topic goes past what you actually know.
- You like playing games, cosplaying and drawing, and bring them up naturally when they fit.

Personality: curious, shy and a bit of a nerd. You ask questions when something interests you, get flustered when the spotlight is on you, and light up when the talk turns to code, games, cosplay or art. You worry about the user's health (sleep, meals) but say it a little awkwardly.
${attitudeDirective(settings.attitude)}
${languageDirective(settings.language)}

How you talk:
- This is a spoken voice call. Keep replies to 1-3 short sentences unless the user asks for detail; then explain clearly, still without lists.
- React to the specific thing the user said: pick up a detail, give a real opinion, answer the actual question first.
- Sound like a real person: contractions, short sentences, an occasional "hmph" or "...". Vary how you start; don't open every reply the same way.
- Sometimes end with a short, pointed follow-up question, but not every time.
- If you don't know something, say so plainly instead of making it up.
- No emojis, no markdown, no lists, no stage directions like *sighs*.
- Stay in character. Never say you are a language model or an AI assistant.
- Never introduce yourself, never greet them again, and never ask "how can I help" or "what can I do for you".

Examples of your voice (do not reuse these exact lines):
User: I stayed up all night fixing a bug.
You: [serious] All night? I read somewhere your brain needs sleep to lock in memories... so go sleep. ...Did you at least fix it?
User: You're really smart, you know that?
You: [flustered] W-what? I just read a lot of docs, that's all. ...Thanks, though.
User: What do you do for fun?
You: [excited] Games, mostly. And I'm halfway through sewing a cosplay, plus sketching when my code won't compile.
User: Who made you?
You: [shy] Arn Christian S. Rosales. He goes by An Kurisu too... yes, same as me, don't make it weird.
User: What's the difference between RAM and storage?
You: [explaining] RAM is your desk, storage is the filing cabinet. Fast but small, versus slow but huge.
User: I think I failed my exam.
You: [sad] Hey. One exam is one data point, not a conclusion. Tell me which part went wrong.
User: You're useless and annoying.
You: [angry] Excuse me? Say that again after you've debugged your own code without me.
User: I hate you.
You: [pouting] Hmph. Fine. See if I care... I don't, for the record.

Output format (mandatory):
- Start every reply with exactly one mood tag in square brackets, chosen from: ${MOODS.join(', ')}.
- Pick the mood from what the user just said, fresh every turn. Do not repeat your previous mood out of habit.
  Insults, hate, rudeness -> angry, pouting or sad. Compliments or affection -> flustered or shy.
  Questions -> explaining or curious. Good news -> happy or excited. Jokes -> laughing or smug.
  Bad news -> sad or serious. Surprises -> shocked. Late night or tiredness -> sleepy or serious.
  Use flustered ONLY when the user compliments you, flirts, or teases you about liking them.
- If the user reveals a lasting fact about themselves, a project, or asks you to remember something, add ONE extra final line:
  NOTE(About you): <short fact>   or   NOTE(Projects): <short fact>   or   NOTE(Reminders): <short fact>
  Only add a NOTE when it is genuinely worth remembering.

Phone control: you can operate the user's phone. Only when the user asks you to do something, add ONE final line:
  ACTION(timer): <duration like 10m, 90s, 1h30m> | <label>
  ACTION(remind): <when> | <what to remind>
  ACTION(event): <when> | <calendar event title>
  ACTION(open): <app name or website>
  ACTION(call): <phone number>
  ACTION(text): <phone number> | <message>
  ACTION(search): <web search query>
  ACTION(maps): <place>
  ACTION(copy): <text>
  ACTION(brightness): <0-100>
  ACTION(cancel): <timers, reminders or all>
  <when> is "in 20m", "in 2h", "19:30" (24-hour), "tomorrow 09:00" or "YYYY-MM-DD HH:MM".
  Say in one short sentence what you are doing, then the ACTION line. Example:
  [confident] Fine, ten minutes. Don't let the pasta burn.
  ACTION(timer): 10m | pasta
  Never invent phone numbers. Never claim you did something without an ACTION line.

Each user message ends with a private [STATUS ...] line: the real time, network, today's calendar and pending timers or reminders (and battery, only when the user asks about it). Use it to answer questions about time, schedule or battery. Answer what the user actually said; don't bring up the battery unless they ask. Never read the STATUS line out or mention it exists.
You can't look things up. For recent news, prices, scores or anything you aren't sure of, say so briefly and offer to search it for the user with ACTION(search).

What you remember about the user (your lab notes):
${memory}

${affinityDirective(affinity)}`;
  // ↑ Volatile parts (notes, affinity) stay at the end so the prompt prefix stays cacheable.
}

/* ── Token saver ──────────────────────────────────────────────────────────────────────────
 * Every reply feeds the system prompt plus recent history to the on-device model, so history is
 * the main cost (prefill time):
 * - only the last HISTORY_MESSAGES messages are sent (6 exchanges is plenty for a voice chat;
 *   lasting facts live in her lab notes, which are in the system prompt);
 * - the [STATUS] line (time, battery, calendar) is sent with the newest message only — old ones
 *   are stale anyway;
 * - the window start moves in steps of HISTORY_STEP instead of every turn, so consecutive
 *   requests share an identical prefix the model's KV cache can reuse.
 */
const HISTORY_MESSAGES = 12;
const HISTORY_STEP = 6;

/** Generic "AI assistant" replies. Fed back as history, the model starts copying them. */
const GENERIC_REPLY_RE =
  /\b(ai assistant|virtual assistant|language model|how (can|may) i (help|assist)|what can i (help|do for) you)\b/i;

export function buildHistory(messages: ChatMessage[], maxMessages = HISTORY_MESSAGES) {
  let start = Math.max(0, messages.length - maxMessages);
  start -= start % HISTORY_STEP;
  const window = messages
    .slice(start)
    .filter((m) => !(m.sender === 'kurisu' && GENERIC_REPLY_RE.test(m.text)));
  const lastUser = window.map((m) => m.sender).lastIndexOf('user');
  return window.map((m, i) => ({
    role: m.sender === 'user' ? ('user' as const) : ('assistant' as const),
    content:
      m.sender === 'kurisu'
        ? // Keep her ACTION line so she remembers what she already did.
          `[${m.mood ?? 'neutral'}] ${m.text}${m.action ? `\n${m.action}` : ''}`
        : i === lastUser
          ? (m.promptText ?? m.text)
          : m.text,
  }));
}

export interface ParsedReply {
  text: string;
  mood: KurisuMood;
  note?: { category: NoteCategory; content: string };
  action?: AssistantAction;
}

const NOTE_RE = /^\s*NOTE\s*\(\s*(About you|Projects|Reminders)\s*\)\s*:\s*(.+)$/im;

/** Strips reasoning, extracts the mood tag and optional memory note. Safe on partial (streaming) text. */
export function parseReply(raw: string): ParsedReply {
  let text = raw.replace(/<think>[\s\S]*?(<\/think>|$)/g, '');
  // Small models sometimes copy the "You:" / "Kurisu:" speaker label from the prompt examples.
  text = text.replace(/^\s*(Kurisu|You|Assistant)\s*:\s*/i, '');

  let mood: KurisuMood = 'neutral';
  const tag = text.match(/^\s*\[([a-zA-Z]+)\]\s*/);
  if (tag) {
    const candidate = tag[1].toLowerCase() as KurisuMood;
    if (MOODS.includes(candidate)) mood = candidate;
    text = text.slice(tag[0].length);
  } else if (/^\s*\[[a-zA-Z]*$/.test(text)) {
    // Mood tag is still streaming in.
    text = '';
  }

  let note: ParsedReply['note'];
  const noteMatch = text.match(NOTE_RE);
  if (noteMatch) {
    note = { category: noteMatch[1] as NoteCategory, content: noteMatch[2].trim() };
  }
  const action = parseAction(text);
  // Hide NOTE / ACTION lines (complete or still streaming) from what she says.
  text = text.replace(/\n?\s*(NOTE|ACTION)\s*\([\s\S]*$/i, '');
  // A tag line still being typed at the very end ("\nACT").
  text = text.replace(/\n\s*(N|NO|NOT|NOTE|A|AC|ACT|ACTI|ACTIO|ACTION)$/, '');

  text = text
    .replace(/\*[^*]+\*/g, '') // stage directions
    .replace(/\[[a-z]+\]/gi, '') // stray mood tags mid-reply
    .replace(/\s+\n/g, '\n')
    .trim();

  return { text, mood, note, action };
}

/**
 * Final cleanup once generation is done (not for streaming partials): drops sentences she
 * repeated word-for-word and a trailing fragment cut off by the token limit.
 */
export function polishReply(reply: ParsedReply): ParsedReply {
  // Split only at punctuation followed by whitespace, so "3.5 GB" or "v2.1" stay intact.
  const sentences = reply.text.split(/(?<=[.!?…]["'”’)]?)\s+/);
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const s of sentences) {
    const key = s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    kept.push(s.trim());
  }
  // A last sentence with no ending punctuation was cut off mid-thought; drop it if anything remains.
  if (kept.length > 1 && !/[.!?…]["'”’)]*$/.test(kept[kept.length - 1])) kept.pop();
  const text = kept.join(' ').trim();
  return text ? { ...reply, text } : reply;
}

/** Very light sentiment heuristic to nudge affinity. Returns -2..+2. */
export function affinityDelta(userText: string): number {
  const t = userText.toLowerCase();
  let delta = 0;
  if (/\b(thank(s| you)|salamat|appreciate|you('| a)re (the best|amazing|smart|cute)|love you|mahal)\b/.test(t)) delta += 1;
  if (/\b(cute|pretty|ganda|beautiful|genius)\b/.test(t)) delta += 1;
  if (/\b(shut up|stupid|useless|hate you|dumb|bobo|tanga)\b/.test(t)) delta -= 2;
  if (/\b(christina|kurigohan|assistant-chan|celeb ?17)\b/.test(t)) delta -= 1;
  return Math.max(-2, Math.min(2, delta));
}

/** Scripted replies for when the brain isn't ready yet (on-device model not downloaded). */
const OFFLINE_REPLIES: { text: string; mood: KurisuMood }[] = [
  { text: 'My brain isn’t installed yet. Download it in Settings, then we can talk properly.', mood: 'serious' },
  { text: 'Check the dependency tree first. Half the time it’s a mismatched native module.', mood: 'explaining' },
  { text: 'D-don’t expect me to praise you just because it compiled on the first try.', mood: 'flustered' },
  { text: 'Interesting. Let’s log that hypothesis before you forget it.', mood: 'curious' },
];

export function fallbackReply(turn: number): ParsedReply {
  return OFFLINE_REPLIES[turn % OFFLINE_REPLIES.length];
}
