import React, { useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { formatMoney } from '@penny/ui';
import { useBrand, useTheme, makeStyles } from '../../brand';
import { getApi } from '../../services';
import type { MapVehicle, PricingQuote } from '../../services/types';
import { useT } from '../../i18n';
import { useSession } from '../../store/session';
import { useFlags, reactionRequired } from '../../store/flags';
import {
  Screen, Header, T, Row, Card, Button, Toggle, TextField, Badge, SocPill, Banner, Divider, Icon,
} from '../../components/ui';
import { uuid } from '../../lib/ids';

export default function PreUnlockScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const router = useRouter();
  const { t } = useT();
  const theme = useTheme();
  const styles = useStyles(theme);
  const { brand, isEnabled } = useBrand();
  const api = getApi();
  const user = useSession((s) => s.user);
  const flags = useFlags();

  const [vehicle, setVehicle] = useState<MapVehicle | null>(null);
  const [quote, setQuote] = useState<PricingQuote | null>(null);
  const [insurance, setInsurance] = useState(false);
  const [promo, setPromo] = useState('');
  const [promoMsg, setPromoMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [hasCard, setHasCard] = useState(true);
  const [debt, setDebt] = useState(false);
  const [starting, setStarting] = useState(false);

  const load = async (promoCode?: string) => {
    if (!code) return;
    const [v, q, cards, wallet, debts] = await Promise.all([
      api.getVehicle(code),
      api.getQuote(code, [0, 0], { addon_insurance: insurance, promo_code: promoCode }),
      api.getCards(),
      api.getWallet(),
      api.getDebts(),
    ]);
    setVehicle(v);
    setQuote(q);
    setHasCard(cards.length > 0 || wallet.balance_cents > 0);
    setDebt(debts.length > 0);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [code, insurance]);

  const applyPromo = async () => {
    const res = await api.applyPromo(promo);
    setPromoMsg({ ok: res.ok, text: res.message });
    if (res.ok) load(promo);
  };

  const kycOk = user?.kyc_status === 'approved';

  const start = async () => {
    if (!vehicle) return;
    if (!kycOk) { router.push('/onboarding/kyc'); return; }
    if (!hasCard) { router.push('/(tabs)/wallet'); return; }
    if (debt) { router.push('/(tabs)/wallet'); return; }
    // Night anti-DUI gate is a per-operator product surface.
    if (isEnabled('reactionTest') && reactionRequired(flags)) { router.push('/reaction-test'); return; }
    setStarting(true);
    const clientCommandId = uuid(); // idempotency
    router.replace({
      pathname: '/unlock',
      params: {
        code: vehicle.code,
        insurance: insurance ? '1' : '0',
        promo: promoMsg?.ok ? promo : '',
        cmd: clientCommandId,
      },
    });
  };

  const money = (c: number) => formatMoney(c, quote?.currency ?? brand.currency);

  return (
    <Screen edges={['top']} scroll={false} padded={false}>
      <Header title={t('preUnlock.title')} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: theme.space.lg, paddingBottom: 140, gap: theme.space.md }}>
        {vehicle ? (
          <Card>
            <Row justify="space-between">
              <Row gap={10}>
                <Icon name="scooter" size={26} color={theme.color.primary} />
                <View>
                  <T variant="subtitle">{vehicle.code}</T>
                  <T variant="caption">{vehicle.model_name} · {t('vehicle.maxSpeed')} {vehicle.max_speed_kmh} km/h</T>
                </View>
              </Row>
              <SocPill soc={vehicle.soc_pct} />
            </Row>
          </Card>
        ) : null}

        {quote ? (
          <Card>
            <T variant="label">{t('preUnlock.title')}</T>
            <View style={{ marginTop: theme.space.sm, gap: 8 }}>
              <PriceRow label={t('preUnlock.unlockFee')} value={money(quote.snapshot.unlock_cents)} />
              <PriceRow
                label={t('preUnlock.perMin')}
                value={money(quote.snapshot.per_min_cents)}
                badge={quote.multiplier > 1 ? `${quote.multiplier.toFixed(1)}×` : undefined}
              />
              <PriceRow label={t('preUnlock.pausePerMin')} value={money(quote.snapshot.pause_per_min_cents)} />
              {quote.snapshot.day_cap_cents != null ? (
                <PriceRow label={t('preUnlock.dayCap')} value={money(quote.snapshot.day_cap_cents)} />
              ) : null}
              {insurance ? <PriceRow label={t('preUnlock.insurance')} value={money(quote.addon_insurance_cents)} /> : null}
              {quote.promo ? <PriceRow label={`${t('endRide.promo')} ${quote.promo.code}`} value={`-${money(quote.promo.discount_cents)}`} tone="success" /> : null}
              <Divider />
              <PriceRow label={t('preUnlock.estimate')} value={money(quote.estimate_15min_cents)} strong />
            </View>
            <Banner style={{ marginTop: theme.space.md }} tone="neutral" icon="info" title={t('preUnlock.holdInfo', { amount: (quote.hold_cents / 100).toFixed(0) })} />
          </Card>
        ) : null}

        {quote?.package_preview ? (
          <Banner tone="primary" icon="package" title={t('preUnlock.packageApplied')} body={`${quote.package_preview.name} · ${quote.package_preview.minutes_left} min`} />
        ) : null}
        {quote?.subscription_preview ? (
          <Banner tone="primary" icon="crown" title={t('preUnlock.subApplied', { name: quote.subscription_preview.name })} body={quote.subscription_preview.perk} />
        ) : null}

        <Card>
          <Toggle
            value={insurance}
            onChange={setInsurance}
            icon="shield"
            label={t('preUnlock.insurance')}
            description={t('preUnlock.insuranceDesc')}
          />
        </Card>

        <Card>
          <T variant="label" style={{ marginBottom: 8 }}>{t('preUnlock.promo')}</T>
          <Row gap={theme.space.sm}>
            <View style={{ flex: 1 }}>
              <TextField placeholder="PENNY1" autoCapitalize="characters" value={promo} onChangeText={(v) => { setPromo(v); setPromoMsg(null); }} />
            </View>
            <Button title={t('preUnlock.apply')} variant="secondary" full={false} onPress={applyPromo} />
          </Row>
          {promoMsg ? (
            <T variant="caption" color={promoMsg.ok ? theme.color.success : theme.color.danger} style={{ marginTop: 6 }}>
              {promoMsg.text}
            </T>
          ) : null}
        </Card>

        {/* refusal reasons surfaced (drives conversion) */}
        {!kycOk ? <Banner tone="warning" icon="shield" title={t('preUnlock.needKyc')} action={<Button title={t('common.continue')} size="sm" full={false} onPress={() => router.push('/onboarding/kyc')} />} /> : null}
        {kycOk && !hasCard ? <Banner tone="warning" icon="card" title={t('preUnlock.needCard')} action={<Button title={t('wallet.addCard')} size="sm" full={false} onPress={() => router.push('/(tabs)/wallet')} />} /> : null}
        {debt ? <Banner tone="danger" icon="warning" title={t('preUnlock.hasDebt')} action={<Button title={t('wallet.payNow')} size="sm" full={false} onPress={() => router.push('/(tabs)/wallet')} />} /> : null}
      </ScrollView>

      <View style={styles.footer}>
        <Button title={t('preUnlock.startRide')} icon="unlock" size="lg" onPress={start} loading={starting} />
      </View>
    </Screen>
  );
}

function PriceRow({ label, value, badge, tone, strong }: { label: string; value: string; badge?: string; tone?: 'success'; strong?: boolean }) {
  const theme = useTheme();
  return (
    <Row justify="space-between">
      <Row gap={8}>
        <T variant={strong ? 'subtitle' : 'body'} color={theme.color.textMuted}>{label}</T>
        {badge ? <Badge tone="warning" label={badge} /> : null}
      </Row>
      <T variant={strong ? 'subtitle' : 'body'} color={tone === 'success' ? theme.color.success : theme.color.text} style={{ fontWeight: '700' }}>{value}</T>
    </Row>
  );
}

const useStyles = makeStyles((t) => ({
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: t.space.lg, paddingBottom: t.space.xl,
    backgroundColor: t.color.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.color.border,
  },
}));
