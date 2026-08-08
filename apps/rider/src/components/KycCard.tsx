import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { formatDateTime } from '@penny/ui';
import { theme } from '../lib/theme';
import { getApi } from '../services';
import type { KycDetail, KycDocument } from '../services/types';
import { useT } from '../i18n';
import { T, Row, Card, Button, Badge, Icon, Divider } from './ui';

/**
 * The rider's own verification state — the rider-facing counterpart of the
 * admin Sumsub panel. Shows only this rider's data; document images are never
 * fetched into the app (Hard Rule #11), just their kind and per-doc status.
 */
export function KycCard() {
  const { t } = useT();
  const api = getApi();
  const router = useRouter();
  const [kyc, setKyc] = useState<KycDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getKycDetail()
      .then(setKyc)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [api]);

  if (loading) {
    return (
      <Card>
        <Row gap={10} align="center">
          <ActivityIndicator />
          <T variant="body">{t('common.loading')}</T>
        </Row>
      </Card>
    );
  }
  if (!kyc) return null;

  const tone =
    kyc.status === 'approved'
      ? 'success'
      : kyc.status === 'rejected' || kyc.status === 'expired'
        ? 'danger'
        : kyc.status === 'pending'
          ? 'warning'
          : 'neutral';

  const body =
    kyc.status === 'approved'
      ? t('kycCard.approvedBody')
      : kyc.status === 'pending'
        ? t('kycCard.pendingBody')
        : kyc.status === 'none'
          ? t('kycCard.noneBody')
          : (kyc.reject_reason ?? '');

  const heading =
    kyc.status === 'rejected'
      ? t('kycCard.rejectedTitle')
      : kyc.status === 'expired'
        ? t('kycCard.expiredTitle')
        : t('kycCard.title');

  return (
    <Card>
      <Row justify="space-between" align="center">
        <Row gap={8} align="center">
          <Icon name="shield" size={18} color={theme.color.primary} />
          <T variant="subtitle">{heading}</T>
        </Row>
        <Badge tone={tone} label={t(`kyc.${kyc.status}`)} />
      </Row>

      {body ? (
        <T variant="body" style={{ marginTop: 6, color: theme.color.textMuted }}>
          {body}
        </T>
      ) : null}

      {kyc.reject_labels.length > 0 ? (
        <Row gap={6} style={{ flexWrap: 'wrap', marginTop: theme.space.sm }}>
          {kyc.reject_labels.map((l) => (
            <Badge key={l} tone="danger" label={l.replace(/_/g, ' ').toLowerCase()} />
          ))}
        </Row>
      ) : null}

      {kyc.documents.length > 0 ? (
        <>
          <Divider style={{ marginVertical: theme.space.sm }} />
          <T variant="caption">{t('kycCard.documents')}</T>
          <View style={{ gap: 6, marginTop: 6 }}>
            {kyc.documents.map((d: KycDocument) => (
              <Row key={`${d.kind}-${d.label}`} justify="space-between" align="center">
                <Row gap={8} align="center">
                  <Icon name="camera" size={14} color={theme.color.textMuted} />
                  <T variant="body">{d.label}</T>
                </Row>
                <Badge
                  tone={d.status === 'approved' ? 'success' : d.status === 'rejected' ? 'danger' : 'neutral'}
                  label={
                    d.status === 'approved'
                      ? t('kycCard.docApproved')
                      : d.status === 'rejected'
                        ? t('kycCard.docRejected')
                        : t('kycCard.docPending')
                  }
                />
              </Row>
            ))}
          </View>
        </>
      ) : null}

      <Divider style={{ marginVertical: theme.space.sm }} />
      <T variant="caption">{t('kycCard.level')}: {kyc.level}</T>
      {kyc.submitted_at ? (
        <T variant="caption">{t('kycCard.submitted', { when: formatDateTime(kyc.submitted_at) })}</T>
      ) : null}
      {kyc.reviewed_at ? (
        <T variant="caption">{t('kycCard.reviewed', { when: formatDateTime(kyc.reviewed_at) })}</T>
      ) : null}
      {kyc.expires_at ? (
        <T variant="caption">{t('kycCard.expires', { when: formatDateTime(kyc.expires_at) })}</T>
      ) : null}
      {kyc.applicant_ref ? (
        <T variant="caption">{t('kycCard.ref', { ref: kyc.applicant_ref })}</T>
      ) : null}
      <T variant="caption" style={{ marginTop: 2 }}>
        {t('kycCard.provider', { provider: kyc.provider })}
      </T>

      {kyc.can_retry || kyc.status === 'none' ? (
        <Button
          title={kyc.status === 'none' ? t('kycCard.start') : t('kycCard.retry')}
          icon="shield"
          onPress={() => router.push('/onboarding/kyc')}
          style={{ marginTop: theme.space.md }}
        />
      ) : null}
    </Card>
  );
}
