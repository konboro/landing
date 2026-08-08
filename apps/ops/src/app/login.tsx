import React, { useState } from 'react';
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, H1, Muted, Button, Field, Card } from '../components/ui';
import { getOpsApi } from '../services';
import { bootstrapAfterLogin } from '../offline/bootstrap';
import { saveSession, isOnboarded } from '../lib/auth';
import { useOps } from '../lib/store';
import { c, space, font } from '../lib/theme';
import { env } from '../lib/env';

export default function Login() {
  const router = useRouter();
  const setSession = useOps((s) => s.setSession);
  const [phone, setPhone] = useState('+306900000000');
  const [otp, setOtp] = useState('');
  const [stage, setStage] = useState<'phone' | 'otp'>('phone');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendOtp() {
    setError(null);
    if (!phone.trim()) {
      setError('Enter your staff phone number');
      return;
    }
    setStage('otp');
  }

  async function verify() {
    setError(null);
    setLoading(true);
    try {
      const session = await getOpsApi().login(phone.trim(), otp.trim());
      await saveSession(session);
      setSession(session);
      await bootstrapAfterLogin(session);
      if (await isOnboarded()) router.replace('/(tabs)');
      else router.replace('/onboarding');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ gap: space.xl, marginTop: space.xxxl }}>
        <View style={{ gap: space.xs }}>
          <Text style={st.logo}>Penny Ops</Text>
          <H1>Field service</H1>
          <Muted>Staff login — OTP + staff role check. Offline-first.</Muted>
        </View>

        <Card>
          {stage === 'phone' ? (
            <>
              <Field label="Staff phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+30…" />
              <Button title="Send code" onPress={sendOtp} />
            </>
          ) : (
            <>
              <Field label="One-time code" value={otp} onChangeText={setOtp} keyboardType="number-pad" placeholder="6 digits" autoFocus />
              <Button title="Verify & sign in" onPress={verify} loading={loading} />
              <Button title="Change number" variant="ghost" onPress={() => setStage('phone')} />
            </>
          )}
          {error && <Text style={st.err}>{error}</Text>}
        </Card>

        {env.dataSource === 'mock' && (
          <Card style={{ borderColor: c.primary }}>
            <Text style={st.demoTitle}>Demo mode (mock backend)</Text>
            <Muted>Any phone number works. Enter code 000000 (or any 6 digits) to sign in.</Muted>
          </Card>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}

const st = StyleSheet.create({
  logo: { color: c.primary, fontSize: font.size.lg, fontWeight: '800', letterSpacing: 0.5 },
  err: { color: c.danger, fontSize: font.size.sm, fontWeight: '600' },
  demoTitle: { color: c.text, fontWeight: '700', fontSize: font.size.sm },
});
