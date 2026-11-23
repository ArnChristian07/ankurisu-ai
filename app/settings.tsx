import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AttitudeSlider } from '@/components/AttitudeSlider';
import { GridBackground } from '@/components/GridBackground';
import { HudFrame } from '@/components/hud/HudFrame';
import { SectionLabel } from '@/components/hud/SectionLabel';
import { ToggleSwitch } from '@/components/ToggleSwitch';
import { HUD, MONO } from '@/constants/theme';
import { formatBytes } from '@/constants/models';
import { LanguageOption, useAppState, type VoicePackState } from '@/context/AppContext';
import { NEURAL_MODEL, NEURAL_VOICES, neuralVoice, neuralVoiceById } from '@/services/neuralVoice';
import { WAKE_MODEL } from '@/services/wakeWord';
import { LOCAL_MODEL } from '@/services/localBrain';
import { exactAlarmsAllowed, requestExactAlarms } from '@/services/notifications';
import {
  DEFAULT_TUNE,
  listVoices,
  speak,
  stopSpeaking,
  TUNE_PRESETS,
  VOICE_TUNE_LIMITS,
  VoiceOption,
  VoiceTune,
} from '@/services/voice';

const LANGUAGES: LanguageOption[] = ['English', 'Filipino', 'Taglish'];

function getAttitudeLabel(val: number): string {
  if (val < 0.25) return 'SWEET';
  if (val < 0.5) return 'WARM';
  if (val <= 0.75) return 'TSUNDERE';
  return 'SHARP';
}

function Divider() {
  return <View className="h-[1px]" style={{ backgroundColor: HUD.lineDim }} />;
}

function ToggleRow({
  title,
  subtitle,
  value,
  onChange,
}: {
  title: string;
  subtitle: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View className="flex-row items-center justify-between py-4">
      <View className="flex-1 pr-4">
        <Text className="text-[15.5px] font-medium" style={{ color: HUD.text }}>
          {title}
        </Text>
        <Text className="mt-0.5 text-[12.5px]" style={{ color: HUD.textMuted }}>
          {subtitle}
        </Text>
      </View>
      <ToggleSwitch value={value} onValueChange={onChange} />
    </View>
  );
}

/** "Hey Kurisu" toggle; the first switch-on downloads the small wake model. */
function WakeWordRow({
  enabled,
  model,
  onToggle,
  onCancel,
  onRemove,
}: {
  enabled: boolean;
  model: VoicePackState;
  onToggle: (on: boolean) => void;
  onCancel: () => void;
  onRemove: () => void;
}) {
  const busy = model.status === 'downloading' || model.status === 'extracting';
  const subtitle =
    model.status === 'unsupported'
      ? 'Needs a development build (not available in Expo Go or on web)'
      : busy
        ? `${model.status === 'downloading' ? 'Downloading' : 'Unpacking'} wake model… ${Math.round(model.progress * 100)}%`
        : model.status === 'error'
          ? `Install failed: ${model.error ?? 'unknown error'}`
          : model.status === 'ready'
            ? 'Say “Hey Kurisu” while the voice link is open and idle'
            : `Say “Hey Kurisu” to talk hands-free · ${formatBytes(WAKE_MODEL.sizeBytes)} on-device model`;
  return (
    <View className="py-4">
      <View className="flex-row items-center justify-between">
        <View className="flex-1 pr-4">
          <Text className="text-[15.5px] font-medium" style={{ color: HUD.text }}>
            Wake word
          </Text>
          <Text
            className="mt-0.5 text-[12.5px]"
            style={{ color: model.status === 'error' ? HUD.warn : HUD.textMuted }}
          >
            {subtitle}
          </Text>
        </View>
        {busy ? (
          <Pressable onPress={onCancel} hitSlop={8} className="active:opacity-75">
            <Text style={[MONO, { color: HUD.warn }]} className="text-[11px] tracking-[2px]">
              CANCEL
            </Text>
          </Pressable>
        ) : (
          <ToggleSwitch
            value={enabled && model.status === 'ready'}
            onValueChange={(v) => model.status !== 'unsupported' && onToggle(v)}
          />
        )}
      </View>
      {model.status === 'ready' && !enabled && (
        <Pressable onPress={onRemove} hitSlop={8} className="mt-2 self-start active:opacity-75">
          <Text style={[MONO, { color: HUD.textDim }]} className="text-[10.5px] tracking-[1.5px]">
            REMOVE MODEL
          </Text>
        </Pressable>
      )}
    </View>
  );
}

