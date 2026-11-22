import { Link, Stack } from 'expo-router';
import { Text, View } from 'react-native';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Oops!' }} />
      <View className="flex-1 items-center justify-center bg-[#04070D] p-5">
        <Text className="text-[20px] font-bold text-[#F8FAFC]">
          This screen doesn&apos;t exist.
        </Text>

        <Link href="/" className="mt-4 py-3">
          <Text className="text-[14px] text-[#4FD8FF]">Go to home screen!</Text>
        </Link>
      </View>
    </>
  );
}
