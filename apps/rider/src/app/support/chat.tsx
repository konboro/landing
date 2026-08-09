// Live chat with support.
//
// Backed by the message centre (`inbox_messages`, kind `chat`) — the same place
// system notifications land — so staff answer one conversation per rider rather
// than a thread that lives in a separate system.
//
// Staff replies arrive over realtime; the rider's own turn is appended
// optimistically so the bubble shows the instant Send is tapped.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  ScrollView,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useTheme } from '../../brand';
import { getApi } from '../../services';
import { RiderApiError, type ChatMessage } from '../../services/types';
import { useT } from '../../i18n';
import { Screen, Header, T, Icon, Banner } from '../../components/ui';

export default function ChatScreen() {
  const { t } = useT();
  const theme = useTheme();
  const api = getApi();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<ScrollView>(null);

  /** Realtime and the optimistic insert can both deliver the same row. */
  const append = useCallback((m: ChatMessage) => {
    setMessages((xs) => (xs.some((x) => x.id === m.id) ? xs : [...xs, m]));
  }, []);

  useEffect(() => {
    let alive = true;
    api.getChat().then((xs) => alive && setMessages(xs)).catch(() => undefined);
    // The unsubscribe MUST run on unmount or the channel outlives the screen.
    const off = api.subscribeChat(append);
    return () => {
      alive = false;
      off();
    };
  }, [api, append]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    // Clear immediately: leaving the text in place while the request flies
    // invites a double-send on a slow connection.
    setDraft('');
    try {
      append(await api.sendChatMessage(body));
    } catch (e) {
      setDraft(body); // hand it back rather than losing what they typed
      setError(e instanceof RiderApiError ? e.message : t('common.error'));
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen edges={['top']} padded={false}>
      <Header title={t('support.liveChat')} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <ScrollView
          ref={scroller}
          contentContainerStyle={{ padding: theme.space.lg, gap: theme.space.sm }}
          onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
          keyboardShouldPersistTaps="handled"
        >
          {messages.length === 0 ? (
            <Banner tone="neutral" icon="help" title={t('support.chatEmpty')} />
          ) : null}

          {messages.map((m) => {
            const mine = m.sender === 'rider';
            return (
              <View
                key={m.id}
                style={{
                  alignSelf: mine ? 'flex-end' : 'flex-start',
                  maxWidth: '82%',
                  backgroundColor: mine ? theme.color.primary : theme.color.surface,
                  borderRadius: theme.radius.xl,
                  // Square off the corner nearest the speaker so the bubbles
                  // read as a conversation rather than two stacks of pills.
                  borderBottomRightRadius: mine ? theme.radius.sm : theme.radius.xl,
                  borderBottomLeftRadius: mine ? theme.radius.xl : theme.radius.sm,
                  paddingVertical: theme.space.sm,
                  paddingHorizontal: theme.space.md,
                  ...theme.shadow.card,
                }}
              >
                {!mine && m.agent_name ? (
                  <T variant="label" style={{ color: theme.color.primary, marginBottom: 2 }}>
                    {m.agent_name}
                  </T>
                ) : null}
                <T
                  variant="body"
                  style={{ color: mine ? theme.color.onPrimary : theme.color.text }}
                >
                  {m.body}
                </T>
              </View>
            );
          })}
        </ScrollView>

        {error ? (
          <View style={{ paddingHorizontal: theme.space.lg, paddingBottom: theme.space.sm }}>
            <Banner tone="danger" icon="warning" title={error} />
          </View>
        ) : null}

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            gap: theme.space.sm,
            padding: theme.space.md,
            backgroundColor: theme.color.surface,
          }}
        >
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={t('support.chatPlaceholder')}
            placeholderTextColor={theme.color.textMuted}
            multiline
            style={{
              flex: 1,
              maxHeight: 120,
              minHeight: 44,
              paddingHorizontal: theme.space.md,
              paddingTop: 12,
              paddingBottom: 12,
              borderRadius: theme.radius.xl,
              backgroundColor: theme.color.surfaceAlt,
              color: theme.color.text,
              fontSize: theme.font.size.md,
            }}
          />
          <Pressable
            onPress={send}
            disabled={!draft.trim() || sending}
            accessibilityRole="button"
            accessibilityLabel={t('support.chatSend')}
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: draft.trim() ? theme.color.primary : theme.color.surfaceAlt,
            }}
          >
            <Icon
              name="share"
              size={20}
              color={draft.trim() ? theme.color.onPrimary : theme.color.textMuted}
            />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
