// photo-review — AI pre-screen of the end-parking photo (docs/04). Uses Claude vision.
// >= app_config.photo_ai_threshold and "ok" => auto_ok, else stays pending for human
// review in the panel. Missing ANTHROPIC_API_KEY => degrade gracefully (leave pending).
import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient } from '../../_shared/admin.ts';
import { readJson, str } from '../../_shared/validate.ts';
import { signRidePhoto } from '../../_shared/photos.ts';

const MODEL = 'claude-sonnet-4-6'; // per docs/04 (Claude vision parking classifier)

const handler = withErrors(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const body = await readJson(req);
  const tripId = str(body, 'trip_id')!;

  const { data: trip } = await admin
    .from('trips').select('id, end_photo_url, photo_review').eq('id', tripId).single();
  if (!trip) throw new EdgeError('not_found', 'trip not found', 404);
  if (!trip.end_photo_url) throw new EdgeError('no_photo', 'trip has no end photo', 409);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    // Graceful degradation: leave in the human queue.
    return json({ trip_id: tripId, photo_review: 'pending', reason: 'ai_unavailable' });
  }

  // The bucket is private (migration 00570): end_photo_url is an object path, so mint
  // a short-TTL signed url for Anthropic to fetch. A legacy full URL passes through.
  const imageUrl = await signRidePhoto(admin, trip.end_photo_url, 300);
  if (!imageUrl) {
    return json({ trip_id: tripId, photo_review: 'pending', reason: 'photo_unreadable' });
  }

  const threshold = await configNum(admin, 'photo_ai_threshold', 0.85);

  const prompt =
    'You are reviewing an e-scooter end-of-ride parking photo. Judge: is the scooter ' +
    'clearly visible, upright, on a sidewalk edge or rack, and NOT blocking a path, ramp, ' +
    'entrance, or road? Respond ONLY with compact JSON: ' +
    '{"ok": boolean, "confidence": number between 0 and 1, "reason": string}.';

  let ok = false;
  let confidence = 0;
  let reason = 'ai_error';
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'url', url: imageUrl } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}`);
    const data = await res.json() as { content?: { type: string; text?: string }[] };
    const text = (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    const parsed = JSON.parse(extractJson(text));
    ok = !!parsed.ok;
    confidence = Number(parsed.confidence) || 0;
    reason = String(parsed.reason ?? '');
  } catch (e) {
    console.error('photo-review AI failed, leaving pending:', (e as Error).message);
    return json({ trip_id: tripId, photo_review: 'pending', reason: 'ai_error' });
  }

  const decision = ok && confidence >= threshold ? 'auto_ok' : 'pending';
  await admin.from('trips').update({ photo_review: decision }).eq('id', tripId);

  // Record the AI decision for the 10% human-QA sample (docs/04).
  await admin.from('notification_log').insert({
    channel: 'panel', template_key: 'photo_ai_decision', status: 'sent',
    sent_at: new Date().toISOString(),
    payload: { trip_id: tripId, decision, confidence, reason, sampled: Math.random() < 0.1 },
  });

  return json({ trip_id: tripId, photo_review: decision, confidence });
});

function extractJson(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('no json in model output');
  return text.slice(start, end + 1);
}

async function configNum(admin: ReturnType<typeof adminClient>, key: string, dflt: number): Promise<number> {
  const { data } = await admin.from('app_config').select('value').eq('key', key).maybeSingle();
  const v = data?.value;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : dflt;
}

Deno.serve(handler);
