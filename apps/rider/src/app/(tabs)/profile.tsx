import React, { useCallback, useState } from 'react';
import { View, Share, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { formatMoney, formatDistance, formatDuration } from '@penny/ui';
import { theme } from '../../lib/theme';
import { Haptics } from '../../lib/native';
import { getApi } from '../../services';
import type { LifetimeStats, NotifPrefs, RiderUser } from '../../services/types';
import { useT, useI18n, LANGS, LANG_LABEL, type Lang } from '../../i18n';
import { useSession } from '../../store/session';
import {
  Screen, T, Row, Card, Button, Badge, Banner, ListRow, Divider, Sheet, TextField, Toggle, SegmentedControl, Icon, Spacer,
} from '../../components/ui';
import { KycCard } from '../../components/KycCard';

export default function ProfileScreen() {
  const { t } = useT();
  const router = useRouter();
  const api = getApi();
  const user = useSession((s) => s.user);
  const setUser = useSession((s) => s.setUser);
  const logout = useSession((s) => s.logout);
  const { lang, setLang } = useI18n();

  const [stats, setStats] = useState<LifetimeStats | null>(null);
  const [prefs, setPrefs] = useState<NotifPrefs | null>(null);
  const [sheet, setSheet] = useState<null | 'lang' | 'notif' | 'personal' | 'emergency' | 'consents' | 'delete'>(null);
  const [draft, setDraft] = useState<Partial<RiderUser>>({});

  useFocusEffect(useCallback(() => {
    api.getStats().then(setStats);
    api.getNotifPrefs().then(setPrefs);
  }, [api]));

  const kycTone = user?.kyc_status === 'approved' ? 'success' : user?.kyc_status === 'rejected' ? 'danger' : 'warning';

  const save = async (patch: Partial<RiderUser>) => {
    const u = await api.updateProfile(patch);
    setUser(u);
    Haptics.success();
  };

  const share = async () => {
    if (!user) return;
    await Share.share({ message: `Ride with Penny! Use my code ${user.referral_code} for free minutes 🛴 penny://` }).catch(() => {});
  };

  return (
    <Screen edges={['top']} scroll>
      <T variant="title" style={{ marginBottom: theme.space.md }}>{t('profile.title')}</T>

      {/* identity + KYC */}
      <Card style={{ marginBottom: theme.space.md }}>
        <Row gap={theme.space.md}>
          <View style={styles.avatar}><Icon name="profile" size={26} color={theme.color.onPrimary} /></View>
          <View style={{ flex: 1 }}>
            <T variant="subtitle">{user?.full_name ?? '—'}</T>
            <T variant="caption">{user?.phone}{user?.email ? ` · ${user.email}` : ''}</T>
            <Row gap={6} style={{ marginTop: 6 }}>
              <Badge tone={kycTone} icon="shield" label={t(`kyc.${user?.kyc_status ?? 'none'}`)} />
              <Badge tone="neutral" icon="points" label={t('profile.points', { n: stats?.loyalty_points ?? 0 })} />
            </Row>
          </View>
        </Row>
      </Card>

      {/* the rider's own verification detail (docs + reject reason + retry) */}
      <KycCard />
      <Spacer size={theme.space.md} />

      {/* yearly recap */}
      {stats ? (
        <Card style={[styles.recap]}>
          <Row justify="space-between">
            <T variant="label" color="rgba(255,255,255,0.85)">{t('profile.recap', { year: stats.year })}</T>
            <Icon name="leaf" size={20} color={theme.color.onPrimary} />
          </Row>
          <Row justify="space-between" style={{ marginTop: theme.space.md }}>
            <Recap value={String(stats.rides)} label={t('profile.rides')} />
            <Recap value={formatDistance(stats.distance_m)} label={t('profile.distance')} />
            <Recap value={`${stats.co2_kg} kg`} label={t('profile.co2Total')} />
          </Row>
          <Divider style={{ backgroundColor: 'rgba(255,255,255,0.25)' }} />
          <Row justify="space-between">
            <Recap value={formatDuration(stats.duration_s)} label={t('ride.time')} />
            <Recap value={formatMoney(stats.spent_cents)} label={t('ride.cost')} />
            <Recap value={t('profile.days', { n: stats.parking_streak })} label={t('profile.streak')} />
          </Row>
        </Card>
      ) : null}

      {/* referral */}
      <Card style={{ marginVertical: theme.space.md }}>
        <Row justify="space-between">
          <Row gap={10}><Icon name="referral" size={22} color={theme.color.primary} /><View><T variant="body" style={{ fontWeight: '700' }}>{t('profile.referral')}</T><T variant="caption">{user?.referral_code}</T></View></Row>
          <Button title={t('profile.referralShare')} size="sm" full={false} icon="share" onPress={share} />
        </Row>
      </Card>

      <SectionCard>
        <ListRow icon="profile" title={t('profile.personal')} onPress={() => { setDraft({ full_name: user?.full_name ?? '', email: user?.email ?? '', address: user?.address ?? '', date_of_birth: user?.date_of_birth ?? '' }); setSheet('personal'); }} />
        <Divider />
        <ListRow icon="shield" title={t('profile.documents')} value={t(`kyc.${user?.kyc_status ?? 'none'}`)} onPress={() => router.push('/onboarding/kyc')} />
        <Divider />
        <ListRow icon="lang" title={t('profile.language')} value={LANG_LABEL[lang]} onPress={() => setSheet('lang')} />
        <Divider />
        <ListRow icon="bell" title={t('profile.notifications')} onPress={() => setSheet('notif')} />
        <Divider />
        <ListRow icon="check" title={t('profile.consents')} onPress={() => setSheet('consents')} />
        <Divider />
        <ListRow icon="crash" title={t('profile.emergency')} subtitle={user?.emergency_contact ?? t('profile.emergencyHint')} onPress={() => { setDraft({ emergency_contact: user?.emergency_contact ?? '' }); setSheet('emergency'); }} />
      </SectionCard>

      <SectionCard>
        <ListRow icon="scan" title={t('profile.tutorialReplay')} onPress={() => router.push('/onboarding/tutorial')} />
        <Divider />
        <ListRow icon="parking" title={t('profile.parkingSchool')} onPress={() => router.push('/parking-school')} />
        <Divider />
        <ListRow icon="inbox" title={t('support.inbox')} onPress={() => router.push('/inbox')} />
      </SectionCard>

      <SectionCard>
        <ListRow icon="trash" title={t('profile.deleteAccount')} danger onPress={() => setSheet('delete')} />
        <Divider />
        <ListRow icon="back" title={t('profile.logout')} onPress={() => logout().then(() => router.replace('/'))} />
      </SectionCard>

      {/* language sheet */}
      <Sheet visible={sheet === 'lang'} onClose={() => setSheet(null)} title={t('profile.language')}>
        <View style={{ gap: theme.space.sm }}>
          {LANGS.map((l: Lang) => (
            <ListRow key={l} icon="lang" title={LANG_LABEL[l]} right={lang === l ? <Icon name="check" size={20} color={theme.color.primary} /> : undefined} onPress={() => { setLang(l); setSheet(null); }} />
          ))}
        </View>
      </Sheet>

      {/* notifications sheet */}
      <Sheet visible={sheet === 'notif'} onClose={() => setSheet(null)} title={t('profile.notifications')}>
        {prefs ? (
          <View>
            <Toggle label="Transactional push" description="Receipts, unlocks, safety (required)" value={prefs.push_transactional} onChange={() => {}} />
            <Toggle label={t('onboarding.marketingPush')} value={prefs.push_marketing} onChange={(v) => api.setNotifPrefs({ push_marketing: v }).then(setPrefs)} />
            <Toggle label="Email receipts" value={prefs.email_receipts} onChange={(v) => api.setNotifPrefs({ email_receipts: v }).then(setPrefs)} />
            <Toggle label={t('onboarding.marketingEmail')} value={prefs.email_marketing} onChange={(v) => api.setNotifPrefs({ email_marketing: v }).then(setPrefs)} />
          </View>
        ) : null}
      </Sheet>

      {/* personal sheet */}
      <Sheet visible={sheet === 'personal'} onClose={() => setSheet(null)} title={t('profile.personal')}>
        <View style={{ gap: theme.space.md }}>
          <TextField label={t('onboarding.fullName')} value={draft.full_name ?? ''} onChangeText={(v) => setDraft((d) => ({ ...d, full_name: v }))} />
          <TextField label={t('onboarding.email')} autoCapitalize="none" keyboardType="email-address" value={draft.email ?? ''} onChangeText={(v) => setDraft((d) => ({ ...d, email: v }))} />
          <TextField label="Date of birth" placeholder="YYYY-MM-DD" value={draft.date_of_birth ?? ''} onChangeText={(v) => setDraft((d) => ({ ...d, date_of_birth: v }))} />
          <TextField label="Address" value={draft.address ?? ''} onChangeText={(v) => setDraft((d) => ({ ...d, address: v }))} />
          <Button title={t('common.save')} onPress={() => save(draft).then(() => setSheet(null))} />
        </View>
      </Sheet>

      {/* emergency sheet */}
      <Sheet visible={sheet === 'emergency'} onClose={() => setSheet(null)} title={t('profile.emergency')}>
        <View style={{ gap: theme.space.md }}>
          <Banner tone="neutral" icon="info" title={t('profile.emergencyHint')} />
          <TextField label={t('profile.emergency')} keyboardType="phone-pad" value={draft.emergency_contact ?? ''} onChangeText={(v) => setDraft((d) => ({ ...d, emergency_contact: v }))} />
          <Button title={t('common.save')} onPress={() => save({ emergency_contact: draft.emergency_contact ?? null }).then(() => setSheet(null))} />
        </View>
      </Sheet>

      {/* consents sheet */}
      <Sheet visible={sheet === 'consents'} onClose={() => setSheet(null)} title={t('profile.consents')}>
        <View>
          <Toggle label={t('onboarding.tos')} value={!!user?.tos_accepted} onChange={() => {}} />
          <Toggle label={t('onboarding.privacy')} value={!!user?.privacy_accepted} onChange={() => {}} />
          <Toggle label={t('onboarding.marketingPush')} value={!!user?.marketing_push} onChange={(v) => save({ marketing_push: v })} />
          <Toggle label={t('onboarding.marketingEmail')} value={!!user?.marketing_email} onChange={(v) => save({ marketing_email: v })} />
        </View>
      </Sheet>

      {/* delete sheet */}
      <Sheet visible={sheet === 'delete'} onClose={() => setSheet(null)} title={t('profile.deleteAccount')}>
        <View style={{ gap: theme.space.md }}>
          <Banner tone="danger" icon="warning" title={t('profile.deleteWarn')} />
          <Button title={t('profile.deleteAccount')} variant="danger" onPress={() => api.deleteAccount().then(() => { setSheet(null); logout().then(() => router.replace('/')); })} />
          <Button title={t('common.cancel')} variant="ghost" onPress={() => setSheet(null)} />
        </View>
      </Sheet>
    </Screen>
  );
}

function SectionCard({ children }: { children: React.ReactNode }) {
  return <Card style={{ marginBottom: theme.space.md }} padded>{children}</Card>;
}
function Recap({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <T variant="subtitle" color={theme.color.onPrimary}>{value}</T>
      <T variant="caption" color="rgba(255,255,255,0.8)" center>{label}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: theme.color.primary, alignItems: 'center', justifyContent: 'center' },
  recap: { backgroundColor: theme.palette.blue700, gap: theme.space.sm },
});
