/**
 * Turns the short time phrases the brain writes in ACTION lines into dates.
 * The prompt asks for "in 20m", "19:30", "tomorrow 09:00" or "2026-11-23 09:00", but a small model
 * drifts, so this also accepts "7:30pm", "10 minutes", "tonight", weekday names and similar.
 */

const UNIT_SECONDS: Record<string, number> = {
  s: 1, sec: 1, secs: 1, second: 1, seconds: 1, segundo: 1, segundos: 1,
  m: 60, min: 60, mins: 60, minute: 60, minutes: 60, minuto: 60, minutos: 60,
  h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600, oras: 3600,
};

/** "10m", "1h 30m", "90 seconds", "half an hour" → seconds. Null when it isn't a duration. */
export function parseDuration(input: string): number | null {
  const t = input.toLowerCase().trim();
  if (/^half an? hour$/.test(t)) return 1800;
  if (/^(an?|one) hour$/.test(t)) return 3600;
  if (/^(an?|one) minute$/.test(t)) return 60;
  const re = /(\d+(?:\.\d+)?)\s*([a-z]+)/g;
  let total = 0;
  let matched = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const unit = UNIT_SECONDS[m[2]];
    if (!unit) return null;
    total += parseFloat(m[1]) * unit;
    matched += m[0];
  }
  // Every non-space character must belong to a number+unit pair ("10m and stuff" is not a duration).
  if (!total || matched.replace(/\s/g, '').length !== t.replace(/\s|and|,/g, '').length) return null;
  return Math.round(total);
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const PART_OF_DAY: Record<string, number> = {
  morning: 9,
  noon: 12,
  afternoon: 15,
  evening: 19,
  tonight: 20,
  night: 21,
  midnight: 0,
};

/** "19:30", "7pm", "7:30 pm", "0930" → [hour, minute]. */
function parseClock(t: string): [number, number] | null {
  const m = t.match(/\b(\d{1,2})(?::|\.)?(\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?\b/);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const meridiem = m[3]?.[0];
  // A bare number with no colon and no am/pm ("in 3") is not a clock time.
  if (!m[2] && !meridiem) return null;
  if (meridiem === 'p' && hour < 12) hour += 12;
  if (meridiem === 'a' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return [hour, minute];
}

/** Parses a time phrase relative to `now`. Returns null when it can't be understood. */
export function parseWhen(input: string, now = new Date()): Date | null {
  const t = input.toLowerCase().trim().replace(/\s+/g, ' ');
  if (!t) return null;

  // Relative: "in 20m", "20 minutes", "after 1 hour".
  const rel = t.replace(/^(in|after|within|mamaya ng|sa loob ng)\s+/, '');
  const secs = parseDuration(rel);
  if (secs != null) return new Date(now.getTime() + secs * 1000);

  const date = new Date(now);
  date.setSeconds(0, 0);
  let dayChosen = false;

  // Absolute date: 2026-11-23
  const iso = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    date.setFullYear(+iso[1], +iso[2] - 1, +iso[3]);
    dayChosen = true;
  } else if (/\b(tomorrow|bukas)\b/.test(t)) {
    date.setDate(date.getDate() + 1);
    dayChosen = true;
  } else if (/\b(today|ngayon|mamaya)\b/.test(t)) {
    dayChosen = true;
  } else {
    const wd = WEEKDAYS.findIndex((d) => t.includes(d));
    if (wd >= 0) {
      const diff = (wd - date.getDay() + 7) % 7 || 7;
      date.setDate(date.getDate() + diff);
      dayChosen = true;
    }
  }

  const rest = iso ? t.replace(iso[0], '') : t;
  const clock = parseClock(rest);
  if (clock) {
    date.setHours(clock[0], clock[1], 0, 0);
  } else {
    const part = Object.keys(PART_OF_DAY).find((p) => rest.includes(p));
    if (part) date.setHours(PART_OF_DAY[part], 0, 0, 0);
    else if (dayChosen && !/\b(today|ngayon|mamaya)\b/.test(t)) date.setHours(9, 0, 0, 0);
    else return null;
  }

  // A time that already passed today means the next occurrence.
  if (date.getTime() <= now.getTime()) {
    if (dayChosen && !/\b(today|ngayon|mamaya)\b/.test(t)) return null;
    date.setDate(date.getDate() + 1);
  }
  return date;
}

export function formatClock(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** "7:30 PM" today, "Tomorrow 9:00 AM", or "Mon, Nov 23 9:00 AM". */
export function formatWhen(d: Date, now = new Date()): string {
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (sameDay) return formatClock(d);
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow ${formatClock(d)}`;
  return `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} ${formatClock(d)}`;
}

/** 600 → "10:00", 3725 → "1:02:05". */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = (s % 60).toString().padStart(2, '0');
  return h ? `${h}:${m.toString().padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
