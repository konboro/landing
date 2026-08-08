import React, { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../brand';
import { Haptics } from '../../lib/native';
import { getApi } from '../../services';
import { useT } from '../../i18n';
import { Screen, Header, T, Card, Button, Banner, TextField, Chip, Row, Icon } from '../../components/ui';

const ISSUES = ['Damaged', 'Won’t unlock', 'Flat tyre', 'Brakes', 'Wrongly parked', 'Other'];

export default function ReportProblemScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const router = useRouter();
  const { t } = useT();
  const theme = useTheme();
  const api = getApi();
  const hasCode = code && code !== 'none';

  const [vehicleCode, setVehicleCode] = useState(hasCode ? String(code) : '');
  const [issue, setIssue] = useState('');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api.reportVehicleProblem(vehicleCode, `${issue}: ${note}`, photos);
      Haptics.success();
      setDone(true);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Screen edges={['top']}>
        <Header title={t('support.reportVehicle')} />
        <View style={{ padding: theme.space.lg, gap: theme.space.md }}>
          <Banner tone="success" icon="check" title="Thanks — report received" body="Our ops team will take a look. No trip needed." />
          <Button title={t('common.done')} onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['top']} scroll>
      <Header title={t('support.reportVehicle')} />
      <View style={{ gap: theme.space.md }}>
        <Card>
          <TextField label={t('scan.manualTitle')} placeholder="PNY-4821" autoCapitalize="characters" value={vehicleCode} onChangeText={setVehicleCode} />
        </Card>
        <T variant="label">What’s wrong?</T>
        <Row wrap gap={theme.space.sm}>
          {ISSUES.map((i) => <Chip key={i} label={i} active={issue === i} onPress={() => setIssue(i)} />)}
        </Row>
        <TextField placeholder="Describe the issue…" multiline value={note} onChangeText={setNote} style={{ minHeight: 90 }} />
        <Button title={`${t('history.addPhotos')} (${photos.length})`} icon="camera" variant="secondary" onPress={() => setPhotos((p) => [...p, `mock://photo/report-${p.length}.jpg`])} />
        <Button title="Submit report" icon="flag" loading={busy} disabled={!vehicleCode || !issue} onPress={submit} />
      </View>
    </Screen>
  );
}
