import * as Brightness from 'expo-brightness';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

import { addEvent } from '@/services/calendar';
import { cancelScheduled, ensureNotificationPermission, scheduleAt } from '@/services/notifications';
import { formatCountdown, formatWhen, parseDuration, parseWhen } from '@/services/when';

/**
 * Her "hands". The brain asks for an action with one line at the end of a reply:
 *   ACTION(timer): 10m | pasta
 * A tag line is far more reliable for a sub-1B model than JSON tool calls.
 */

export const ACTION_KINDS = [
  'timer',
  'remind',
  'event',
  'open',
  'call',
  'text',
  'search',
  'maps',
  'copy',
  'brightness',
  'cancel',
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export interface AssistantAction {
  kind: ActionKind;
  args: string[];
  /** The line exactly as written, kept in history so the brain sees what it did. */
  raw: string;
}

export interface ActionResult {
  ok: boolean;
  /** HUD chip text, e.g. "TIMER · 10:00 · pasta". */
  label: string;
  /** Short spoken line when it failed. */
  error?: string;
}

// Not anchored to the line start: small models sometimes put the tag right after the sentence.
const ACTION_RE = new RegExp(`ACTION\\s*\\(\\s*(${ACTION_KINDS.join('|')})\\s*\\)\\s*:?\\s*(.*)$`, 'im');

export function parseAction(text: string): AssistantAction | undefined {
  const m = text.match(ACTION_RE);
  if (!m) return undefined;
  const kind = m[1].toLowerCase() as ActionKind;
  const args = m[2]
    .split('|')
    .map((a) => a.trim().replace(/^["“]|["”]$/g, ''))
    .filter(Boolean);
  return { kind, args, raw: `ACTION(${kind}): ${args.join(' | ')}` };
}

/** Actions that switch to another app. On a voice call they run after she finishes speaking. */
export function leavesApp(kind: ActionKind) {
  return kind === 'open' || kind === 'call' || kind === 'text' || kind === 'search' || kind === 'maps';
}

const fail = (label: string, error: string): ActionResult => ({ ok: false, label, error });

/* ── Apps she knows how to open ── */
const APPS: Record<string, { ios?: string; android?: string; web: string }> = {
  youtube: { ios: 'youtube://', android: 'vnd.youtube:', web: 'https://www.youtube.com' },
  spotify: { ios: 'spotify:', android: 'spotify:', web: 'https://open.spotify.com' },
  whatsapp: { ios: 'whatsapp://', android: 'whatsapp://send', web: 'https://web.whatsapp.com' },
  messenger: { ios: 'fb-messenger://', android: 'fb-messenger://', web: 'https://www.messenger.com' },
  facebook: { ios: 'fb://', android: 'fb://feed', web: 'https://www.facebook.com' },
  instagram: { ios: 'instagram://app', android: 'instagram://app', web: 'https://www.instagram.com' },
  telegram: { ios: 'tg://', android: 'tg://', web: 'https://web.telegram.org' },
  discord: { ios: 'discord://', android: 'discord://', web: 'https://discord.com/app' },
  x: { ios: 'twitter://', android: 'twitter://', web: 'https://x.com' },
  twitter: { ios: 'twitter://', android: 'twitter://', web: 'https://x.com' },
  tiktok: { ios: 'snssdk1233://', android: 'snssdk1233://', web: 'https://www.tiktok.com' },
  netflix: { ios: 'nflx://', android: 'nflx://', web: 'https://www.netflix.com' },
  gmail: { ios: 'googlegmail://', android: 'mailto:', web: 'https://mail.google.com' },
  mail: { ios: 'mailto:', android: 'mailto:', web: 'https://mail.google.com' },
  email: { ios: 'mailto:', android: 'mailto:', web: 'https://mail.google.com' },
  github: { web: 'https://github.com' },
  chatgpt: { web: 'https://chatgpt.com' },
  google: { web: 'https://www.google.com' },
  browser: { web: 'https://www.google.com' },
  chrome: { ios: 'googlechrome://', web: 'https://www.google.com' },
  maps: { ios: 'maps://', android: 'geo:0,0', web: 'https://maps.google.com' },
  'google maps': { ios: 'comgooglemaps://', android: 'geo:0,0', web: 'https://maps.google.com' },
};

async function openFirst(urls: (string | undefined)[]): Promise<boolean> {
  for (const url of urls) {
    if (!url) continue;
    try {
      await Linking.openURL(url);
      return true;
    } catch {
      // No app handles this scheme — try the next one.
    }
  }
  return false;
}

async function openApp(target: string): Promise<ActionResult> {
  const name = target.toLowerCase().replace(/^the\s+|\s+app$/g, '').trim();
  const label = `OPEN · ${target.toUpperCase()}`;
  if (!name) return fail(label, 'Open what, exactly?');
  if (name === 'settings') {
    await Linking.openSettings();
    return { ok: true, label };
  }
  if (/^https?:\/\//.test(name) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(name)) {
    const url = /^https?:\/\//.test(name) ? target : `https://${target}`;
    return (await openFirst([url])) ? { ok: true, label } : fail(label, 'That link refused to open.');
  }
  const app = APPS[name];
  if (!app) return fail(label, `I don't have a link to ${target} on this phone yet.`);
  const native = Platform.OS === 'ios' ? app.ios : Platform.OS === 'android' ? app.android : undefined;
  return (await openFirst([native, app.web])) ? { ok: true, label } : fail(label, `${target} wouldn't open.`);
}

const digits = (s: string) => s.replace(/[^\d+]/g, '');

/** Runs an action. Never throws: failures come back as { ok: false } with a line she can say. */
export async function runAction(action: AssistantAction): Promise<ActionResult> {
  const [a = '', b = ''] = action.args;
  try {
    switch (action.kind) {
      case 'timer': {
        const secs = parseDuration(a.replace(/^(in|for)\s+/i, ''));
        const label = `TIMER · ${a.toUpperCase()}`;
        if (!secs) return fail(label, `I couldn't parse "${a}" as a duration.`);
        if (!(await ensureNotificationPermission())) return fail(label, 'Notifications are blocked, so I can’t ring.');
        const fireAt = new Date(Date.now() + secs * 1000);
        await scheduleAt('timer', fireAt, 'Timer done', b ? `${b} — time's up.` : "Time's up. Don't pretend you forgot.", b);
        return { ok: true, label: `TIMER · ${formatCountdown(secs)}${b ? ` · ${b}` : ''}` };
      }
      case 'remind': {
        const when = parseWhen(a);
        const what = b || 'Reminder';
        const label = `REMIND · ${a.toUpperCase()}`;
        if (!when) return fail(label, `I couldn't work out when "${a}" is.`);
        if (!(await ensureNotificationPermission())) return fail(label, 'Notifications are blocked, so I can’t remind you.');
        await scheduleAt('reminder', when, 'Kurisu · Reminder', what, what);
        return { ok: true, label: `REMIND · ${formatWhen(when)} · ${what}` };
      }
      case 'event': {
        const when = parseWhen(a);
        const title = b || 'Event';
        const label = `EVENT · ${a.toUpperCase()}`;
        if (!when) return fail(label, `I couldn't work out when "${a}" is.`);
        await addEvent(title, when);
        return { ok: true, label: `EVENT · ${formatWhen(when)} · ${title}` };
      }
      case 'open':
        return openApp(a);
      case 'call': {
        const num = digits(a);
        const label = `CALL · ${a}`;
        // Opens the dialer pre-filled: the user still presses call, which doubles as confirmation.
        if (num.length < 3) return fail(label, 'I need an actual number. Contacts aren’t linked yet.');
        return (await openFirst([`tel:${num}`])) ? { ok: true, label } : fail(label, 'This device can’t place calls.');
      }
      case 'text': {
        const num = digits(a);
        const label = `TEXT · ${a}`;
        if (num.length < 3) return fail(label, 'I need an actual number. Contacts aren’t linked yet.');
        const body = b ? `${Platform.OS === 'ios' ? '&' : '?'}body=${encodeURIComponent(b)}` : '';
        // Opens a pre-filled draft — nothing is sent until the user taps send.
        return (await openFirst([`sms:${num}${body}`])) ? { ok: true, label } : fail(label, 'This device can’t send texts.');
      }
      case 'search': {
        const label = `SEARCH · ${a}`;
        if (!a) return fail(label, 'Search for what?');
        const ok = await openFirst([`https://www.google.com/search?q=${encodeURIComponent(a)}`]);
        return ok ? { ok: true, label } : fail(label, 'The browser wouldn’t open.');
      }
      case 'maps': {
        const label = `MAPS · ${a}`;
        if (!a) return fail(label, 'Navigate where?');
        const q = encodeURIComponent(a);
        const native = Platform.OS === 'ios' ? `maps://?q=${q}` : Platform.OS === 'android' ? `geo:0,0?q=${q}` : undefined;
        const ok = await openFirst([native, `https://www.google.com/maps/search/?api=1&query=${q}`]);
        return ok ? { ok: true, label } : fail(label, 'Maps wouldn’t open.');
      }
      case 'copy': {
        const text = action.args.join(' | ');
        if (!text) return fail('COPY', 'Copy what?');
        await Clipboard.setStringAsync(text);
        return { ok: true, label: `COPIED · ${text.length > 28 ? `${text.slice(0, 28)}…` : text}` };
      }
      case 'brightness': {
        const pct = Math.max(5, Math.min(100, parseInt(a.replace(/[^\d]/g, ''), 10)));
        const label = `BRIGHTNESS · ${a}`;
        if (Number.isNaN(pct)) return fail(label, 'Give me a brightness from 0 to 100.');
        // App-level brightness: needs no permission, and resets when the app closes.
        await Brightness.setBrightnessAsync(pct / 100);
        return { ok: true, label: `BRIGHTNESS · ${pct}%` };
      }
      case 'cancel': {
        const kind = /timer/i.test(a) ? 'timer' : /remind/i.test(a) ? 'reminder' : undefined;
        const n = await cancelScheduled(kind);
        return { ok: true, label: `CLEARED · ${n} ${kind ?? 'item'}${n === 1 ? '' : 's'}` };
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[kurisu] action failed', action.raw, e);
    return fail(action.kind.toUpperCase(), `That failed: ${msg}.`);
  }
}
