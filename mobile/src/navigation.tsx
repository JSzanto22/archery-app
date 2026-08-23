import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useAuth } from './auth/AuthProvider';
import AccountScreen from './screens/AccountScreen';
import ConfirmCodeScreen from './screens/auth/ConfirmCodeScreen';
import ForgotPasswordScreen from './screens/auth/ForgotPasswordScreen';
import SignInScreen from './screens/auth/SignInScreen';
import SignUpScreen from './screens/auth/SignUpScreen';
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
  Account: undefined;
};

export type AuthStackParamList = {
  SignIn: undefined;
  SignUp: undefined;
  ConfirmCode: { email: string };
  /** Pre-filled from the sign-in form when the archer got that far. */
  ForgotPassword: { email?: string } | undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const AuthStack = createNativeStackNavigator<AuthStackParamList>();

export default function Navigation() {
  const palette = usePalette();
  const auth = useAuth();

  const screenOptions = {
    headerStyle: { backgroundColor: palette.page },
    headerTintColor: palette.textPrimary,
    headerTitleStyle: { fontFamily: fonts.heading, fontSize: 17 },
    headerShadowVisible: false,
    contentStyle: { backgroundColor: palette.page },
  };

  /*
   * Hold the navigator until the stored session has been read.
   *
   * Without this the sign-in screen renders for the moment it takes to read
   * the keychain, then vanishes — so every cold start flashes a login form at
   * an archer who is already signed in.
   */
  if (auth.isRestoring) {
    return (
      <View style={[styles.centre, { backgroundColor: palette.page }]}>
        <ActivityIndicator color={palette.accent} />
      </View>
    );
  }

  return (
    <NavigationContainer>
      {auth.isSignedIn ? (
        <Stack.Navigator screenOptions={screenOptions}>
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
          <Stack.Screen
            name="Account"
            component={AccountScreen}
            options={{ title: 'Account' }}
          />
        </Stack.Navigator>
      ) : (
        /*
         * A separate navigator, not a screen inside the main one.
         *
         * Swapping the whole tree on sign-out drops the main stack's history
         * with it, so the next archer to sign in on this phone cannot reach
         * the previous one's session detail by pressing back.
         */
        <AuthStack.Navigator screenOptions={screenOptions}>
          <AuthStack.Screen
            name="SignIn"
            component={SignInScreen}
            options={{ headerShown: false }}
          />
          <AuthStack.Screen
            name="SignUp"
            component={SignUpScreen}
            options={{ title: 'Create account' }}
          />
          <AuthStack.Screen
            name="ConfirmCode"
            component={ConfirmCodeScreen}
            options={{ title: 'Confirm' }}
          />
          <AuthStack.Screen
            name="ForgotPassword"
            component={ForgotPasswordScreen}
            options={{ title: 'Reset password' }}
          />
        </AuthStack.Navigator>
      )}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