/** On-device anime-style voice (Kokoro): toggling it on downloads the model the first time. */
function NeuralVoiceRow({
  enabled,
  model,
  onToggle,
  onCancel,
  onRemove,
}: {
  enabled: boolean;
  model: VoicePackState;
  onToggle: (on: boolean) => void;
  onCancel: () => void;
  onRemove: () => void;
}) {
  const busy = model.status === 'downloading' || model.status === 'extracting';
  const subtitle =
    model.status === 'unsupported'
      ? 'Needs a development build (not available in Expo Go or on web)'
      : busy
        ? `${model.status === 'downloading' ? 'Downloading' : 'Unpacking'} voice model… ${Math.round(model.progress * 100)}%`
        : model.status === 'error'
          ? `Install failed: ${model.error ?? 'unknown error'}`
          : model.status === 'ready'
            ? 'Expressive on-device voice. Works offline'
            : `Expressive anime-style voice · ${formatBytes(NEURAL_MODEL.sizeBytes)} download, works offline`;
  return (
    <View className="py-4">
      <View className="flex-row items-center justify-between">
        <View className="flex-1 pr-4">
          <Text className="text-[15.5px] font-medium" style={{ color: HUD.text }}>
            Neural voice
          </Text>
          <Text
            className="mt-0.5 text-[12.5px]"
            style={{ color: model.status === 'error' ? HUD.warn : HUD.textMuted }}
          >
            {subtitle}
          </Text>
        </View>
        {busy ? (
          <Pressable onPress={onCancel} hitSlop={8} className="active:opacity-75">
            <Text style={[MONO, { color: HUD.warn }]} className="text-[11px] tracking-[2px]">
              CANCEL
            </Text>
          </Pressable>
        ) : (
          <ToggleSwitch
            value={enabled && model.status === 'ready'}
            onValueChange={(v) => model.status !== 'unsupported' && onToggle(v)}
          />
        )}
      </View>
      {model.status === 'ready' && !enabled && (
        <Pressable onPress={onRemove} hitSlop={8} className="mt-2 self-start active:opacity-75">
          <Text style={[MONO, { color: HUD.textDim }]} className="text-[10.5px] tracking-[1.5px]">
            REMOVE MODEL
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const LOCAL_SIZE = Platform.OS === 'ios' ? LOCAL_MODEL.sizeBytes.ios : LOCAL_MODEL.sizeBytes.android;

/** On-device brain: download / pause / remove the model. */
function LocalBrainCard({
  model,
  onInstall,
  onCancel,
  onRemove,
}: {
  model: VoicePackState;
  onInstall: () => void;
  onCancel: () => void;
  onRemove: () => void;
}) {
  const ready = model.status === 'ready';
  const downloading = model.status === 'downloading';
  const status =
    model.status === 'unsupported'
      ? '○ NEEDS A DEVELOPMENT BUILD'
      : ready
        ? '● DOWNLOADED · RUNS OFFLINE'
        : downloading
          ? `↓ DOWNLOADING · ${Math.round(model.progress * 100)}%`
          : model.status === 'error'
            ? '✕ DOWNLOAD FAILED'
            : `○ NOT DOWNLOADED · ${formatBytes(LOCAL_SIZE)}`;
  return (
    <HudFrame className="p-4">
      <HudFrame
        corner={8}
        color={ready ? HUD.holo : HUD.line}
        style={{ backgroundColor: ready ? HUD.holoSoft : HUD.bg, borderColor: HUD.holoDeep }}
        className="p-3.5"
      >
        <Text className="text-[15.5px] font-semibold" style={{ color: HUD.text }}>
          {LOCAL_MODEL.name}
        </Text>
        <Text style={[MONO, { color: HUD.textMuted }]} className="mt-1 text-[9.5px] tracking-[0.5px]">
          {LOCAL_MODEL.tagline}
        </Text>
        <Text
          style={[MONO, { color: ready ? HUD.ok : model.status === 'error' ? HUD.crimson : HUD.textDim }]}
          className="mt-1 text-[9px] tracking-[1px]"
        >
          {status}
        </Text>
        {downloading && (
          <View className="mt-2.5 h-[3px]" style={{ backgroundColor: HUD.lineDim }}>
            <View className="h-full" style={{ width: `${Math.round(model.progress * 100)}%`, backgroundColor: HUD.holo }} />
          </View>
        )}
      </HudFrame>

      <View className="mt-4 gap-3">
        {model.status === 'error' && model.error && (
          <Text style={[MONO, { color: HUD.crimson }]} className="text-[10.5px]">
            {model.error}
          </Text>
        )}
        {ready ? (
          <>
            <Text className="text-[12.5px]" style={{ color: HUD.textMuted }}>
              She thinks entirely on your phone, even offline. Nothing you say leaves the device.
            </Text>
            <Pressable onPress={onRemove} className="items-center py-3 active:opacity-80" style={{ borderWidth: 1, borderColor: HUD.crimson }}>
              <Text style={[MONO, { color: HUD.crimson }]} className="text-[11px] tracking-[2px]">
                REMOVE MODEL
              </Text>
            </Pressable>
          </>
        ) : model.status === 'unsupported' ? (
          <Text className="text-[12.5px]" style={{ color: HUD.textMuted }}>
            The on-device brain uses native ExecuTorch code, so it only runs in a development build (not in Expo Go or on web).
          </Text>
        ) : downloading ? (
          <Pressable onPress={onCancel} className="items-center py-3 active:opacity-80" style={{ borderWidth: 1, borderColor: HUD.warn }}>
            <Text style={[MONO, { color: HUD.warn }]} className="text-[11px] tracking-[2px]">
              PAUSE DOWNLOAD
            </Text>
          </Pressable>
        ) : (
          <>
            <Text className="text-[12.5px]" style={{ color: HUD.textMuted }}>
Kurisu needs her brain before she can talk: a small language model that runs on your phone, offline. Nothing you say leaves the device. Works best on recent phones with plenty of RAM.
            </Text>
            <Pressable onPress={onInstall} className="items-center py-3 active:opacity-85" style={{ backgroundColor: HUD.holo }}>
              <Text style={[MONO, { color: HUD.onHolo }]} className="text-[11px] font-bold tracking-[2px]">
                {model.status === 'error' ? 'RETRY DOWNLOAD' : `DOWNLOAD · ${formatBytes(LOCAL_SIZE)}`}
              </Text>
            </Pressable>
          </>
        )}
      </View>
    </HudFrame>
  );
}

/** A slider over [min, max] (AttitudeSlider works in 0..1). */
function TuneSlider({
  title,
  value,
  min,
  max,
  format,
  lowLabel,
  highLabel,
  disabled,
  onChange,
}: {
  title: string;
  value: number;
  min: number;
  max: number;
  format: (v: number) => string;
  lowLabel: string;
  highLabel: string;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <View className="py-3" style={disabled ? { opacity: 0.4 } : undefined} pointerEvents={disabled ? 'none' : 'auto'}>
      <View className="mb-1 flex-row items-center justify-between">
        <Text className="text-[14.5px] font-medium" style={{ color: HUD.text }}>
          {title}
        </Text>
        <Text style={[MONO, { color: HUD.holo }]} className="text-[11px] tracking-[2px]">
          {format(value)}
        </Text>
      </View>
      <AttitudeSlider
        value={(value - min) / (max - min)}
        onChange={(ratio) => onChange(Math.round((min + ratio * (max - min)) * 100) / 100)}
      />
      <View className="mt-1 flex-row items-center justify-between">
        <Text style={[MONO, { color: HUD.textDim }]} className="text-[9.5px] tracking-[1.5px]">
          {lowLabel}
        </Text>
        <Text style={[MONO, { color: HUD.textDim }]} className="text-[9.5px] tracking-[1.5px]">
          {highLabel}
        </Text>
      </View>
    </View>
  );
}

const sameTune = (a: VoiceTune, b: VoiceTune) =>
  Math.abs(a.pitch - b.pitch) < 0.01 && Math.abs(a.rate - b.rate) < 0.01 && Math.abs(a.expression - b.expression) < 0.01;

export default function SettingsScreen() {
  const {
    settings,
    updateSettings,
    clearChat,
    wakeModel,
    installWakeModel,
    cancelWakeModelInstall,
    removeWakeModel,
    localModel,
    installLocalModel,
    cancelLocalModelInstall,
    removeLocalModel,
    neuralModel,
    installNeuralModel,
    cancelNeuralModelInstall,
    removeNeuralModel,
  } = useAppState();
  const neuralOn = settings.neuralVoice && neuralModel.status === 'ready';
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [testState, setTestState] = useState<'idle' | 'loading' | 'playing'>('idle');

  // Safety net: never leave the button stuck if a TTS callback doesn't fire.
  useEffect(() => {
    if (testState === 'idle') return;
    const t = setTimeout(() => setTestState('idle'), 20000);
    return () => clearTimeout(t);
  }, [testState]);

  useEffect(() => {
    listVoices(settings.language).then(setVoices);
  }, [settings.language]);

  useEffect(
    () => () => {
      stopSpeaking();
      neuralVoice.unload(); // the call screen reloads it when it opens
    },
    []
  );

  // Android 12+ may delay timers by minutes unless exact alarms are allowed.
  const [exactAlarms, setExactAlarms] = useState(true);
  useEffect(() => {
    exactAlarmsAllowed().then(setExactAlarms);
  }, []);

  // voiceId undefined = auto (best-ranked voice). Cycling: auto → each voice → auto.
  const voiceIndex = settings.voiceId ? voices.findIndex((v) => v.identifier === settings.voiceId) : -1;
  const currentVoiceLabel = settings.voiceId
    ? (voices[voiceIndex]?.name ?? settings.voiceId)
    : voices[0]
      ? `AUTO · ${voices[0].name}`
      : 'SYSTEM DEFAULT';

  // Tuning applies instantly; a short sample plays once the slider stops moving.
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    },
    []
  );

  const neuralChoice = neuralVoiceById(settings.neuralVoiceId);
  const voiceLabel = neuralOn ? neuralChoice.label : currentVoiceLabel;

  const cycleVoice = () => {
    if (neuralOn) {
      const i = NEURAL_VOICES.findIndex((v) => v.id === neuralChoice.id);
      const next = NEURAL_VOICES[(i + 1) % NEURAL_VOICES.length];
      updateSettings({ neuralVoiceId: next.id });
      if (previewTimer.current) clearTimeout(previewTimer.current);
      // Let the user hear each voice as they cycle through.
      previewTimer.current = setTimeout(
        () => playSample(settings.language === 'English' ? 'Hmph. How about this one?' : 'Hmph. Ito ba?', settings.voiceTune, next.sid),
        450
      );
      return;
    }
    if (!voices.length) return;
    const next = voiceIndex + 1;
    updateSettings({ voiceId: next >= voices.length ? undefined : voices[next].identifier });
  };

  const playSample = (line: string, tune: VoiceTune, sid = neuralOn ? neuralChoice.sid : undefined) => {
    stopSpeaking();
    setTestState('loading');
    speak(line, {
      mood: 'confident',
      language: settings.language,
      voice: settings.voiceId ?? voices[0]?.identifier,
      tune,
      neuralSid: sid,
      onStart: () => setTestState((s) => (s === 'loading' ? 'playing' : s)),
      onDone: () => setTestState('idle'),
    });
  };

  const testVoice = () => {
    if (testState !== 'idle') {
      stopSpeaking();
      setTestState('idle'); // second tap = stop
      return;
    }
    playSample(
      settings.language === 'English'
        ? 'Hmph. You called me just to test my voice? Fine. I am Kurisu, and I am a genius.'
        : 'Hmph. Tinawag mo ako para lang i-test ang boses ko? Sige na nga. Ako si Kurisu.',
      settings.voiceTune
    );
  };

  const setTune = (patch: Partial<VoiceTune>) => {
    const next = { ...settings.voiceTune, ...patch };
    updateSettings({ voiceTune: next });
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(
      () => playSample(settings.language === 'English' ? 'Hmph. How about this?' : 'Hmph. Ganito ba?', next),
      550
    );
  };
  const activePreset = TUNE_PRESETS.find((p) => sameTune(p.tune, settings.voiceTune))?.id;

  const confirmDownloadLocal = () =>
    Alert.alert(
      'Download on-device brain?',
      `About ${formatBytes(LOCAL_SIZE)}. Use Wi-Fi if you can. A paused download resumes where it stopped.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Download', onPress: () => installLocalModel().catch(() => {}) },
      ]
    );

  const confirmRemoveLocal = () =>
    Alert.alert('Remove on-device brain?', `Frees about ${formatBytes(LOCAL_SIZE)}. She goes back to scripted replies until you download it again.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => removeLocalModel(),
      },
    ]);

  const confirmClearChat = () =>
    Alert.alert('Clear conversation?', 'Kurisu forgets the chat log. Lab notes are kept.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: clearChat },
    ]);

  return (
    <View className="flex-1" style={{ backgroundColor: HUD.bg }}>
      <GridBackground glowY="0%" />
      <SafeAreaView className="flex-1">
        {/* Header */}
        <View className="flex-row items-center gap-3 px-5 pb-3 pt-2">
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            accessibilityLabel="Back"
            className="h-9 w-7 items-center justify-center active:opacity-70"
          >
            <ChevronLeft size={24} color={HUD.text} />
          </Pressable>
          <View>
            <Text style={[MONO, { color: HUD.holo }]} className="text-[9.5px] tracking-[3px]">
              SYSTEM CONFIG
            </Text>
            <Text className="text-[24px] font-bold tracking-[0.3px]" style={{ color: HUD.text }}>
              Settings
            </Text>
          </View>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          className="flex-1 px-5"
          contentContainerStyle={{ paddingBottom: 32, paddingTop: 12 }}
        >
          {/* PERSONALITY */}
          <SectionLabel index="01" title="PERSONALITY" className="mb-3" />
          <HudFrame className="mb-7 p-4">
            <View className="mb-1 flex-row items-center justify-between">
              <Text className="text-[15.5px] font-medium" style={{ color: HUD.text }}>
                Attitude
              </Text>
              <Text style={[MONO, { color: HUD.holo }]} className="text-[11px] tracking-[2px]">
                {getAttitudeLabel(settings.attitude)} · {settings.attitude.toFixed(2)}
              </Text>
            </View>

            <AttitudeSlider
              value={settings.attitude}
              onChange={(attitude) => updateSettings({ attitude })}
            />

            <View className="mt-1 flex-row items-center justify-between">
              <Text style={[MONO, { color: HUD.textDim }]} className="text-[9.5px] tracking-[1.5px]">
                SWEET
              </Text>
              <Text style={[MONO, { color: HUD.textDim }]} className="text-[9.5px] tracking-[1.5px]">
                SHARP-TONGUED
              </Text>
            </View>

            <View className="my-4">
              <Divider />
            </View>

            <Text className="mb-3 text-[15.5px] font-medium" style={{ color: HUD.text }}>
              Language
            </Text>

            <View className="flex-row p-1" style={{ backgroundColor: HUD.bg, borderWidth: 1, borderColor: HUD.lineDim }}>
              {LANGUAGES.map((lang) => {
                const active = settings.language === lang;
                return (
                  <Pressable
                    key={lang}
                    onPress={() => updateSettings({ language: lang })}
                    className="flex-1 items-center py-2.5"
                    style={
                      active
                        ? { backgroundColor: HUD.holoSoft, borderBottomWidth: 2, borderColor: HUD.holo }
                        : undefined
                    }
                  >
                    <Text
                      style={[MONO, { color: active ? HUD.holo : HUD.textMuted }]}
                      className="text-[11px] tracking-[1.5px]"
                    >
                      {lang.toUpperCase()}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </HudFrame>

          {/* VOICE */}
          <SectionLabel index="02" title="VOICE" className="mb-3" />
          <HudFrame className="mb-7 px-4">
            <NeuralVoiceRow
              enabled={settings.neuralVoice}
              model={neuralModel}
              onToggle={async (on) => {
                if (!on) return updateSettings({ neuralVoice: false });
                if (neuralModel.status === 'ready') return updateSettings({ neuralVoice: true });
                try {
                  await installNeuralModel();
                  updateSettings({ neuralVoice: true });
                } catch {
                  // Status row shows the error.
                }
              }}
              onCancel={cancelNeuralModelInstall}
              onRemove={removeNeuralModel}
            />
            <Divider />
            <Pressable onPress={cycleVoice} className="flex-row items-center justify-between py-4 active:opacity-75">
              <View className="flex-1 pr-4">
                <Text className="text-[15.5px] font-medium" style={{ color: HUD.text }}>
                  Her voice
                </Text>
                <Text className="mt-0.5 text-[12.5px]" style={{ color: HUD.textMuted }}>
                  {neuralOn ? `${neuralChoice.hint} · tap to cycle` : 'Tap to cycle system voices'}
                </Text>
              </View>
              <Text
                style={[MONO, { color: HUD.holo }]}
                numberOfLines={1}
                className="max-w-[55%] text-[11px] tracking-[1px]"
              >
                {voiceLabel.toUpperCase()}
              </Text>
            </Pressable>
            <Divider />

            {/* Tuning */}
            <View className="pt-4">
              <View className="mb-3 flex-row items-center justify-between">
                <Text className="text-[15.5px] font-medium" style={{ color: HUD.text }}>
                  Voice tuning
                </Text>
                <Pressable onPress={() => setTune(DEFAULT_TUNE)} hitSlop={8} className="active:opacity-70">
                  <Text style={[MONO, { color: HUD.textMuted }]} className="text-[10px] tracking-[2px]">
                    RESET
                  </Text>
                </Pressable>
              </View>
              <View className="flex-row flex-wrap gap-2">
                {TUNE_PRESETS.map((preset) => {
                  const active = activePreset === preset.id;
                  return (
                    <Pressable
                      key={preset.id}
                      onPress={() => setTune(preset.tune)}
                      className="px-3 py-2 active:opacity-80"
                      style={{
                        borderWidth: 1,
                        borderColor: active ? HUD.holo : HUD.lineDim,
                        backgroundColor: active ? HUD.holoSoft : HUD.bg,
                      }}
                    >
                      <Text
                        style={[MONO, { color: active ? HUD.holo : HUD.textMuted }]}
                        className="text-[10.5px] tracking-[1.5px]"
                      >
                        {preset.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <TuneSlider
                title="Pitch"
                value={settings.voiceTune.pitch}
                {...VOICE_TUNE_LIMITS.pitch}
                format={(v) => `${v.toFixed(2)}×`}
                lowLabel="DEEP"
                highLabel="HIGH"
                onChange={(pitch) => setTune({ pitch })}
              />
              <TuneSlider
                title="Speed"
                value={settings.voiceTune.rate}
                {...VOICE_TUNE_LIMITS.rate}
                format={(v) => `${v.toFixed(2)}×`}
                lowLabel="SLOW"
                highLabel="FAST"
                onChange={(rate) => setTune({ rate })}
              />
              <TuneSlider
                title="Expression"
                value={settings.voiceTune.expression}
                {...VOICE_TUNE_LIMITS.expression}
                format={(v) => (v < 0.3 ? 'FLAT' : v < 0.8 ? 'SUBTLE' : v < 1.3 ? 'NATURAL' : 'ANIMATED')}
                lowLabel="MONOTONE"
                highLabel="EMOTIONAL"
                onChange={(expression) => setTune({ expression })}
              />
            </View>
            <Divider />
            <ToggleRow
              title="Push to talk"
              subtitle="Hold the core to talk (off: tap to talk)"
              value={settings.pushToTalk}
              onChange={(pushToTalk) => updateSettings({ pushToTalk })}
            />
            <Divider />
            <WakeWordRow
              enabled={settings.wakePhrase}
              model={wakeModel}
              onToggle={async (on) => {
                if (!on) return updateSettings({ wakePhrase: false });
                if (wakeModel.status === 'ready') return updateSettings({ wakePhrase: true });
                try {
                  await installWakeModel();
                  updateSettings({ wakePhrase: true });
                } catch {
                  // Status row shows the error.
                }
              }}
              onCancel={cancelWakeModelInstall}
              onRemove={() => {
                updateSettings({ wakePhrase: false });
                removeWakeModel();
              }}
            />
            <Divider />
            <ToggleRow
              title="Daily briefing"
              subtitle="She reports the time, schedule and reminders on your first call each day"
              value={settings.dailyBriefing}
              onChange={(dailyBriefing) => updateSettings({ dailyBriefing })}
            />
            <Divider />
            {Platform.OS === 'android' && !exactAlarms && (
              <>
                <Pressable
                  onPress={() => requestExactAlarms().then(setExactAlarms)}
                  className="flex-row items-center justify-between py-4 active:opacity-75"
                >
                  <View className="flex-1 pr-4">
                    <Text className="text-[15.5px] font-medium" style={{ color: HUD.text }}>
                      Exact timers
                    </Text>
                    <Text className="mt-0.5 text-[12.5px]" style={{ color: HUD.warn }}>
                      Android may ring her timers minutes late until you allow exact alarms
                    </Text>
                  </View>
                  <Text style={[MONO, { color: HUD.holo }]} className="text-[11px] tracking-[2px]">
                    ALLOW
                  </Text>
                </Pressable>
                <Divider />
              </>
            )}
            <ToggleRow
              title="Mood haptics"
              subtitle="Light buzz when her mood shifts"
              value={settings.moodHaptics}
              onChange={(moodHaptics) => updateSettings({ moodHaptics })}
            />
            <Divider />
            <Pressable onPress={testVoice} className="flex-row items-center justify-between py-4 active:opacity-75">
              <View className="flex-1 pr-4">
                <Text className="text-[15.5px] font-medium" style={{ color: HUD.text }}>
                  Test voice
                </Text>
                <Text className="mt-0.5 text-[12.5px]" style={{ color: HUD.textMuted }}>
                  System voice
                </Text>
              </View>
              {testState === 'loading' ? (
                <View className="flex-row items-center gap-2">
                  <ActivityIndicator size="small" color={HUD.holo} />
                  <Text style={[MONO, { color: HUD.textMuted }]} className="text-[11px] tracking-[2px]">
                    LOADING
                  </Text>
                </View>
              ) : (
                <Text style={[MONO, { color: HUD.holo }]} className="text-[11px] tracking-[2px]">
                  {testState === 'playing' ? '■ STOP' : '▶ PLAY'}
                </Text>
              )}
            </Pressable>
          </HudFrame>

          {/* BRAIN */}
          <SectionLabel index="03" title="BRAIN · ON-DEVICE" className="mb-3" />
          <LocalBrainCard
            model={localModel}
            onInstall={confirmDownloadLocal}
            onCancel={cancelLocalModelInstall}
            onRemove={confirmRemoveLocal}
          />

          {/* DATA */}
          <SectionLabel index="04" title="DATA" className="mb-3 mt-7" />
          <HudFrame className="px-4">
            <Pressable onPress={confirmClearChat} className="flex-row items-center justify-between py-4 active:opacity-75">
              <Text className="text-[15.5px] font-medium" style={{ color: HUD.text }}>
                Clear conversation
              </Text>
              <Text style={[MONO, { color: HUD.crimson }]} className="text-[11px] tracking-[2px]">
                RESET
              </Text>
            </Pressable>
          </HudFrame>

          <Text style={[MONO, { color: HUD.textDim }]} className="mt-8 text-center text-[9.5px] tracking-[2px]">
            BUILD 0.1.0 · LAB-01
          </Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
