import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';

import DashboardScreen from './screens/DashboardScreen';
import MarkingScreen from './screens/MarkingScreen';
import NewSessionScreen from './screens/NewSessionScreen';
import SessionDetailScreen from './screens/SessionDetailScreen';
import { fonts, usePalette } from './theme';

export type RootStackParamList = {
  Dashboard: undefined;
  NewSession: undefined;
  Marking: { sessionId: string; roundId: string };
  SessionDetail: { sessionId: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function Navigation() {
  const palette = usePalette();

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: palette.page },
          headerTintColor: palette.textPrimary,
          headerTitleStyle: { fontFamily: fonts.heading, fontSize: 17 },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: palette.page },
        }}
      >
        <Stack.Screen
          name="Dashboard"
          component={DashboardScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="NewSession"
          component={NewSessionScreen}
          options={{ title: 'New session' }}
        />
        <Stack.Screen
          name="Marking"
          component={MarkingScreen}
          options={{ title: 'Mark arrows' }}
        />
        <Stack.Screen
          name="SessionDetail"
          component={SessionDetailScreen}
          options={{ title: 'Session' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
