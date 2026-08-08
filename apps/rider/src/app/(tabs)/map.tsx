import React, { useEffect, useMemo, useState } from 'react';
import { View, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { haversine } from '@penny/geo';
import { formatDistance } from '@penny/ui';
import { useBrand, useTheme, makeStyles } from '../../brand';
import { Haptics, LocationSvc } from '../../lib/native';
import { getApi } from '../../services';
import type { MapVehicle, MapZone, MapPoi, City, LngLat, PricingQuote } from '../../services/types';
import { useT } from '../../i18n';
import { useTrip } from '../../store/trip';
import { useFlags } from '../../store/flags';
import { FleetMap } from '../../components/map/FleetMap';
import {
  T, Row, Card, Button, Badge, Sheet, Banner, Icon, type IconName,
} from '../../components/ui';

export default function MapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useT();
  const theme = useTheme();
  const styles = useStyles(theme);
  const { isEnabled } = useBrand();
  const api = getApi();
  const trip = useTrip((s) => s.trip);
  const flags = useFlags();

  const reservationsOn = isEnabled('reservations');

  const [city, setCity] = useState<City | null>(null);
  const [vehicles, setVehicles] = useState<MapVehicle[]>([]);
  const [zones, setZones] = useState<MapZone[]>([]);
  const [pois, setPois] = useState<MapPoi[]>([]);
  const [userPos, setUserPos] = useState<LngLat | null>(null);
  const [selected, setSelected] = useState<MapVehicle | null>(null);
  const [quote, setQuote] = useState<PricingQuote | null>(null);
  const [reserving, setReserving] = useState(false);
  const [reservedTripId, setReservedTripId] = useState<string | null>(null);
  const [showLayers, setShowLayers] = useState(true);
  const [inboxUnread, setInboxUnread] = useState(0);
  const [focus, setFocus] = useState<LngLat | null>(null);
  const [loading, setLoading] = useState(true);
  const [locPrompt, setLocPrompt] = useState(false);

  useEffect(() => {
    let unsub = () => {};
    (async () => {
      const [c, vs, zs, ps, inbox] = await Promise.all([
        api.getCity(),
        api.getVehicles(),
        api.getZones(),
        api.getPois(),
        api.getInbox(),
      ]);
      setCity(c);
      setVehicles(vs);
      setZones(zs);
      setPois(ps);
      setInboxUnread(inbox.filter((m) => !m.read).length);
      setLoading(false);
      unsub = api.onVehiclesChange(setVehicles);
      if (!flags.askedLocation) setLocPrompt(true);
    })();
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const center: LngLat = userPos ?? city?.center ?? [23.7275, 37.9838];

  const requestLocation = async () => {
    flags.setAsked('askedLocation');
    setLocPrompt(false);
    const res = await LocationSvc.requestPermission();
    if (res === 'granted') {
      const pos = await LocationSvc.current();
      if (pos) {
        setUserPos([pos.lng, pos.lat]);
        setFocus([pos.lng, pos.lat]);
      }
    }
  };

  const openVehicle = async (code: string) => {
    Haptics.light();
    const v = vehicles.find((x) => x.code === code) ?? (await api.getVehicle(code));
    if (!v) return;
    setSelected(v);
    setQuote(null);
    setFocus([v.lng, v.lat]);
    api.getQuote(code, center).then(setQuote).catch(() => {});
  };

  const closeSheet = () => {
    setSelected(null);
    setQuote(null);
  };

  const walkMeters = useMemo(() => {
    if (!selected) return null;
    const from = userPos ?? center;
    return haversine(from, [selected.lng, selected.lat]);
  }, [selected, userPos, center]);

  const onReserve = async () => {
    if (!selected) return;
    setReserving(true);
    try {
      const r = await api.reserve(selected.code, center);
      setReservedTripId(r.trip_id);
      Haptics.success();
      setVehicles((vs) => vs.map((v) => (v.code === selected.code ? { ...v, reserved_by_me: true } : v)));
    } finally {
      setReserving(false);
    }
  };

  const onCancelReserve = async () => {
    if (!reservedTripId) return;
    await api.cancelReserve(reservedTripId);
    setReservedTripId(null);
    setVehicles((vs) => vs.map((v) => ({ ...v, reserved_by_me: false })));
  };

  const onRing = async () => {
    if (!selected) return;
    Haptics.medium();
    await api.ring(selected.code);
  };

  const onUnlock = () => {
    if (!selected) return;
    const code = selected.code;
    closeSheet();
    router.push({ pathname: '/vehicle/[code]', params: { code } });
  };

  const surge = quote && quote.multiplier > 1;
  const isReserved = reservationsOn && (!!reservedTripId || !!selected?.reserved_by_me);

  return (
    <View style={styles.fill}>
      <FleetMap
        vehicles={vehicles}
        zones={zones}
        pois={pois}
        userPos={userPos}
        center={center}
        selectedCode={selected?.code ?? null}
        showZones={showLayers}
        showPois={showLayers}
        night={theme.mode === 'dark'}
        onSelectVehicle={openVehicle}
        onMapPress={closeSheet}
        focus={focus}
      />

      {/* top bar */}
      <View style={[styles.topBar, { top: insets.top + 8 }]} pointerEvents="box-none">
        <Card style={styles.cityPill} padded={false} elevated>
          <Row style={{ paddingHorizontal: 12, paddingVertical: 8 }} gap={8}>
            <Icon name="location" size={16} color={theme.color.primary} />
            <T variant="body" style={{ fontWeight: '700' }}>{city?.name ?? 'Athens'}</T>
            <Badge label={`${vehicles.length} ${t('map.available')}`} tone="success" />
          </Row>
        </Card>
        <Pressable style={styles.iconPill} onPress={() => router.push('/inbox')}>
          <Icon name="inbox" size={20} />
          {inboxUnread > 0 ? <View style={styles.dot}><T variant="caption" color={theme.color.onPrimary} style={styles.dotTxt}>{inboxUnread}</T></View> : null}
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.loading} pointerEvents="none"><ActivityIndicator color={theme.color.primary} /></View>
      ) : null}

      {/* right controls */}
      <View style={[styles.sideControls, { bottom: insets.bottom + 140 }]}>
        <Pressable style={styles.round} onPress={() => setShowLayers((s) => !s)} accessibilityLabel={t('map.layers')}>
          <Icon name={showLayers ? 'check' : 'map'} size={20} color={showLayers ? theme.color.primary : theme.color.text} />
        </Pressable>
        <Pressable style={styles.round} onPress={() => { setFocus(userPos ?? center); requestLocation(); }} accessibilityLabel={t('map.recenter')}>
          <Icon name="locate" size={20} />
        </Pressable>
      </View>

      {/* location pre-prompt */}
      {locPrompt ? (
        <View style={[styles.bottomWrap, { bottom: insets.bottom + 90 }]}>
          <Banner
            tone="primary"
            icon="location"
            title={t('onboarding.permLocationTitle')}
            body={t('onboarding.permLocationBody')}
            action={<Button title={t('onboarding.allow')} size="sm" full={false} onPress={requestLocation} />}
          />
        </View>
      ) : null}

      {/* active trip resume */}
      {trip && (trip.status === 'active' || trip.status === 'paused') ? (
        <View style={[styles.bottomWrap, { bottom: insets.bottom + 90 }]}>
          <Pressable onPress={() => router.push('/ride')}>
            <Banner
              tone="success"
              icon="scooter"
              title={t('ride.title')}
              body={`${trip.vehicle_code} · ${Math.floor(trip.duration_s / 60)}:${String(trip.duration_s % 60).padStart(2, '0')}`}
              action={<Icon name="chevron" size={24} color={theme.color.success} />}
            />
          </Pressable>
        </View>
      ) : null}

      {/* scan FAB */}
      <View style={[styles.fabWrap, { bottom: insets.bottom + 24 }]}>
        <Button title={t('map.scanToRide')} icon="scan" size="lg" onPress={() => router.push('/scan')} />
      </View>

      {/* vehicle sheet */}
      <Sheet visible={!!selected} onClose={closeSheet} title={selected ? selected.code : undefined}>
        {selected ? (
          <View style={{ gap: theme.space.md }}>
            <Row justify="space-between">
              <Row gap={8}>
                <Icon name="scooter" size={22} color={theme.color.primary} />
                <T variant="body" style={{ fontWeight: '700' }}>{selected.model_name}</T>
              </Row>
              {surge ? <Badge tone="warning" icon="fire" label={t('map.dynamicPrice', { mult: quote!.multiplier.toFixed(1) })} /> : null}
            </Row>

            <Row gap={theme.space.lg}>
              <Stat icon="battery" label={t('vehicle.battery')} value={`${Math.round(selected.soc_pct)}%`} />
              <Stat icon="range" label={t('vehicle.range')} value={formatDistance(selected.range_m)} />
              <Stat icon="walk" label={t('vehicle.walkTo')} value={walkMeters != null ? formatDistance(walkMeters) : '—'} />
            </Row>

            {selected.soc_pct < 25 ? (
              <Banner tone="warning" icon="battery" title={t('ride.lowBattery')} />
            ) : null}

            {isReserved ? (
              <Banner
                tone="primary"
                icon="reserve"
                title={t('vehicle.reserved')}
                body={t('vehicle.freeReserve', { min: 10 })}
                action={<Button title={t('common.cancel')} size="sm" variant="ghost" full={false} onPress={onCancelReserve} />}
              />
            ) : null}

            <Button title={t('vehicle.scanToUnlock')} icon="unlock" size="lg" onPress={onUnlock} />
            <Row gap={theme.space.md}>
              {reservationsOn && !isReserved ? (
                <Button title={t('vehicle.reserve')} icon="reserve" variant="secondary" onPress={onReserve} loading={reserving} style={{ flex: 1 }} />
              ) : null}
              <Button title={t('vehicle.ring')} icon="ring" variant="secondary" onPress={onRing} style={{ flex: 1 }} />
            </Row>
            <Button
              title={t('vehicle.reportProblem')}
              icon="flag"
              variant="ghost"
              onPress={() => { const code = selected.code; closeSheet(); router.push({ pathname: '/report/[code]', params: { code } }); }}
            />
          </View>
        ) : null}
      </Sheet>
    </View>
  );
}

function Stat({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Row gap={5}>
        <Icon name={icon} size={14} color={theme.color.textMuted} />
        <T variant="label">{label}</T>
      </Row>
      <T variant="subtitle">{value}</T>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  fill: { flex: 1, backgroundColor: t.color.bg },
  topBar: { position: 'absolute', left: t.space.lg, right: t.space.lg, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cityPill: { borderRadius: t.radius.pill },
  iconPill: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: t.color.surface,
    alignItems: 'center', justifyContent: 'center', ...t.shadow.card,
  },
  dot: {
    position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: t.color.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  dotTxt: { fontWeight: '700', fontSize: 10 },
  loading: { position: 'absolute', top: 120, alignSelf: 'center' },
  sideControls: { position: 'absolute', right: t.space.lg, gap: t.space.md },
  round: { width: 46, height: 46, borderRadius: 23, backgroundColor: t.color.surface, alignItems: 'center', justifyContent: 'center', ...t.shadow.card },
  bottomWrap: { position: 'absolute', left: t.space.lg, right: t.space.lg },
  fabWrap: { position: 'absolute', left: t.space.lg, right: t.space.lg },
}));
