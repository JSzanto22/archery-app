/**
 * Sign in.
 *
 * Native form rather than Cognito's hosted UI. The hosted UI is a browser
 * redirect with Amazon's styling, which would be a visible seam in an app that
 * has an identity of its own — and the redesign would have no reach into it.
 * The trade is four simple screens now; the hosted UI becomes worth it only
 * when Google and Apple sign-in arrive, which is a later phase.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../auth/AuthProvider';
import { authErrorMessage } from '../../auth/authErrors';
import {
  Banner,
  Button,
  Roundel,
  Screen,
  TextField,
} from '../../components/ui';
import type { AuthStackParamList } from '../../navigation';
import { fonts, spacing, type, usePalette } from '../../theme';

type Props = NativeStackScreenProps<AuthStackParamList, 'SignIn'>;

export default function SignInScreen({ navigation }: Props) {
  const palette = usePalette();
  const auth = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

  async function submit() {
    setError(null);
    setBusy(true);

    try {
      const step = await auth.signIn(email.trim(), password);

      if (step === 'confirmSignUp') {
        // Signed up but never confirmed. Send them to the code screen rather
        // than telling them off — the account exists, it just needs finishing.
        navigation.navigate('ConfirmCode', { email: email.trim() });
        return;
      }

      if (step === 'unsupported') {
        setError(
          'This account needs a sign-in step the app does not support yet.',
        );
        return;
      }

      // On success the navigator swaps to the main stack on its own, because
      // it is gated on isSignedIn. Nothing to navigate to from here.
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={styles.header}>
        {/* Decorative: the app's motif, a gold ten. Hidden from screen
            readers, which would otherwise announce a bare "10" above the
            sign-in form. */}
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Roundel value="10" size={64} />
        </View>
        <Text
          style={[type.display, styles.title, { color: palette.textPrimary }]}
        >
          Archery
        </Text>
        <Text style={[type.body, { color: palette.textSecondary }]}>
          Sign in to keep your practice across devices.
        </Text>
      </View>

      {error ? (
        <Banner tone="error" message={error} onDismiss={() => setError(null)} />
      ) : null}

      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        placeholder="you@example.com"
        editable={!busy}
      />

      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="current-password"
        textContentType="password"
        editable={!busy}
        // Submitting from the keyboard matters here: the button is below the
        // fold once the keyboard is up on a small phone.
        returnKeyType="go"
        onSubmitEditing={() => {
          if (canSubmit) void submit();
        }}
      />

      <Button
        label={busy ? 'Signing in…' : 'Sign in'}
        variant="filled"
        block
        disabled={!canSubmit}
        onPress={() => void submit()}
      />

      <View style={styles.links}>
        <Button
          label="Forgot password?"
          onPress={() =>
            navigation.navigate('ForgotPassword', { email: email.trim() })
          }
        />
        <Button
          label="Create an account"
          onPress={() => navigation.navigate('SignUp')}
        />
      </View>

      <Text style={[type.label, styles.footnote, { color: palette.textMuted }]}>
        Sessions you record are stored on this phone first, and sync when you
        have signal.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  title: { fontFamily: fonts.display, marginTop: spacing.sm },
  links: {
    marginTop: spacing.sm,
    alignItems: 'center',
    gap: spacing.xs,
  },
  footnote: { textAlign: 'center', marginTop: spacing.lg },
});
