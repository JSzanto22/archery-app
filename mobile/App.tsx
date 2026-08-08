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

import { AuthProvider } from './src/auth/AuthProvider';
import { config } from './src/config';
import { collections } from './src/db';
import { runSync } from './src/db/sync';
import { ensurePresetTargets } from './src/db/bootstrap';
import { clearAllSessions, seedDemoData } from './src/db/devSeed';
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

        if (__DEV__) {
          // Handles for the browser console and automated checks, so demo data
          // can be loaded without tapping through the UI. Statically imported:
          // a dynamic import here leaves Metro's web graph unable to resolve
          // the chunk after a fast refresh.
          Object.assign(globalThis, {
            __seedDemo: seedDemoData,
            __clearSessions: clearAllSessions,
            __collections: collections,
            // Lets sync be exercised from the console against a local backend,
            // without needing an account or a tap.
            __sync: () =>
              runSync({
                apiBaseUrl: config.apiBaseUrl,
                getAccessToken: async () => 'dev',
              }),
          });
        }

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
      <AuthProvider>
        <SafeAreaProvider>
          <StatusBar style="auto" />
          <Navigation />
        </SafeAreaProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
});
