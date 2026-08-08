import React from 'react';
import { View } from 'react-native';
import { theme } from '../lib/theme';
import { useT } from '../i18n';
import { Screen, Header, T, Row, Card, Banner, Divider, Icon } from '../components/ui';

const GOOD = ['Upright on its stand', 'Inside a green parking zone', 'Clear of the pedestrian path', 'Not blocking doors, ramps or crossings'];
const BAD = ['Lying on the ground', 'In a red no-parking zone', 'Blocking the sidewalk', 'On private property or indoors'];

export default function ParkingSchool() {
  const { t } = useT();
  return (
    <Screen edges={['top']} scroll>
      <Header title={t('endRide.parkingSchool')} />
      <View style={{ gap: theme.space.md }}>
        <Banner tone="primary" icon="info" title="Park it right, every time" body="This is exactly what our reviewer (and the AI pre-screen) checks on your end-of-ride photo." />

        <Card>
          <Row gap={8} style={{ marginBottom: theme.space.sm }}>
            <Icon name="check" size={20} color={theme.color.success} />
            <T variant="subtitle" color={theme.color.success}>Good parking</T>
          </Row>
          {GOOD.map((g, i) => (
            <View key={g}>
              {i > 0 ? <Divider /> : null}
              <Row gap={10} style={{ paddingVertical: 6 }}><Icon name="check" size={16} color={theme.color.success} /><T variant="body">{g}</T></Row>
            </View>
          ))}
        </Card>

        <Card>
          <Row gap={8} style={{ marginBottom: theme.space.sm }}>
            <Icon name="close" size={20} color={theme.color.danger} />
            <T variant="subtitle" color={theme.color.danger}>Avoid this</T>
          </Row>
          {BAD.map((b, i) => (
            <View key={b}>
              {i > 0 ? <Divider /> : null}
              <Row gap={10} style={{ paddingVertical: 6 }}><Icon name="close" size={16} color={theme.color.danger} /><T variant="body">{b}</T></Row>
            </View>
          ))}
        </Card>

        <Banner tone="success" icon="bonus" title="Bonus zones" body="End your ride in a glowing bonus zone to earn wallet credit." />
        <Banner tone="warning" icon="station" title="Paid parking" body="Some central spots add a small parking fee, shown before you end." />
      </View>
    </Screen>
  );
}
