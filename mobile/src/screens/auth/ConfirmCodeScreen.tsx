/**
 * Confirm the code emailed at sign-up.
 *
 * The email arrives as a route param because every path here already knows it
 * — sign-up just used it, and sign-in discovered the account was unconfirmed.
 * Asking for it again would be asking the archer to retype something we hold.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../auth/AuthProvider';
import { authErrorMessage } from '../../auth/authErrors';
import { Banner, Button, Screen, TextField } from '../../components/ui';
import type { AuthStackParamList } from '../../navigation';
import { spacing, type, usePalette } from '../../theme';

type Props = NativeStackScreenProps<AuthStackParamList, 'ConfirmCode'>;

/** Cognito's emailed codes are always six digits. */
const CODE_LENGTH = 6;

export default function ConfirmCodeScreen({ navigation, route }: Props) {
  const palette = usePalette();
  const auth = useAuth();

  const { email } = route.params;

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = code.length === CODE_LENGTH && !busy;

  async function submit() {
    setError(null);
    setNotice(null);
    setBusy(true);

    try {
      await auth.confirmSignUp(email, code);
      // Confirming does not sign anyone in — Cognito has verified the address,
      // not authenticated the session. Back to sign in, with the account now
      // usable.
      navigation.navigate('SignIn');
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    setNotice(null);
    setBusy(true);

    try {
      await auth.resendCode(email);
      setNotice('A new code is on its way.');
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Text style={[type.title, styles.title, { color: palette.textPrimary }]}>
        Check your email
      </Text>
      <Text style={[type.body, styles.blurb, { color: palette.textSecondary }]}>
        We sent a {CODE_LENGTH}-digit code to {email}.
      </Text>

      {error ? (
        <Banner tone="error" message={error} onDismiss={() => setError(null)} />
      ) : null}
      {notice ? (
        <Banner
          tone="info"
          message={notice}
          onDismiss={() => setNotice(null)}
        />
      ) : null}

      <TextField
        label="Code"
        value={code}
        // Strip anything that is not a digit: the code is copied out of an
        // email, and a trailing space pasted with it would read as a mismatch.
        onChangeText={(next) =>
          setCode(next.replace(/[^0-9]/g, '').slice(0, CODE_LENGTH))
        }
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        placeholder="123456"
        editable={!busy}
        returnKeyType="go"
        onSubmitEditing={() => {
          if (canSubmit) void submit();
        }}
      />

      <Button
        label={busy ? 'Confirming…' : 'Confirm'}
        variant="filled"
        block
        disabled={!canSubmit}
        onPress={() => void submit()}
      />

      <View style={styles.links}>
        <Button
          label="Send another code"
          onPress={() => void resend()}
          disabled={busy}
        />
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
  links: { marginTop: spacing.sm, alignItems: 'center', gap: spacing.xs },
});
