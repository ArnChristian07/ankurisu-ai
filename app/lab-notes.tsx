import { router } from 'expo-router';
import { ChevronLeft, Trash2 } from 'lucide-react-native';
import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, Share, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GridBackground } from '@/components/GridBackground';
import { HudFrame } from '@/components/hud/HudFrame';
import { HudRing } from '@/components/hud/HudRing';
import { SegmentBar } from '@/components/hud/SegmentBar';
import { HUD, MONO } from '@/constants/theme';
import { NoteCategory, useAppState } from '@/context/AppContext';

type FilterTab = 'All' | NoteCategory;

const FILTER_TABS: FilterTab[] = ['All', 'About you', 'Projects', 'Reminders'];

const CATEGORY_COLORS: Record<NoteCategory, string> = {
  'About you': HUD.holo,
  Projects: HUD.ok,
  Reminders: HUD.warn,
};

function affinityRank(value: number) {
  if (value < 30) return 'ACQUAINTANCE';
  if (value < 55) return 'COLLEAGUE';
  if (value < 80) return 'LAB PARTNER';
  return 'TRUSTED';
}

export default function LabNotesScreen() {
  const { affinity, notes, deleteNote, forgetAllNotes } = useAppState();
  const [activeTab, setActiveTab] = useState<FilterTab>('All');

  const filteredNotes =
    activeTab === 'All' ? notes : notes.filter((n) => n.category === activeTab);

  const handleExport = async () => {
    if (notes.length === 0) {
      Alert.alert('Nothing to export', 'Kurisu hasn’t written any lab notes yet.');
      return;
    }
    const payload = JSON.stringify({ app: 'ankurisu', exportedAt: new Date().toISOString(), affinity, notes }, null, 2);
    try {
      await Share.share({ title: 'AnKurisu lab notes', message: payload });
    } catch {
      Alert.alert('Export failed', 'Could not open the share sheet.');
    }
  };

  const handleForgetAll = () => {
    if (notes.length === 0) return;
    Alert.alert(
      'Forget all lab notes?',
      'This will clear all locally stored memory entries on this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Forget all', style: 'destructive', onPress: forgetAllNotes },
      ]
    );
  };

  return (
    <View className="flex-1" style={{ backgroundColor: HUD.bg }}>
      <GridBackground glowY="5%" />
      <SafeAreaView className="flex-1">
        {/* Header */}
        <View className="flex-row items-center justify-between px-5 pb-3 pt-2">
          <View className="flex-row items-center gap-3">
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
                MEMORY BANK
              </Text>
              <Text className="text-[24px] font-bold tracking-[0.3px]" style={{ color: HUD.text }}>
                Lab notes
              </Text>
            </View>
          </View>

          <Text style={[MONO, { color: HUD.textMuted }]} className="text-[10.5px] tracking-[1.5px]">
            {notes.length.toString().padStart(3, '0')} {notes.length === 1 ? 'ENTRY' : 'ENTRIES'}
          </Text>
        </View>

        <View className="flex-1 px-5">
          {/* Affinity */}
          <HudFrame label="AFFINITY" meta={affinityRank(affinity)} className="mt-3 flex-row items-center gap-4 p-4 pt-5">
            <View style={{ width: 74, height: 74 }} className="items-center justify-center">
              <HudRing size={74} strokeWidth={1} opacity={0.25} />
              <HudRing size={74} strokeWidth={3} progress={affinity / 100} />
              <HudRing size={58} strokeWidth={1} ticks={30} tickLength={2} duration={24000} opacity={0.45} />
              <Text style={[MONO, { color: HUD.text }]} className="text-[18px]">
                {affinity}
              </Text>
            </View>
            <View className="flex-1">
              <SegmentBar value={affinity / 100} segments={20} height={7} />
              <Text className="mt-2.5 text-[13px] leading-[19px]" style={{ color: HUD.textMuted }}>
                She teases more and opens up about her own “research” as affinity rises.
              </Text>
            </View>
          </HudFrame>

          {/* Filters */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="my-5 max-h-10 flex-grow-0"
            contentContainerStyle={{ gap: 8, alignItems: 'center', paddingHorizontal: 1 }}
          >
            {FILTER_TABS.map((tab) => {
              const isActive = activeTab === tab;
              return (
                <Pressable key={tab} onPress={() => setActiveTab(tab)}>
                  <HudFrame
                    corner={6}
                    color={isActive ? HUD.holo : HUD.line}
                    style={isActive ? { backgroundColor: HUD.holoSoft, borderColor: HUD.holoDeep } : undefined}
                    className="px-3.5 py-2"
                  >
                    <Text
                      style={[MONO, { color: isActive ? HUD.holo : HUD.textMuted }]}
                      className="text-[10.5px] tracking-[1.5px]"
                    >
                      {tab.toUpperCase()}
                    </Text>
                  </HudFrame>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Notes */}
          <ScrollView
            showsVerticalScrollIndicator={false}
            className="flex-1"
            contentContainerStyle={{ gap: 10, paddingBottom: 16 }}
          >
            {filteredNotes.length === 0 ? (
              <View className="mt-10 items-center">
                <Text style={[MONO, { color: HUD.textDim }]} className="text-[11px] tracking-[2px]">
                  — NO ENTRIES IN THIS SECTOR —
                </Text>
              </View>
            ) : (
              filteredNotes.map((note, idx) => {
                const color = CATEGORY_COLORS[note.category];
                return (
                  <Animated.View
                    key={note.id}
                    // Stagger only the first few: with 100 notes an uncapped delay kept cards
                    // animating in for 4 s, and replayed on every filter change.
                    entering={idx < 8 ? FadeInDown.delay(idx * 40).duration(220) : undefined}
                    exiting={FadeOut.duration(180)}
                    layout={LinearTransition.springify()}
                    className="flex-row overflow-hidden"
                    style={{ backgroundColor: HUD.panel, borderWidth: 1, borderColor: HUD.lineDim }}
                  >
                    <View style={{ width: 3, backgroundColor: color }} />
                    <View className="flex-1 p-4">
                      <View className="mb-2 flex-row items-center justify-between">
                        <Text style={[MONO, { color }]} className="text-[10px] tracking-[1.5px]">
                          #{note.id.replace(/\D/g, '').padStart(3, '0')} · {note.category.toUpperCase()}
                          <Text style={{ color: HUD.textDim }}> · {note.timestamp}</Text>
                        </Text>
                        <Pressable
                          onPress={() => deleteNote(note.id)}
                          hitSlop={10}
                          accessibilityLabel="Delete note"
                          className="p-1 active:opacity-60"
                        >
                          <Trash2 size={15} color={HUD.textDim} />
                        </Pressable>
                      </View>
                      <Text className="text-[15px] leading-[22px]" style={{ color: '#DCEBF7' }}>
                        {note.content}
                      </Text>
                    </View>
                  </Animated.View>
                );
              })
            )}
          </ScrollView>
        </View>

        {/* Footer */}
        <View
          className="flex-row items-center gap-3 px-5 pb-4 pt-3"
          style={{ borderTopWidth: 1, borderColor: HUD.lineDim }}
        >
          <Pressable onPress={handleExport} className="flex-1 active:opacity-80">
            <HudFrame corner={8} color={HUD.holoDim} className="items-center py-3.5">
              <Text style={[MONO, { color: HUD.text }]} className="text-[11.5px] tracking-[1.5px]">
                EXPORT BACKUP .JSON
              </Text>
            </HudFrame>
          </Pressable>

          <Pressable onPress={handleForgetAll} className="active:opacity-80">
            <HudFrame
              corner={8}
              color={HUD.crimson}
              style={{ backgroundColor: HUD.crimsonSoft, borderColor: '#4A1620' }}
              className="items-center px-5 py-3.5"
            >
              <Text style={[MONO, { color: HUD.crimson }]} className="text-[11.5px] tracking-[1.5px]">
                FORGET ALL
              </Text>
            </HudFrame>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}
