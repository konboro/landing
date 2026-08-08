// Deterministic Sumsub applicant fixtures — one per customer, covering every
// review state the panel must render (GREEN, RED/FINAL, RED/RETRY, pending,
// onHold and "no applicant"). Document images are inline SVG data-URIs so the
// gallery + lightbox work with zero network access.
import { Rng } from '@/lib/rng';
import { documentDataUri } from './media';
import type {
  CustomerRow,
  SumsubDocType,
  SumsubDocument,
  SumsubProfile,
  SumsubProfileBundle,
  SumsubReviewEvent,
  SumsubReviewStatus,
} from '@/types/domain';

type Flavour = 'green' | 'red_final' | 'red_retry_photo' | 'red_retry_screenshot' | 'pending' | 'on_hold' | 'none';

const COUNTRY_BY_NATIONALITY: Record<string, string> = { GR: 'GRC', PL: 'POL', DE: 'DEU', UK: 'GBR' };

const BIRTH_PLACES: Record<string, string[]> = {
  GR: ['Athens', 'Thessaloniki', 'Patras', 'Heraklion', 'Larissa'],
  PL: ['Warszawa', 'Kraków', 'Gdańsk', 'Wrocław'],
  DE: ['Berlin', 'München', 'Hamburg', 'Köln'],
  UK: ['London', 'Manchester', 'Bristol', 'Leeds'],
};

const MODERATION: Record<Flavour, string | null> = {
  green: null,
  red_final: 'Document shows signs of digital manipulation (edited expiry field). Applicant permanently rejected — do not allow re-submission.',
  red_retry_photo: 'The photo of your document is blurry and the number is unreadable. Please retake it in good light, showing all four corners.',
  red_retry_screenshot: 'A screenshot was uploaded instead of a photo of the physical document. Please upload an original photo.',
  pending: null,
  on_hold: 'Applicant put on hold pending sanctions/PEP screening review by compliance.',
  none: null,
};

const REJECT_LABELS: Record<Flavour, string[]> = {
  green: [],
  red_final: ['FORGERY', 'DOCUMENT_TEMPLATE'],
  red_retry_photo: ['BAD_PHOTO', 'UNSATISFACTORY_PHOTOS'],
  red_retry_screenshot: ['SCREENSHOT', 'BAD_PHOTO'],
  pending: [],
  on_hold: ['COMPLIANCE_CHECK'],
  none: [],
};

/** Deterministic flavour per customer, honouring their stored kyc_status. */
function flavourFor(customer: CustomerRow, rng: Rng): Flavour {
  switch (customer.kyc_status) {
    case 'approved':
      return 'green';
    case 'rejected':
      return rng.pick<Flavour>(['red_final', 'red_retry_photo', 'red_retry_screenshot']);
    case 'pending':
      return rng.bool(0.7) ? 'pending' : 'on_hold';
    case 'expired':
      return 'red_retry_photo';
    default:
      return 'none';
  }
}

const STATUS_BY_FLAVOUR: Record<Flavour, SumsubReviewStatus> = {
  green: 'completed',
  red_final: 'completed',
  red_retry_photo: 'completed',
  red_retry_screenshot: 'completed',
  pending: 'pending',
  on_hold: 'onHold',
  none: 'init',
};

function iso(daysAgo: number, rng: Rng): string {
  return new Date(Date.now() - daysAgo * 86400000 - rng.int(0, 20 * 3600000)).toISOString();
}

function docsFor(flavour: Flavour, name: string, nationality: string, docNumber: string, expiry: string, rng: Rng): SumsubDocument[] {
  const country = COUNTRY_BY_NATIONALITY[nationality] ?? 'GRC';
  const primary: SumsubDocType = rng.bool(0.55) ? 'ID_CARD' : rng.bool(0.6) ? 'PASSPORT' : 'DRIVERS';
  const plan: Array<{ t: SumsubDocType; s: 'FRONT_SIDE' | 'BACK_SIDE' | null }> = [];
  if (primary === 'ID_CARD') {
    plan.push({ t: 'ID_CARD', s: 'FRONT_SIDE' }, { t: 'ID_CARD', s: 'BACK_SIDE' });
  } else {
    plan.push({ t: primary, s: 'FRONT_SIDE' });
  }
  plan.push({ t: 'SELFIE', s: null });
  if (rng.bool(0.55)) plan.push({ t: 'DRIVERS', s: 'FRONT_SIDE' });
  if (rng.bool(0.3)) plan.push({ t: 'PASSPORT', s: 'FRONT_SIDE' });

  const failing = flavour.startsWith('red');
  return plan.map((p, i) => {
    // On a RED applicant the offending doc is the one carrying the labels.
    const offending = failing && i === (flavour === 'red_retry_screenshot' ? 0 : Math.min(1, plan.length - 1));
    return {
      image_id: `img_${rng.int(100000000, 999999999)}`,
      doc_type: p.t,
      doc_sub_type: p.s,
      country,
      valid_until: p.t === 'SELFIE' ? null : expiry,
      review_answer: offending ? 'RED' : failing ? null : 'GREEN',
      reject_labels: offending ? REJECT_LABELS[flavour] : [],
      url: documentDataUri({
        docType: p.t,
        subType: p.s,
        name,
        docNumber: p.t === 'SELFIE' ? null : docNumber,
        country,
        expiry,
        rejected: offending,
      }),
      content_type: 'image/svg+xml',
      added_at: iso(rng.int(1, 60), rng),
    };
  });
}

