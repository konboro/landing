import React, { useEffect, useState } from 'react';
import { View, Pressable, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { useBrand, useTheme } from '../../brand';
import { getApi } from '../../services';
import type { FaqEntry } from '../../services/types';
import { useT, useI18n } from '../../i18n';
import { useSession } from '../../store/session';
import { Haptics } from '../../lib/native';
import { Screen, T, Row, Card, Button, Divider, ListRow, Icon, Sheet, TextField, Banner } from '../../components/ui';

/** `+30 210 000 0000` → `https://wa.me/302100000000` */
function whatsappUrl(number: string): string {
  return `https://wa.me/${number.replace(/[^\d]/g, '')}`;
}

export default function SupportScreen() {
  const { t } = useT();
  const { lang } = useI18n();
  const theme = useTheme();
  const { brand } = useBrand();
  const api = getApi();
  const router = useRouter();
  const [faq, setFaq] = useState<FaqEntry[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const user = useSession((s) => s.user);
  const setUser = useSession((s) => s.setUser);
  const [sheet, setSheet] = useState(false);
  const [emergency, setEmergency] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { api.getFaq(lang).then(setFaq); }, [api, lang]);

  const { email, phone, url, whatsapp } = brand.support;

  return (
    <Screen edges={['top']} scroll>
      <T variant="title" style={{ marginBottom: theme.space.md }}>{t('support.title')}</T>

      <Card style={{ marginBottom: theme.space.md }}>
        <ListRow
          icon="help"
          title={t('support.liveChat')}
          subtitle={t('support.liveChatHint')}
          onPress={() => router.push('/support/chat')}
        />
        <Divider />
        <ListRow icon="flag" title={t('support.reportVehicle')} onPress={() => router.push({ pathname: '/report/[code]', params: { code: 'none' } })} />
        <Divider />
        <ListRow icon="inbox" title={t('support.inbox')} onPress={() => router.push('/inbox')} />
      </Card>

      {/* Emergency contact lives here rather than in the profile: it belongs
          with the incident tools, beside crash check-in and the phone line. */}
      <T variant="label" style={{ marginBottom: theme.space.sm }}>{t('support.emergency')}</T>
      <Card style={{ marginBottom: theme.space.md }}>
        <ListRow
          icon="crash"
          title={t('profile.emergency')}
          subtitle={user?.emergency_contact || t('profile.emergencyHint')}
          onPress={() => { setEmergency(user?.emergency_contact ?? ''); setSheet(true); }}
        />
      </Card>

      <Sheet visible={sheet} onClose={() => setSheet(false)} title={t('profile.emergency')}>
        <View style={{ gap: theme.space.md }}>
          <Banner tone="neutral" icon="info" title={t('profile.emergencyHint')} />
          <TextField
            label={t('profile.emergency')}
            keyboardType="phone-pad"
            value={emergency}
            onChangeText={setEmergency}
          />
          <Button
            title={t('common.save')}
            loading={saving}
            onPress={async () => {
              setSaving(true);
              try {
                // An empty field clears the contact rather than storing "".
                const u = await api.updateProfile({ emergency_contact: emergency.trim() || null });
                setUser(u);
                Haptics.success();
                setSheet(false);
              } catch {
                Haptics.error();
              } finally {
                setSaving(false);
              }
            }}
          />
        </View>
      </Sheet>

      <T variant="label" style={{ marginBottom: theme.space.sm }}>{t('support.faq')}</T>
      <Card style={{ marginBottom: theme.space.md }}>
        {faq.map((f, i) => (
          <View key={f.id}>
            {i > 0 ? <Divider /> : null}
            <Pressable onPress={() => setOpen((o) => (o === f.id ? null : f.id))}>
              <Row justify="space-between" style={{ paddingVertical: 10 }}>
                <T variant="body" style={{ fontWeight: '600', flex: 1, paddingRight: 8 }}>{f.question}</T>
                <Icon name="chevron" size={20} color={theme.color.textMuted} style={{ transform: [{ rotate: open === f.id ? '90deg' : '0deg' }] }} />
              </Row>
            </Pressable>
            {open === f.id ? <T variant="caption" style={{ paddingBottom: 10 }}>{f.answer}</T> : null}
          </View>
        ))}
      </Card>

      <T variant="label" style={{ marginBottom: theme.space.sm }}>{t('support.contact')}</T>
      <Row gap={theme.space.md} wrap>
        <Button
          title={t('support.email')}
          icon="mail"
          variant="secondary"
          style={{ flex: 1, minWidth: 140 }}
          onPress={() => Linking.openURL(`mailto:${email}`).catch(() => undefined)}
        />
        {whatsapp ? (
          <Button
            title={t('support.whatsapp')}
            icon="whatsapp"
            variant="secondary"
            style={{ flex: 1, minWidth: 140 }}
            onPress={() => Linking.openURL(whatsappUrl(whatsapp)).catch(() => undefined)}
          />
        ) : null}
        {phone ? (
          <Button
            title={phone}
            icon="phone"
            variant="secondary"
            style={{ flex: 1, minWidth: 140 }}
            onPress={() => Linking.openURL(`tel:${phone.replace(/\s/g, '')}`).catch(() => undefined)}
          />
        ) : null}
      </Row>

      {url ? (
        <Button
          title={`${brand.name} help centre`}
          icon="help"
          variant="ghost"
          style={{ marginTop: theme.space.md }}
          onPress={() => Linking.openURL(url).catch(() => undefined)}
        />
      ) : null}

      <T variant="caption" center style={{ marginTop: theme.space.lg }}>
        {brand.legal.legalName}
        {brand.legal.vatId ? ` · VAT ${brand.legal.vatId}` : ''}
      </T>
    </Screen>
  );
}
