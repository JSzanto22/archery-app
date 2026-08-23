/**
 * Create an account.
 *
 * The password rule is stated up front rather than after a rejected attempt.
 * Cognito's own message arrives only once the form has been submitted and
 * cleared, which is a needless second trip for something we already know.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../auth/AuthProvider';
import { authErrorMessage } from '../../auth/authErrors';
import { Banner, Button, Screen, TextField } from '../../components/ui';
import type { AuthStackParamList } from '../../navigation';
import { spacing, type, usePalette } from '../../theme';

type Props = NativeStackScreenProps<AuthStackParamList, 'SignUp'>;

/** Mirrors the pool's policy in infra/lib/auth-stack.ts. */
const MIN_PASSWORD_LENGTH = 12;

/**
 * Checked here as well as by Cognito.
 *
 * Not a security boundary — the pool enforces the real rule — but it turns a
 * round trip and a cleared form into an inline message.
 */
function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (!/[a-z]/.test(password)) return 'Include a lowercase letter.';
  if (!/[A-Z]/.test(password)) return 'Include an uppercase letter.';
  if (!/[0-9]/.test(password)) return 'Include a number.';
  return null;
}

export default function SignUpScreen({ navigation }: Props) {
  const palette = usePalette();
  const auth = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const problem = passwordProblem(password);
  const canSubmit = email.trim().length > 0 && problem === null && !busy;

  async function submit() {
    setError(null);
    setBusy(true);

    try {
      const step = await auth.signUp(email.trim(), password);

      if (step === 'confirmSignUp') {
        navigation.navigate('ConfirmCode', { email: email.trim() });
        return;
      }

      if (step === 'done') {
        // A pool with verification off would land here. Nothing to confirm,
        // so send them to sign in rather than to a code screen with no code.
        navigation.navigate('SignIn');
        return;
      }

      setError('This account needs a step the app does not support yet.');
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Text style={[type.title, styles.title, { color: palette.textPrimary }]}>
        Create an account
      </Text>
      <Text style={[type.body, styles.blurb, { color: palette.textSecondary }]}>
        Your sessions stay on this phone. An account is what lets them follow
        you to a new one.
      </Text>

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
        hint="We send a confirmation code here."
      />

      <TextField
        label="Password"
        value={password}
        onChangeText={(next) => {
          setPassword(next);
          setTouched(true);
        }}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        editable={!busy}
        // Only complain once they have started typing. A rule shown as an
        // error before the first keystroke reads as a failure they caused.
        error={touched ? problem : null}
        hint={`At least ${MIN_PASSWORD_LENGTH} characters, with an uppercase letter and a number.`}
      />

      <Button
        label={busy ? 'Creating…' : 'Create account'}
        variant="filled"
        block
        disabled={!canSubmit}
        onPress={() => void submit()}
      />

      <View style={styles.links}>
        <Button
          label="I already have an account"
          onPress={() => navigation.navigate('SignIn')}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { marginTop: spacing.lg, marginBottom: spacing.xs },
  blurb: { marginBottom: spacing.lg },
  links: { marginTop: spacing.sm, alignItems: 'center' },
});
