// Add damage — part first, words second.
//
// The part grid is the whole point: a mechanic standing next to the scooter
// knows "rear wheel" instantly and would rather tap once than type. Description
// is optional, which is why either one alone is enough to file the report.
//
// Severity is ours, not in the reference design, and it earns its place: a
// cracked mirror and a dead brake both file as "damage", and without a severity
// the dispatcher has to open every report to find the one that must come off
// the street today.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Image, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Screen, H1, H2, Muted, Button, Card, Row, Field,
  Chip, ChipGroup, Icon, PhotoViewer, type ChipOption, type ChipTone,
} from '../../components/ui';
import { PhotoButton, type CapturedPhoto } from '../../components/PhotoCapture';
import { findVehicleByCode, getVehicle } from '../../offline/repo';
import { createDamage } from '../../offline/actions';
import { DAMAGE_PARTS } from '../../lib/checklists';
import { getCurrentPos } from '../../lib/geoloc';
import { useTheme, makeStyles } from '../../brand';
import type { OpsVehicle } from '../../lib/types';

const MAX_PHOTOS = 3;

const SEVERITIES: { key: string; label: string; tone: ChipTone }[] = [
  { key: 'low', label: 'Low', tone: 'neutral' },
  { key: 'medium', label: 'Medium', tone: 'warning' },
  { key: 'high', label: 'High', tone: 'danger' },
  { key: 'critical', label: 'Critical', tone: 'danger' },
];

/**
 * A capture's `remotePath` is a storage key, not a URI, so it cannot be
 * rendered before the upload lands. We keep the local file URI alongside it and
 * preview that — the report still stores the remote path, which is what syncs.
 */
function displayable(uri: string): boolean {
  return /^(https?|file|data|content|asset|ph):/i.test(uri);
}

