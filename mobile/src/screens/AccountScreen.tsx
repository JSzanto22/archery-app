/**
 * Account: who you are signed in as, what you have consented to, and the way
 * out.
 *
 * Sign-out had no home before this. `AuthProvider` has exposed `signOut` since
 * auth landed and nothing called it, which meant an archer who signed in on a
 * borrowed phone could not sign out of it — the same class of gap as the sync
 * function that sat unused while every session claimed to be unsynced.
 *
 * Research consent lives here rather than in a prompt at first sign-in. A
 * question asked once, in the way of something someone is trying to do, gets
 * dismissed rather than considered — and consent that can only be given once
 * is not consent, because withdrawing it has to be as easy as giving it.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { getProfile, updateProfile, type Profile } from '../api/profile';
import { useAuth } from '../auth/AuthProvider';
import { Banner, Button, Screen, SectionHeader } from '../components/ui';
import type { RootStackParamList } from '../navigation';
import { radius, spacing, type, usePalette } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Account'>;

export default function AccountScreen({ navigation }: Props) {
  const palette = usePalette();
  const auth = useAuth();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setProfile(await getProfile({ getAccessToken: auth.getAccessToken }));
    } catch {
      // The account still works offline — everything is on the phone — so this
      // is a notice, not a failure.
      setError('Could not reach the server. Showing what this phone knows.');
    }
  }, [auth.getAccessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const setConsent = useCallback(
    async (next: boolean) => {
      // Optimistic: the switch should move under the thumb. Reverted below if
      // the write does not land.
      setProfile((current) =>
        current ? { ...current, researchConsent: next } : current,
      );
      setBusy(true);
      setError(null);

      try {
        const updated = await updateProfile(
          { researchConsent: next },
          { getAccessToken: auth.getAccessToken },
        );
        setProfile(updated);
      } catch {
        setProfile((current) =>
          current ? { ...current, researchConsent: !next } : current,
        );
        setError('Could not save that. Check your connection and try again.');
      } finally {
        setBusy(false);
      }
    },
    [auth.getAccessToken],
  );

  const signOut = useCallback(async () => {
    setBusy(true);
    try {
      await auth.signOut();
      // No navigation needed: the navigator is gated on isSignedIn and swaps
      // to the auth stack on its own.
    } catch {
      setError('Could not sign out. Try again.');
      setBusy(false);
    }
  }, [auth]);

  // The email the app knows locally, so the screen says something useful
  // before the request lands and if it never does.
  const email = profile?.email ?? auth.user?.email ?? 'Signed in';

  return (
    <Screen>
      {error ? (
        <Banner
          tone="info"
          message={error}
          actionLabel="Retry"
          onAction={() => void load()}
          onDismiss={() => setError(null)}
        />
      ) : null}

      <SectionHeader title="Signed in as" />
      <View
        style={[
          styles.card,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}
      >
        <Text style={[type.body, { color: palette.textPrimary }]}>{email}</Text>
        {auth.isDevAuth ? (
          <Text style={[type.label, { color: palette.textMuted }]}>
            Development sign-in — no account, no server verification.
          </Text>
        ) : null}
      </View>

      <SectionHeader title="Research" />
      <View
        style={[
          styles.card,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}
      >
        <View style={styles.switchRow}>
          <Text
            style={[
              type.body,
              styles.switchLabel,
              { color: palette.textPrimary },
            ]}
          >
            Share anonymised shooting data
          </Text>
          <Switch
            value={profile?.researchConsent ?? false}
            onValueChange={(next) => void setConsent(next)}
            disabled={busy || profile === null}
            accessibilityLabel="Share anonymised shooting data"
            trackColor={{ true: palette.accent, false: palette.baseline }}
          />
        </View>
        <Text style={[type.label, styles.blurb, { color: palette.textMuted }]}>
          Arrow positions and scores, with nothing that identifies you. Used to
          improve how the app measures grouping. Off unless you turn it on, and
          you can turn it back off here at any time.
        </Text>
      </View>

      <View style={styles.actions}>
        <Button
          label="Sign out"
          variant="tonal"
          block
          disabled={busy || auth.isDevAuth}
          onPress={() => void signOut()}
        />
        {auth.isDevAuth ? (
          <Text
            style={[type.label, styles.blurb, { color: palette.textMuted }]}
          >
            There is no session to end in development.
          </Text>
        ) : (
          <Text
            style={[type.label, styles.blurb, { color: palette.textMuted }]}
          >
            Your sessions stay on this phone. Signing back in brings them
            together with anything recorded elsewhere.
          </Text>
        )}
      </View>

      <View style={styles.actions}>
        <Button label="Back" onPress={() => navigation.goBack()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  switchLabel: { flex: 1 },
  blurb: { marginTop: spacing.xs },
  actions: { marginTop: spacing.md, gap: spacing.xs },
});
