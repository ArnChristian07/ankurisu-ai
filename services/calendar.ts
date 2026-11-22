import { Platform } from 'react-native';

/**
 * Calendar access (expo-calendar's object API, SDK 58+). Loaded lazily: the native module isn't in
 * Expo Go or on web, and the rest of the app must keep working there.
 */
type CalendarModule = typeof import('expo-calendar');

let mod: CalendarModule | null | undefined;
function cal(): CalendarModule | null {
  if (mod !== undefined) return mod;
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return (mod = null);
  try {
    mod = require('expo-calendar') as CalendarModule;
  } catch {
    mod = null;
  }
  return mod;
}

export interface UpcomingEvent {
  title: string;
  start: Date;
  allDay: boolean;
}

let cache: { at: number; events: UpcomingEvent[] } | null = null;
const CACHE_MS = 5 * 60 * 1000;

/**
 * Today's remaining events. Never prompts — returns [] unless calendar access was already granted
 * (it gets granted the first time she adds an event).
 */
export async function todaysEvents(): Promise<UpcomingEvent[]> {
  const c = cal();
  if (!c) return [];
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.events;
  try {
    const perm = await c.getCalendarPermissions();
    if (!perm.granted) return [];
    const calendars = await c.getCalendars();
    if (!calendars.length) return [];
    const now = new Date();
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    const events = await c.listEvents(calendars, now, end);
    const result = events
      .map((e) => ({ title: e.title || 'Untitled', start: new Date(e.startDate), allDay: !!e.allDay }))
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .slice(0, 5);
    cache = { at: Date.now(), events: result };
    return result;
  } catch (e) {
    console.warn('[kurisu] calendar read failed', e);
    return [];
  }
}

/** Adds an event to the user's primary writable calendar. Asks for permission on first use. */
export async function addEvent(title: string, start: Date, durationMinutes = 60): Promise<void> {
  const c = cal();
  if (!c) throw new Error('Calendar needs a development build');
  const perm = await c.requestCalendarPermissions();
  if (!perm.granted) throw new Error('Calendar permission denied');

  let target: InstanceType<CalendarModule['ExpoCalendar']> | undefined;
  if (Platform.OS === 'ios') {
    target = c.getDefaultCalendarSync();
  } else {
    // Android has no single default calendar: prefer the primary one that accepts new events.
    const writable = (await c.getCalendars()).filter((x) => x.allowsModifications);
    target = writable.find((x) => x.isPrimary) ?? writable[0];
  }
  if (!target) throw new Error('No writable calendar on this device');

  await target.createEvent({
    title,
    startDate: start,
    endDate: new Date(start.getTime() + durationMinutes * 60 * 1000),
  });
  cache = null;
}
