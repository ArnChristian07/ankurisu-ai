import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/** Local notifications for her timers and reminders. Nothing here touches push / the network. */

const CHANNEL_ID = 'kurisu-alerts';
const supported = Platform.OS === 'ios' || Platform.OS === 'android';

export type ScheduledKind = 'timer' | 'reminder';

export interface ScheduledItem {
  id: string;
  kind: ScheduledKind;
  text: string;
  /** Unix ms when it fires. */
  fireAt: number;
}

let initialized = false;

/** Call once at startup: show alerts while the app is open, and create the Android channel. */
export async function initNotifications() {
  if (!supported || initialized) return;
  initialized = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  if (Platform.OS === 'android') {
    // On Android 13+ the permission prompt only appears once a channel exists.
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Timers & reminders',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 150, 250],
      lightColor: '#4FD8FF',
    }).catch(() => {});
  }
}

/** Asks for notification permission the first time she needs it. */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (!supported) return false;
  await initNotifications();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const next = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: false, allowSound: true },
  });
  return next.granted;
}

/** Android 12+: without this, timers can fire minutes late. Opens the system screen to allow it. */
export async function exactAlarmsAllowed(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    return (await Notifications.getExactAlarmPermissionsAsync()).granted;
  } catch {
    return true;
  }
}

export async function requestExactAlarms(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    return (await Notifications.requestExactAlarmPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

export async function scheduleAt(
  kind: ScheduledKind,
  fireAt: Date,
  title: string,
  body: string,
  text: string
): Promise<string> {
  const seconds = Math.max(1, Math.round((fireAt.getTime() - Date.now()) / 1000));
  return Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: true,
      data: { kind, text, fireAt: fireAt.getTime() },
    },
    // Short timers use an interval trigger (exact to the second); reminders use a calendar date.
    trigger:
      kind === 'timer'
        ? { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds, channelId: CHANNEL_ID }
        : { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt, channelId: CHANNEL_ID },
  });
}

/** Her pending timers and reminders, soonest first. */
export async function listScheduled(): Promise<ScheduledItem[]> {
  if (!supported) return [];
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    const now = Date.now();
    return all
      .map((n) => {
        const data = (n.content.data ?? {}) as Partial<ScheduledItem>;
        return {
          id: n.identifier,
          kind: data.kind === 'timer' ? ('timer' as const) : ('reminder' as const),
          text: typeof data.text === 'string' ? data.text : (n.content.body ?? ''),
          fireAt: typeof data.fireAt === 'number' ? data.fireAt : 0,
        };
      })
      .filter((n) => n.fireAt > now)
      .sort((a, b) => a.fireAt - b.fireAt);
  } catch {
    return [];
  }
}

export async function cancelScheduled(kind?: ScheduledKind): Promise<number> {
  if (!supported) return 0;
  const items = await listScheduled();
  const targets = kind ? items.filter((i) => i.kind === kind) : items;
  await Promise.all(targets.map((i) => Notifications.cancelScheduledNotificationAsync(i.id).catch(() => {})));
  return targets.length;
}
