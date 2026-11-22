import * as Battery from 'expo-battery';
import * as Network from 'expo-network';

import { todaysEvents, UpcomingEvent } from '@/services/calendar';
import { listScheduled, ScheduledItem } from '@/services/notifications';
import { formatClock, formatCountdown, formatWhen } from '@/services/when';

/** What she "senses" about the phone and the user's day at the moment a message is sent. */
export interface DeviceSnapshot {
  now: Date;
  /** 0..100, or null when unknown. */
  battery: number | null;
  charging: boolean;
  lowPower: boolean;
  network: string;
  online: boolean;
  events: UpcomingEvent[];
  scheduled: ScheduledItem[];
}

/** Each sensor gets a short budget: a slow API must never delay her reply. */
function within<T>(p: Promise<T>, fallback: T, ms = 350): Promise<T> {
  return Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

export async function getDeviceSnapshot(): Promise<DeviceSnapshot> {
  const [power, net, events, scheduled] = await Promise.all([
    within(Battery.getPowerStateAsync(), null),
    within(Network.getNetworkStateAsync(), null),
    within(todaysEvents(), [] as UpcomingEvent[], 600),
    within(listScheduled(), [] as ScheduledItem[]),
  ]);
  const level = power?.batteryLevel ?? -1;
  const state = power?.batteryState;
  return {
    now: new Date(),
    battery: level >= 0 ? Math.round(level * 100) : null,
    charging: state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL,
    lowPower: !!power?.lowPowerMode,
    network: (net?.type ?? 'unknown').toString().toLowerCase(),
    online: !!net?.isConnected,
    events,
    scheduled,
  };
}

/* ── Cached snapshot: replies read it instantly and it refreshes in the background ── */
const STALE_MS = 20_000;
let latest: DeviceSnapshot | null = null;
let latestAt = 0;
let refreshing: Promise<DeviceSnapshot> | null = null;

/** Re-reads the sensors (call after scheduling a timer, etc.). */
export function refreshSnapshot(): Promise<DeviceSnapshot> {
  if (!refreshing) {
    refreshing = getDeviceSnapshot()
      .then((s) => {
        latest = s;
        latestAt = Date.now();
        return s;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

/**
 * The latest snapshot with the clock set to now. Never waits: a stale snapshot is refreshed
 * in the background for the next message (battery and calendar don't change by the second).
 */
export function currentSnapshot(): DeviceSnapshot {
  if (Date.now() - latestAt > STALE_MS) refreshSnapshot().catch(() => {});
  const base: DeviceSnapshot = latest ?? {
    now: new Date(),
    battery: null,
    charging: false,
    lowPower: false,
    network: 'unknown',
    online: true,
    events: [],
    scheduled: [],
  };
  const now = new Date();
  // Drop timers / reminders that fired since the last refresh.
  return { ...base, now, scheduled: base.scheduled.filter((i) => i.fireAt > now.getTime()) };
}

function partOfDay(d: Date) {
  const h = d.getHours();
  if (h < 5) return 'late night';
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  if (h < 21) return 'evening';
  return 'night';
}

/**
 * Compact status line appended to the user's latest message (not the system prompt), so the
 * cached system prompt + history prefix stays identical between turns.
 */
export function formatSnapshot(s: DeviceSnapshot): string {
  // Kept short: it is stored with every user turn (and replayed, so the prompt prefix stays cacheable).
  const date = s.now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const parts = [`${formatClock(s.now)} ${partOfDay(s.now)}, ${date}`];
  if (s.battery != null) parts.push(`battery ${s.battery}%${s.charging ? ' charging' : ''}${s.lowPower ? ' low-power' : ''}`);
  if (!s.online) parts.push('offline');
  if (s.events.length) {
    parts.push(
      `today's calendar: ${s.events
        .map((e) => `${e.allDay ? 'all day' : formatClock(e.start)} ${e.title}`)
        .join('; ')}`
    );
  }
  if (s.scheduled.length) {
    parts.push(
      `pending: ${s.scheduled
        .slice(0, 4)
        .map((i) =>
          i.kind === 'timer'
            ? `timer ${formatCountdown((i.fireAt - s.now.getTime()) / 1000)} left${i.text ? ` (${i.text})` : ''}`
            : `reminder ${formatWhen(new Date(i.fireAt), s.now)} "${i.text}"`
        )
        .join('; ')}`
    );
  }
  return `[STATUS ${parts.join(' | ')}]`;
}
