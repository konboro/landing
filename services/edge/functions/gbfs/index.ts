// gbfs — public GBFS 2.3 feeds for aggregators (no auth). Free-floating vehicles come
// from v_public_vehicles with coarse-rounded coordinates. Cache-friendly headers.
// Route: /functions/v1/gbfs[/<feed>]  where <feed> in:
//   (empty) | gbfs | system_information | free_bike_status |
//   station_information | station_status | system_pricing_plans
import { corsHeaders, handlePreflight } from '../../_shared/cors.ts';
import { adminClient } from '../../_shared/admin.ts';

const TTL = 60; // seconds
const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

function feed(data: unknown): Response {
  return new Response(JSON.stringify({
    last_updated: Math.floor(Date.now() / 1000),
    ttl: TTL,
    version: '2.3',
    data,
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${TTL}`,
      ...corsHeaders,
    },
  });
}

Deno.serve(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const idx = parts.indexOf('gbfs');
  const which = idx >= 0 && parts.length > idx + 1 ? parts[idx + 1] : 'gbfs';
  const base = `${url.origin}${parts.slice(0, idx + 1).join('/') ? '/' + parts.slice(0, idx + 1).join('/') : ''}`;

  switch (which) {
    case 'gbfs': {
      const feeds = [
        'system_information', 'free_bike_status', 'station_information',
        'station_status', 'system_pricing_plans',
      ].map((name) => ({ name, url: `${base}/${name}` }));
      return feed({ en: { feeds } });
    }

    case 'system_information': {
      const { data: city } = await admin.from('cities').select('name, tz').limit(1).maybeSingle();
      return feed({
        system_id: 'penny',
        language: 'en',
        name: 'Penny',
        timezone: city?.tz ?? 'Europe/Athens',
        email: 'support@penny.rent',
      });
    }

    case 'free_bike_status': {
      const { data: vehicles } = await admin
        .from('v_public_vehicles').select('vehicle_id, lng, lat, soc_pct, range_m, kind');
      const bikes = (vehicles ?? []).map((v: {
        vehicle_id: string; lng: number; lat: number; soc_pct: number; range_m: number; kind: string;
      }) => ({
        bike_id: v.vehicle_id,
        lat: round5(v.lat),
        lon: round5(v.lng),
        is_reserved: false,
        is_disabled: false,
        vehicle_type_id: v.kind,
        current_range_meters: v.range_m,
      }));
      return feed({ bikes });
    }

    case 'station_information': {
      // Free-floating system: parking_station zones surface as stations.
      const { data: stations } = await admin
        .from('zones').select('id, name').eq('kind', 'parking_station').eq('active', true);
      return feed({
        stations: (stations ?? []).map((s: { id: string; name: string | null }) => ({
          station_id: s.id, name: s.name ?? 'Station',
        })),
      });
    }

    case 'station_status':
      return feed({ stations: [] });

    case 'system_pricing_plans': {
      const { data: plan } = await admin
        .from('pricing_plans').select('unlock_cents, per_min_cents')
        .order('valid_from', { ascending: false }).limit(1).maybeSingle();
      return feed({
        plans: [{
          plan_id: 'standard',
          name: 'Standard',
          currency: 'EUR',
          price: (plan?.unlock_cents ?? 100) / 100,
          is_taxable: true,
          description: 'Unlock fee + per-minute rate.',
          per_min_pricing: [{ start: 0, rate: (plan?.per_min_cents ?? 15) / 100, interval: 1 }],
        }],
      });
    }

    default:
      return new Response(JSON.stringify({ code: 'not_found', message: `unknown feed: ${which}` }), {
        status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
  }
});