function historyFor(flavour: Flavour, createdAt: string, reviewedAt: string | null, rng: Rng): SumsubReviewEvent[] {
  const events: SumsubReviewEvent[] = [
    { at: createdAt, review_status: 'init', review_answer: null, reject_labels: [], moderation_comment: null },
    {
      at: new Date(new Date(createdAt).getTime() + rng.int(2, 40) * 60000).toISOString(),
      review_status: 'pending', review_answer: null, reject_labels: [], moderation_comment: 'Documents submitted, queued for review.',
    },
  ];
  if (flavour === 'pending') return events;
  if (flavour === 'on_hold') {
    events.push({
      at: new Date(new Date(createdAt).getTime() + rng.int(1, 8) * 3600000).toISOString(),
      review_status: 'onHold', review_answer: null, reject_labels: REJECT_LABELS.on_hold, moderation_comment: MODERATION.on_hold,
    });
    return events;
  }
  if (flavour === 'green' && rng.bool(0.4)) {
    // one retry before approval — nice for the timeline
    const t = new Date(new Date(createdAt).getTime() + rng.int(1, 5) * 3600000).toISOString();
    events.push({ at: t, review_status: 'completed', review_answer: 'RED', reject_labels: ['BAD_PHOTO'], moderation_comment: MODERATION.red_retry_photo });
    events.push({ at: new Date(new Date(t).getTime() + rng.int(1, 20) * 3600000).toISOString(), review_status: 'pending', review_answer: null, reject_labels: [], moderation_comment: 'Re-submitted after retry.' });
  }
  events.push({
    at: reviewedAt ?? new Date().toISOString(),
    review_status: 'completed',
    review_answer: flavour === 'green' ? 'GREEN' : 'RED',
    reject_labels: REJECT_LABELS[flavour],
    moderation_comment: MODERATION[flavour],
  });
  return events;
}

export function buildSumsubBundle(customer: CustomerRow, opts: {
  nationality: string;
  dob: string | null;
  gender: 'M' | 'F' | 'X' | null;
  city: string;
}): SumsubProfileBundle {
  const rng = new Rng(customer.id.split('').reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7));
  const flavour = flavourFor(customer, rng);
  const fetchedAt = new Date().toISOString();

  if (flavour === 'none' || !customer.sumsub_applicant_id) {
    return { applicant: null, documents: [], history: [], fetched_at: fetchedAt, source: 'live' };
  }

  const parts = (customer.full_name ?? 'Unknown Rider').split(/\s+/);
  const firstName = parts[0] ?? null;
  const lastName = parts.length > 1 ? parts[parts.length - 1]! : null;
  const country = COUNTRY_BY_NATIONALITY[opts.nationality] ?? 'GRC';
  const docNumber = `${opts.nationality}${rng.int(1000000, 9999999)}`;
  const expiryDate = new Date(Date.now() + rng.int(120, 2400) * 86400000).toISOString().slice(0, 10);
  const createdAt = iso(rng.int(20, 300), rng);
  const reviewed = flavour === 'pending' ? null : new Date(new Date(createdAt).getTime() + rng.int(1, 48) * 3600000).toISOString();
  const documents = docsFor(flavour, customer.full_name ?? 'Unknown Rider', opts.nationality, docNumber, expiryDate, rng);
  const primaryDoc = documents.find((d) => d.doc_type !== 'SELFIE') ?? null;

  const applicant: SumsubProfile = {
    applicant_id: customer.sumsub_applicant_id,
    level: rng.bool(0.85) ? 'basic-kyc-level' : 'id-and-liveness',
    inspection_id: `insp_${rng.int(100000000, 999999999)}`,
    external_user_id: customer.id,
    review_status: STATUS_BY_FLAVOUR[flavour],
    review_answer: flavour === 'green' ? 'GREEN' : flavour.startsWith('red') ? 'RED' : null,
    review_reject_type: flavour === 'red_final' ? 'FINAL' : flavour.startsWith('red') ? 'RETRY' : null,
    reject_labels: REJECT_LABELS[flavour],
    moderation_comment: MODERATION[flavour],
    client_comment: flavour === 'red_final' ? 'Escalated to compliance — suspected template forgery.' : null,
    first_name: firstName,
    last_name: lastName,
    middle_name: rng.bool(0.2) ? rng.pick(['A.', 'M.', 'K.']) : null,
    dob: opts.dob,
    nationality: country,
    country,
    place_of_birth: rng.pick(BIRTH_PLACES[opts.nationality] ?? BIRTH_PLACES.GR!),
    gender: opts.gender,
    id_doc_type: primaryDoc?.doc_type ?? null,
    id_doc_number: docNumber,
    id_doc_expiry: expiryDate,
    id_doc_country: country,
    phone: customer.phone,
    email: customer.email,
    applicant_created_at: createdAt,
    reviewed_at: reviewed,
    live: true,
  };

  return {
    applicant,
    documents,
    history: historyFor(flavour, createdAt, reviewed, rng),
    fetched_at: fetchedAt,
    source: 'live',
  };
}
