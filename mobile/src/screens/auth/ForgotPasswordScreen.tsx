/**
 * Reset a forgotten password.
 *
 * Two steps on one screen. Splitting them across routes would mean a back
 * button that silently invalidates the code the archer is holding, and there
 * is not enough on either half to justify its own screen.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../auth/AuthProvider';
import { authErrorMessage } from '../../auth/authErrors';
import { Banner, Button, Screen, TextField } from '../../components/ui';
import type { AuthStackParamList } from '../../navigation';
import { spacing, type, usePalette } from '../../theme';

type Props = NativeStackScreenProps<AuthStackParamList, 'ForgotPassword'>;

const CODE_LENGTH = 6;
const MIN_PASSWORD_LENGTH = 12;

type Stage = 'request' | 'confirm';

export default function ForgotPasswordScreen({ navigation, route }: Props) {
  const palette = usePalette();
  const auth = useAuth();

  const [email, setEmail] = useState(route.params?.email ?? '');
  const [stage, setStage] = useState<Stage>('request');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function request() {
    setError(null);
    setBusy(true);

    try {
      await auth.requestPasswordReset(email.trim());
      setStage('confirm');
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setError(null);
    setBusy(true);

    try {
      await auth.confirmPasswordReset(email.trim(), code, password);
      navigation.navigate('SignIn');
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Text style={[type.title, styles.title, { color: palette.textPrimary }]}>
        Reset your password
      </Text>
      <Text style={[type.body, styles.blurb, { color: palette.textSecondary }]}>
        {stage === 'request'
          ? 'We will email you a code.'
          : `Enter the code sent to ${email.trim()} and choose a new password.`}
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
        // Locked once a code has been sent: changing it here would silently
        // orphan the code the archer is about to type.
        editable={!busy && stage === 'request'}
      />

      {stage === 'confirm' ? (
        <>
          <TextField
            label="Code"
            value={code}
            onChangeText={(next) =>
              setCode(next.replace(/[^0-9]/g, '').slice(0, CODE_LENGTH))
            }
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            placeholder="123456"
            editable={!busy}
          />

          <TextField
            label="New password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            editable={!busy}
            hint={`At least ${MIN_PASSWORD_LENGTH} characters, with an uppercase letter and a number.`}
          />
        </>
      ) : null}

      {stage === 'request' ? (
        <Button
          label={busy ? 'Sending…' : 'Send code'}
          variant="filled"
          block
          disabled={email.trim().length === 0 || busy}
          onPress={() => void request()}
        />
      ) : (
        <Button
          label={busy ? 'Saving…' : 'Set new password'}
          variant="filled"
          block
          disabled={
            code.length !== CODE_LENGTH ||
            password.length < MIN_PASSWORD_LENGTH ||
            busy
          }
          onPress={() => void confirm()}
        />
      )}

      <View style={styles.links}>
        <Button
          label="Back to sign in"
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
