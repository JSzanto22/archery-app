import {
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
  useFonts,
} from '@expo-google-fonts/space-grotesk';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ensurePresetTargets } from './src/db/bootstrap';
import Navigation from './src/navigation';
import { usePalette } from './src/theme';

export default function App() {
  const palette = usePalette();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The display face. Headings render nothing until it arrives — a flash of
  // system font would undercut the identity on every cold start.
  const [fontsLoaded] = useFonts({
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
  });

  useEffect(() => {
    (async () => {
      try {
        // Bundled World Archery faces must exist before the first session can
        // be scored, and must not depend on having reached the network.
        await ensurePresetTargets();
        setReady(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  if (error) {
    return (
      <View style={[styles.centre, { backgroundColor: palette.page }]}>
        <Text style={{ color: palette.critical, textAlign: 'center' }}>
          Could not open the local database.{'\n'}
          {error}
        </Text>
      </View>
    );
  }

  if (!ready || !fontsLoaded) {
    return (
      <View style={[styles.centre, { backgroundColor: palette.page }]}>
        <ActivityIndicator color={palette.accent} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={styles.fill}>
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <Navigation />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
});
