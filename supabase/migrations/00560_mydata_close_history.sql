-- 00560_mydata_close_history.sql
--
-- Close the inherited backlog in one decision.
--
-- Importing 20 months of history brought 20 months of its problems: 578 gaps,
-- 32 duplicates, 40 legacy failures, 5 orphan payments. All of it is real, and
-- none of it is work anybody is going to do — nobody files a receipt for
-- December 2024. But a queue that opens at 615 is a queue nobody opens twice,
-- and the handful of items that WILL matter would be lost in it.
--
-- 00530 gave every issue an identity so it could be acknowledged, and 00540
-- added a bulk accept for one contiguous gap range. Neither is enough: clearing
-- this by hand still means several passes across four different issue kinds.
--
-- This is deliberately an acknowledgement, not a deletion and not a "fixed"
-- flag. The rows stay, "Show reviewed" still lists them, the note says who
-- decided and why, and `audit_log` records it. Closed, not hidden.

create or replace function mydata_ack_historical(
  p_before date,
  p_staff  uuid,
  p_note   text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n int := 0;
begin
  if p_note is null or length(trim(p_note)) = 0 then
    raise exception 'mydata_ack_historical: a note is required — this is a decision, not a cleanup';
  end if;
  if p_before is null then
    raise exception 'mydata_ack_historical: a cutoff date is required';
  end if;
  if p_before > current_date then
    raise exception
      'mydata_ack_historical: refusing a cutoff in the future (%) — that would close issues nobody has seen yet',
      p_before;
  end if;

  for r in
    select i.kind, i.issue_key, i.aa, i.series, i.issue_date
      from v_mydata_issues i
      left join mydata_series ms on ms.series = i.series
     where i.reviewed_at is null
       and (
         i.issue_date < p_before
         -- Gaps below the series floor are legacy by definition: those numbers
         -- were issued by the old system and this platform can never reach them.
         -- Matched on the floor rather than on a date because 538 of them have
         -- no date at all — the block consumed on 2026-06-17 left no rows.
         or (i.kind = 'gap' and ms.floor_aa is not null and i.aa < ms.floor_aa)
       )
  loop
    if r.issue_key like 'submission:%' then
      -- Backed by a real receipt: the note belongs on the receipt itself, next
      -- to whatever else has been done to it.
      update mydata_submissions
         set review_note = trim(p_note), reviewed_by = p_staff, reviewed_at = now()
       where id = substring(r.issue_key from 12)::uuid
         and reviewed_at is null;
    else
      insert into mydata_issue_reviews (issue_kind, issue_key, note, reviewed_by)
      values (r.kind, r.issue_key, trim(p_note), p_staff)
      on conflict (issue_kind, issue_key) do nothing;
    end if;
    n := n + 1;
  end loop;

  return n;
end $$;

revoke all on function mydata_ack_historical(date, uuid, text) from public, anon, authenticated;
grant execute on function mydata_ack_historical(date, uuid, text) to service_role;

comment on function mydata_ack_historical(date, uuid, text) is
  'Acknowledge every open myDATA issue older than a cutoff, plus every series gap below the floor. Records a note and a reviewer against each; nothing is deleted or marked filed.';

/* ---------------------------------------------------------------------------
   How many are we talking about?
   --------------------------------------------------------------------------- */

-- So the panel can say "this will close 615 items" before anybody presses the
-- button, rather than after.
create or replace view v_mydata_issue_ages as
select
  case
    when i.reviewed_at is not null                       then 'reviewed'
    when i.issue_date >= current_date - interval '30 days' then 'recent'
    else 'historical'
  end                                   as bucket,
  i.kind,
  count(*)                              as items
from v_mydata_issues i
group by 1, 2;

comment on view v_mydata_issue_ages is
  'Open myDATA issues split into recent (last 30 days), historical, and already reviewed. Drives the "close the backlog" prompt.';

revoke all on v_mydata_issue_ages from anon, authenticated;
