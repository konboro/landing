// scripts/set-staff-password.mjs
// Sets a known password on an existing staff auth user so the panel can be signed
// into headlessly for testing. Run it yourself (uses your management token).
//
//   MGMT_TOKEN   = sbp_...
//   PROJECT_REF  = pyferakmgtafifffqjat
//   STAFF_EMAIL  = owner@penny.rent
//   STAFF_PASSWORD = PennyAdmin!test123
//   node scripts/set-staff-password.mjs

const { MGMT_TOKEN, PROJECT_REF, STAFF_EMAIL, STAFF_PASSWORD } = process.env;
for (const [n, v] of Object.entries({ MGMT_TOKEN, PROJECT_REF, STAFF_EMAIL, STAFF_PASSWORD })) {
  if (!v) { console.error(`missing env ${n}`); process.exit(2); }
}

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${MGMT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const t = await res.text();
  if (!res.ok) throw new Error(`SQL ${res.status}: ${t}`);
  return JSON.parse(t);
}

const rows = await sql(`
  create extension if not exists pgcrypto with schema extensions;
  update auth.users
     set email_confirmed_at = coalesce(email_confirmed_at, now()),
         encrypted_password = extensions.crypt('${STAFF_PASSWORD}', extensions.gen_salt('bf')),
         updated_at = now()
   where email = '${STAFF_EMAIL}'
   returning email, (select role from staff s where s.user_id = auth.users.id and s.active limit 1) as role;`);
console.log('✅ staff password set:', JSON.stringify(rows));
