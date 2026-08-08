import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { formatMoney } from '@penny/ui';
import { useBrand, useTheme } from '../../brand';
import { Haptics } from '../../lib/native';
import { getApi } from '../../services';
import type { Wallet, Card as CardType, PackageProduct, SubscriptionProduct, AddonProduct, DebtView } from '../../services/types';
import { useT } from '../../i18n';
import {
  Screen, T, Row, Card, Button, Badge, Banner, ListRow, Divider, Sheet, Icon,
} from '../../components/ui';

export default function WalletScreen() {
  const { t } = useT();
  const theme = useTheme();
  const { brand, isEnabled } = useBrand();
  const api = getApi();

  const packagesOn = isEnabled('packages');
  const subscriptionsOn = isEnabled('subscriptions');
  const topUpOn = isEnabled('walletTopUp');

  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [cards, setCards] = useState<CardType[]>([]);
  const [packages, setPackages] = useState<PackageProduct[]>([]);
  const [subs, setSubs] = useState<SubscriptionProduct[]>([]);
  const [addons, setAddons] = useState<AddonProduct[]>([]);
  const [debts, setDebts] = useState<DebtView[]>([]);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [w, c, p, s, a, d] = await Promise.all([
      api.getWallet(), api.getCards(), api.getPackages(), api.getSubscriptions(), api.getAddons(), api.getDebts(),
    ]);
    setWallet(w); setCards(c); setPackages(p); setSubs(s); setAddons(a); setDebts(d);
  }, [api]);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  const money = (c: number) => formatMoney(c, wallet?.currency ?? brand.currency);
  const debtTotal = debts.reduce((a, d) => a + d.amount_cents, 0);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try { await fn(); await reload(); Haptics.success(); } finally { setBusy(null); }
  };

  return (
    <Screen edges={['top']} scroll>
      <T variant="title" style={{ marginBottom: theme.space.md }}>{t('wallet.title')}</T>

      {debtTotal > 0 ? (
        <Banner
          tone="danger"
          icon="warning"
          title={t('wallet.debtBanner', { amount: (debtTotal / 100).toFixed(2) })}
          style={{ marginBottom: theme.space.md }}
          action={<Button title={t('wallet.payNow')} size="sm" full={false} loading={busy === 'debt'} onPress={() => run('debt', async () => { for (const d of debts) await api.payDebt(d.id); })} />}
        />
      ) : null}

      {/* balance */}
      <Card style={{ marginBottom: theme.space.md, backgroundColor: theme.color.primary }}>
        <T variant="label" color={theme.color.onPrimary} style={{ opacity: 0.85 }}>{t('wallet.balance')}</T>
        <Row justify="space-between" align="flex-end">
          <T variant="display" color={theme.color.onPrimary} style={{ fontSize: 40 }}>{money(wallet?.balance_cents ?? 0)}</T>
          {topUpOn ? (
            <Button title={t('wallet.topUp')} icon="wallet" variant="secondary" full={false} onPress={() => setTopUpOpen(true)} />
          ) : null}
        </Row>
      </Card>

      {/* wallet pay + cards */}
      <Section title={t('wallet.cards')}>
        <Card style={{ marginBottom: theme.space.sm, borderColor: theme.color.primary, borderWidth: 1 }}>
          <Row justify="space-between">
            <Row gap={10}><Icon name="applepay" size={22} /><View><T variant="body" style={{ fontWeight: '700' }}>{t('wallet.walletPay')}</T><T variant="caption">{t('wallet.walletPayDesc')}</T></View></Row>
            <Badge tone="primary" label="Primary" />
          </Row>
        </Card>
        <Card>
          {cards.length === 0 ? <T variant="caption" style={{ paddingVertical: 8 }}>No cards yet</T> : null}
          {cards.map((c, i) => (
            <View key={c.id}>
              {i > 0 ? <Divider /> : null}
              <ListRow
                icon="card"
                title={`${c.brand.toUpperCase()} ···· ${c.last4}`}
                subtitle={`Exp ${c.exp}`}
                right={c.is_default ? <Badge tone="success" label={t('wallet.default')} /> : <Button title={t('wallet.makeDefault')} size="sm" variant="ghost" full={false} onPress={() => run('def', () => api.setDefaultCard(c.id))} />}
              />
            </View>
          ))}
          <Divider />
          <Button title={t('wallet.addCard')} icon="card" variant="ghost" loading={busy === 'addcard'} onPress={() => run('addcard', () => api.addCard())} />
        </Card>
      </Section>

      {/* packages */}
      {packagesOn && packages.length > 0 ? (
        <Section title={t('wallet.packages')}>
          {packages.map((p) => (
            <Card key={p.id} style={{ marginBottom: theme.space.sm }}>
              <Row justify="space-between">
                <Row gap={10}>
                  <Icon name="package" size={22} color={theme.color.primary} />
                  <View>
                    <T variant="body" style={{ fontWeight: '700' }}>{p.name}</T>
                    <T variant="caption">{t('wallet.minutes', { n: p.minutes })} · {p.validity_days}d{p.owned_minutes_left ? ` · ${p.owned_minutes_left} min left` : ''}</T>
                  </View>
                </Row>
                <Button title={money(p.price_cents)} size="sm" full={false} loading={busy === p.id} onPress={() => run(p.id, () => api.buyPackage(p.id))} />
              </Row>
            </Card>
          ))}
        </Section>
      ) : null}

      {/* subscriptions */}
      {subscriptionsOn && subs.length > 0 ? (
        <Section title={t('wallet.subscriptions')}>
          {subs.map((s) => (
            <Card key={s.id} style={{ marginBottom: theme.space.sm }}>
              <Row justify="space-between">
                <Row gap={10}>
                  <Icon name="crown" size={22} color={theme.color.warning} />
                  <View>
                    <T variant="body" style={{ fontWeight: '700' }}>{s.name}</T>
                    <T variant="caption">{s.perk}</T>
                  </View>
                </Row>
                {s.active ? <Badge tone="success" label={t('wallet.active')} /> : (
                  <Button title={`${money(s.price_cents)}${t('wallet.perMonth')}`} size="sm" full={false} loading={busy === s.id} onPress={() => run(s.id, () => api.subscribe(s.id))} />
                )}
              </Row>
            </Card>
          ))}
        </Section>
      ) : null}

      {/* add-ons */}
      {addons.length > 0 ? (
        <Section title={t('wallet.addons')}>
          {addons.map((a) => (
            <Card key={a.id} style={{ marginBottom: theme.space.sm }}>
              <Row justify="space-between">
                <Row gap={10}>
                  <Icon name="shield" size={22} color={theme.color.success} />
                  <View style={{ flex: 1 }}>
                    <T variant="body" style={{ fontWeight: '700' }}>{a.name}</T>
                    <T variant="caption">{a.description} · {money(a.price_cents)}/{a.per}</T>
                  </View>
                </Row>
                <Button title={a.active ? t('wallet.active') : t('wallet.buy')} size="sm" variant={a.active ? 'success' : 'primary'} full={false} onPress={() => run(a.id, () => api.toggleAddon(a.id))} />
              </Row>
            </Card>
          ))}
        </Section>
      ) : null}

      {topUpOn ? (
        <Sheet visible={topUpOpen} onClose={() => setTopUpOpen(false)} title={t('wallet.topUp')}>
          <Row wrap gap={theme.space.sm}>
            {[500, 1000, 2000, 5000].map((amt) => (
              <Button key={amt} title={money(amt)} variant="secondary" full={false} onPress={() => run('topup', async () => { await api.topUp(amt); setTopUpOpen(false); })} />
            ))}
          </Row>
        </Sheet>
      ) : null}
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ marginBottom: theme.space.lg }}>
      <T variant="label" style={{ marginBottom: theme.space.sm }}>{title}</T>
      {children}
    </View>
  );
}
