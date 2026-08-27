import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../brand';
import { useSession } from '../store/session';
import { getApi, type InboxItem } from '../services';
import { Notifications } from '../lib/native';

/**
 * Renders staff broadcasts that were sent as pop-ups (docs/12) and registers
 * this device for push.
 *
 * Both live here because they share the same trigger: the app came to the
 * foreground with somebody signed in. Mounted once from the root layout, so a
 * pop-up interrupts whatever screen the rider is on — that is the difference
 * between a pop-up and an inbox message.
 */
export function PopupGate() {
  const theme = useTheme();
  const router = useRouter();
  const user = useSession((s) => s.user);
  const [popup, setPopup] = useState<InboxItem | null>(null);
  const registered = useRef(false);

  const check = useCallback(async () => {
    if (!user) return;
    try {
      setPopup(await getApi().getLivePopup());
    } catch {
      // A pop-up that cannot be fetched must never block the app.
    }
  }, [user]);

  // Register the push token once per session, after sign-in. Permission is
  // asked for elsewhere (docs/12 §D: after a successful action, not at boot) —
  // this only picks up a token if the rider already granted it.
  useEffect(() => {
    if (!user || registered.current) return;
    registered.current = true;
    void (async () => {
      try {
        const t = await Notifications.getPushToken();
        if (t) await getApi().registerPushToken(t.token, t.platform);
      } catch {
        /* push stays unavailable; nothing else breaks */
      }
    })();
  }, [user]);

  useEffect(() => {
    void check();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void check(); });
    return () => sub.remove();
  }, [check]);

  const dismiss = useCallback(async (follow: boolean) => {
    const current = popup;
    setPopup(null);
    if (!current) return;
    try { await getApi().dismissPopup(current.id); } catch { /* it will reappear next launch */ }
    if (follow && current.deep_link) {
      // penny://wallet → /wallet. Anything else is left alone rather than guessed at.
      const path = current.deep_link.replace(/^penny:\/\//, '/');
      if (path.startsWith('/')) router.push(path as never);
    }
    // A queue of pop-ups is worked through one at a time.
    void check();
  }, [popup, check, router]);

  if (!popup) return null;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => void dismiss(false)}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 }}>
        <View style={{ backgroundColor: theme.color.surface, borderRadius: theme.radius.lg, padding: 20, maxHeight: '70%' }}>
          {popup.title ? (
            <Text style={{ fontSize: 18, fontWeight: '700', color: theme.color.text, marginBottom: 8 }}>
              {popup.title}
            </Text>
          ) : null}
          <ScrollView style={{ marginBottom: 16 }}>
            <Text style={{ fontSize: 15, lineHeight: 21, color: theme.color.textMuted }}>{popup.body}</Text>
          </ScrollView>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}>
            {popup.deep_link ? (
              <Pressable onPress={() => void dismiss(false)} style={{ paddingVertical: 10, paddingHorizontal: 14 }}>
                <Text style={{ color: theme.color.textMuted, fontWeight: '600' }}>Later</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => void dismiss(true)}
              style={{ backgroundColor: theme.color.primary, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 20 }}
            >
              <Text style={{ color: theme.color.onPrimary, fontWeight: '700' }}>
                {popup.deep_link ? 'Open' : 'Got it'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
