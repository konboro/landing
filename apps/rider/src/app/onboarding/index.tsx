import React, { useRef, useState } from 'react';
import { View, ScrollView, useWindowDimensions, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { theme } from '../../lib/theme';
import { useT, useI18n, LANGS, LANG_LABEL, type Lang } from '../../i18n';
import { Screen, T, Row, Button, Chip, Icon } from '../../components/ui';

export default function ValueSlides() {
  const router = useRouter();
  const { t } = useT();
  const { lang, setLang } = useI18n();
  const { width } = useWindowDimensions();
  const scroller = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);

  const slides = [
    { icon: 'scan', title: t('onboarding.slide1Title'), body: t('onboarding.slide1Body') },
    { icon: 'parking', title: t('onboarding.slide2Title'), body: t('onboarding.slide2Body') },
    { icon: 'wallet', title: t('onboarding.slide3Title'), body: t('onboarding.slide3Body') },
  ] as const;

  const next = () => {
    if (page < slides.length - 1) {
      scroller.current?.scrollTo({ x: (page + 1) * width, animated: true });
    } else {
      router.push('/onboarding/phone');
    }
  };

  return (
    <Screen edges={['top', 'bottom']} scroll={false} padded={false}>
      <Row justify="space-between" style={{ paddingHorizontal: theme.space.lg, paddingTop: theme.space.sm }}>
        <T variant="heading" color={theme.color.primary}>Penny</T>
        <Row gap={6}>
          {LANGS.map((l: Lang) => <Chip key={l} label={LANG_LABEL[l]} active={lang === l} onPress={() => setLang(l)} />)}
        </Row>
      </Row>

      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
        style={{ flex: 1 }}
      >
        {slides.map((s) => (
          <View key={s.title} style={[styles.slide, { width }]}>
            <View style={styles.iconCircle}><Icon name={s.icon as any} size={64} /></View>
            <T variant="title" center style={{ marginTop: theme.space.xxl }}>{s.title}</T>
            <T variant="body" center color={theme.color.textMuted} style={{ marginTop: theme.space.md }}>{s.body}</T>
          </View>
        ))}
      </ScrollView>

      <View style={{ padding: theme.space.lg, gap: theme.space.md }}>
        <Row gap={6} justify="center">
          {slides.map((_, i) => (
            <View key={i} style={{ height: 6, width: i === page ? 22 : 6, borderRadius: 3, backgroundColor: i === page ? theme.color.primary : theme.color.border }} />
          ))}
        </Row>
        <Button title={page === slides.length - 1 ? t('onboarding.getStarted') : t('common.next')} onPress={next} size="lg" />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  slide: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.space.xxl },
  iconCircle: { width: 140, height: 140, borderRadius: 70, backgroundColor: theme.color.primarySoft, alignItems: 'center', justifyContent: 'center' },
});