export default function NewDamage() {
  const router = useRouter();
  const theme = useTheme();
  const st = useStyles(theme);
  const { c, space } = theme;
  const params = useLocalSearchParams<{ vehicleId?: string; taskId?: string }>();

  const [vehicle, setVehicle] = useState<OpsVehicle | null>(null);
  const [code, setCode] = useState('');
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [part, setPart] = useState<string | null>(null);
  const [desc, setDesc] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [viewer, setViewer] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (params.vehicleId) getVehicle(params.vehicleId).then(setVehicle).catch(() => setVehicle(null));
  }, [params.vehicleId]);

  const partOptions = useMemo<ChipOption[]>(
    () => DAMAGE_PARTS.map((p) => ({ key: p, label: p })),
    [],
  );

  // Spelled out rather than a boolean so the button can say WHY it is dead —
  // a disabled control with no explanation is the most common field complaint.
  const blocker: string | null = !vehicle
    ? 'Pick the vehicle first.'
    : !part && !desc.trim()
      ? 'Choose a part or describe the damage.'
      : null;

  async function findVehicle() {
    const v = await findVehicleByCode(code.trim());
    if (!v) {
      setLookupError(`No vehicle "${code.trim()}"`);
      return;
    }
    setVehicle(v);
    setLookupError(null);
  }

  async function submit() {
    if (!vehicle || blocker) return;
    setSaving(true);
    const { pos } = await getCurrentPos();
    await createDamage(
      vehicle.id,
      desc.trim(),
      severity,
      photos.map((p) => p.remotePath),
      params.taskId ?? null,
      pos,
      { part },
    );
    setSaving(false);
    // No await on the network: the action queued locally, so leaving is safe.
    router.back();
  }

  const previews = photos.map((p) => p.localUri);

  return (
    <Screen scroll>
      <H1>Add damage</H1>

      {vehicle ? (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <H2>{vehicle.code}</H2>
            <Button title="Change" variant="ghost" onPress={() => setVehicle(null)} />
          </Row>
          <Muted>
            {vehicle.model_name} · {vehicle.status.replace('_', ' ')}
          </Muted>
        </Card>
      ) : (
        <Card>
          <Field label="Vehicle code" value={code} onChangeText={setCode} placeholder="ATH-1042" autoFocus />
          <Button title="Find vehicle" onPress={findVehicle} disabled={!code.trim()} />
          {lookupError ? <Text style={st.err}>{lookupError}</Text> : null}
        </Card>
      )}

      <View style={{ gap: space.sm }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <H2>Part</H2>
          {part ? <Muted>tap again to clear</Muted> : <Muted>optional</Muted>}
        </Row>
        <ChipGroup options={partOptions} value={part} onChange={setPart} />
      </View>

      <View style={{ gap: space.sm }}>
        <H2>Severity</H2>
        <Row style={{ flexWrap: 'wrap' }}>
          {SEVERITIES.map((s) => (
            <Chip
              key={s.key}
              label={s.label}
              tone={s.tone}
              icon={s.key === 'critical' ? 'alert' : undefined}
              selected={severity === s.key}
              // Severity always has a value, so this one is NOT de-selectable.
              onPress={() => setSeverity(s.key)}
            />
          ))}
        </Row>
      </View>

      <Field
        label="Description (optional)"
        value={desc}
        onChangeText={setDesc}
        multiline
        placeholder="What's damaged, and how bad…"
      />

      <View style={{ gap: space.sm }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <H2>Photos</H2>
          <Muted>
            {photos.length}/{MAX_PHOTOS} · optional
          </Muted>
        </Row>
        <View style={st.tiles}>
          {Array.from({ length: MAX_PHOTOS }, (_, i) => {
            const shot = photos[i];
            if (shot) {
              return (
                <View key={`shot:${shot.remotePath}`} style={st.tile}>
                  <Pressable
                    onPress={() => setViewer(i)}
                    accessibilityRole="imagebutton"
                    accessibilityLabel={`Preview photo ${i + 1}`}
                    style={({ pressed }) => [st.tileFill, pressed && { opacity: 0.7 }]}
                  >
                    {displayable(shot.localUri) ? (
                      <Image source={{ uri: shot.localUri }} style={st.tileImage} resizeMode="cover" />
                    ) : (
                      <Icon name="photo" size={26} color={c.textMuted} />
                    )}
                  </Pressable>
                  <Pressable
                    onPress={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}
                    hitSlop={14}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove photo ${i + 1}`}
                    style={({ pressed }) => [st.remove, pressed && { opacity: 0.7 }]}
                  >
                    <Icon name="close" size={15} color={c.text} strokeWidth={2.4} />
                  </Pressable>
                </View>
              );
            }
            // Only the next free slot is live; the rest are placeholders, so the
            // row keeps its shape instead of jumping as photos are added.
            if (i === photos.length) {
              return (
                <View key={`add:${i}`} style={[st.tile, st.tileAdd]}>
                  <PhotoButton
                    label="Add"
                    vehicleId={vehicle?.id ?? 'unassigned'}
                    onCaptured={(p) => setPhotos((prev) => (prev.length >= MAX_PHOTOS ? prev : [...prev, p]))}
                  />
                </View>
              );
            }
            return <View key={`slot:${i}`} style={[st.tile, st.tileEmpty]} />;
          })}
        </View>
      </View>

      <Button
        title="Add damage"
        variant="success"
        onPress={submit}
        loading={saving}
        disabled={blocker !== null}
      />
      {blocker ? (
        <Muted style={{ textAlign: 'center' }}>{blocker}</Muted>
      ) : (
        <Muted style={{ textAlign: 'center' }}>
          Queued locally — it syncs when there is signal
          {params.taskId ? ' · linked to the open task' : ''}.
        </Muted>
      )}

      <PhotoViewer
        photos={previews}
        index={viewer ?? 0}
        open={viewer !== null}
        onClose={() => setViewer(null)}
      />
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  err: { color: t.c.danger, fontSize: t.font.size.sm, fontWeight: '600' },
  tiles: { flexDirection: 'row', gap: t.space.sm },
  tile: { flex: 1, height: 104, borderRadius: t.radius.md },
  tileFill: {
    flex: 1,
    borderRadius: t.radius.md,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.c.surfaceAlt,
    borderWidth: 1,
    borderColor: t.c.border,
  },
  tileImage: { width: '100%', height: '100%' },
  tileAdd: { justifyContent: 'center' },
  tileEmpty: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: t.c.border,
    backgroundColor: t.c.surface,
  },
  remove: {
    // Inside the tile on purpose: Android drops touches on a child drawn
    // outside its parent's bounds, so an overhanging ✕ would be a dead tap.
    position: 'absolute',
    top: 4,
    right: 4,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.c.surface,
    borderWidth: 1,
    borderColor: t.c.border,
  },
}));
