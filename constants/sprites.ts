import { ImageSourcePropType } from 'react-native';

export type KurisuMood =
  | 'happy'
  | 'curious'
  | 'flustered'
  | 'confident'
  | 'explaining'
  | 'neutral'
  | 'sad'
  | 'serious'
  | 'shocked'
  | 'shy'
  | 'angry'
  | 'smug'
  | 'excited'
  | 'sleepy'
  | 'laughing'
  | 'pouting';

export const SPRITE_MAP: Record<KurisuMood, ImageSourcePropType> = {
  happy: require('@/assets/images/sprites/ankurisu-smile.png'),
  curious: require('@/assets/images/sprites/ankurisu-thinking.png'),
  flustered: require('@/assets/images/sprites/ankurisu-flustered.png'),
  confident: require('@/assets/images/sprites/ankurisu-confident.png'),
  explaining: require('@/assets/images/sprites/ankurisu-explaining.png'),
  neutral: require('@/assets/images/sprites/ankurisu-neutral.png'),
  sad: require('@/assets/images/sprites/ankurisu-sad.png'),
  serious: require('@/assets/images/sprites/ankurisu-serious.png'),
  shocked: require('@/assets/images/sprites/ankurisu-shocked.png'),
  shy: require('@/assets/images/sprites/ankurisu-shy.png'),
  angry: require('@/assets/images/sprites/ankurisu-angry.png'),
  smug: require('@/assets/images/sprites/ankurisu-smug.png'),
  excited: require('@/assets/images/sprites/ankurisu-excited.png'),
  sleepy: require('@/assets/images/sprites/ankurisu-sleepy.png'),
  laughing: require('@/assets/images/sprites/ankurisu-laughing.png'),
  pouting: require('@/assets/images/sprites/ankurisu-pouting.png'),
};

export const MOOD_COLORS: Record<KurisuMood, string> = {
  happy: '#53C4F7',
  curious: '#34D399',
  flustered: '#F472B6',
  confident: '#38BDF8',
  explaining: '#60A5FA',
  neutral: '#94A3B8',
  sad: '#818CF8',
  serious: '#F59E0B',
  shocked: '#FB7185',
  shy: '#F472B6',
  angry: '#EF4444',
  smug: '#A78BFA',
  excited: '#FBBF24',
  sleepy: '#A5B4FC',
  laughing: '#4ADE80',
  pouting: '#FB923C',
};

export const MOOD_LIST: KurisuMood[] = [
  'happy',
  'curious',
  'flustered',
  'explaining',
  'confident',
  'shy',
  'serious',
  'shocked',
  'sad',
  'neutral',
  'angry',
  'smug',
  'excited',
  'sleepy',
  'laughing',
  'pouting',
];
