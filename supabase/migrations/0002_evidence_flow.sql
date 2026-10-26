-- Phase 3: evidence flow. Submission, resubmission and arbiter review run as
-- single transactions so an item and its claim tags never half-apply. All
-- functions are security invoker: RLS and the guard triggers still apply.

-- ---------------------------------------------------------------------------
-- Claim tags the arbiter removes are kept for the record, marked dropped.
-- Tags the arbiter adds have no proposed values.
-- ---------------------------------------------------------------------------

alter table public.evidence_claims add column dropped boolean not null default false;
alter table public.evidence_claims alter column proposed_direction drop not null;
alter table public.evidence_claims alter column proposed_strength drop not null;

create or replace function public.guard_evidence_claims() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ev public.evidence;
begin
  if public.is_arbiter() then
    return coalesce(new, old);
  end if;
  select * into ev from public.evidence where id = coalesce(new.evidence_id, old.evidence_id);
  if ev.submitted_by <> auth.uid() or ev.status not in ('pending', 'needs_changes') then
    raise exception 'Only the arbiter can change claim tags on this item.';
  end if;
  if TG_OP <> 'DELETE' and (new.final_direction is not null or new.final_strength is not null or new.discount <> 1 or new.dropped) then
    raise exception 'Final direction, strength and discount are set by the arbiter.';
  end if;
  if TG_OP <> 'DELETE' and (new.proposed_direction is null or new.proposed_strength is null) then
    raise exception 'Propose a direction and strength for every claim you tag.';
  end if;
  return coalesce(new, old);
end $$;

create or replace function public.check_approved_complete() returns trigger
language plpgsql as $$
begin
  if new.status = 'approved' and exists (
    select 1 from public.evidence_claims
    where evidence_id = new.id and not dropped and (final_direction is null or final_strength is null)
  ) then
    raise exception 'Set final direction and strength on every claim tag before approving.';
  end if;
  if new.status = 'approved' and not exists (
    select 1 from public.evidence_claims where evidence_id = new.id and not dropped
  ) then
    raise exception 'An approved item needs at least one claim tag.';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Evidence must describe something that has happened, and only the arbiter
-- tags an item as an expert forecast.
-- ---------------------------------------------------------------------------

create or replace function public.bet_today() returns date
language sql stable security definer set search_path = public as $$
  select (now() at time zone coalesce(
    (select config ->> 'timeZone' from public.config_versions order by version desc limit 1),
    'America/Chicago'))::date
$$;

create or replace function public.guard_evidence_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (TG_OP = 'INSERT' or new.event_date is distinct from old.event_date)
     and new.event_date > public.bet_today() then
    raise exception 'The event date can''t be in the future. Evidence must describe something that happened.';
  end if;
  if not public.is_arbiter() and new.is_expert_forecast
     and (TG_OP = 'INSERT' or not old.is_expert_forecast) then
    raise exception 'Only the arbiter can tag an item as expert-forecast evidence.';
  end if;
  return new;
end $$;

create trigger evidence_rules_guard before insert or update on public.evidence
  for each row execute function public.guard_evidence_rules();

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- item: {title, summary, source_url, source_type, event_date, rationale,
--        claims: [{claim, direction, strength}, ...]}
create or replace function public.insert_proposed_claims(p_id uuid, p_claims jsonb) returns void
language plpgsql security invoker set search_path = public as $$
declare
  tag jsonb;
begin
  if jsonb_typeof(p_claims) is distinct from 'array' or jsonb_array_length(p_claims) = 0 then
    raise exception 'Tag at least one claim.';
  end if;
  for tag in select * from jsonb_array_elements(p_claims) loop
    insert into public.evidence_claims (evidence_id, claim, proposed_direction, proposed_strength)
    values (p_id, tag ->> 'claim', tag ->> 'direction', (tag ->> 'strength')::smallint);
  end loop;
end $$;

create or replace function public.check_submission(item jsonb) returns void
language plpgsql immutable as $$
begin
  if coalesce(btrim(item ->> 'rationale'), '') = '' then
    raise exception 'Explain why this evidence matters (rationale is required).';
  end if;
end $$;

create or replace function public.submit_evidence(item jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  new_id uuid;
begin
  perform public.check_submission(item);
  insert into public.evidence (title, summary, source_url, source_type, event_date, rationale)
  values (
    btrim(item ->> 'title'),
    coalesce(btrim(item ->> 'summary'), ''),
    btrim(item ->> 'source_url'),
    item ->> 'source_type',
    (item ->> 'event_date')::date,
    btrim(item ->> 'rationale')
  )
  returning id into new_id;
  perform public.insert_proposed_claims(new_id, item -> 'claims');
  return new_id;
end $$;

-- The submitter edits a pending or needs-changes item; it goes back to pending.
create or replace function public.resubmit_evidence(p_id uuid, item jsonb) returns void
language plpgsql security invoker set search_path = public as $$
begin
  perform public.check_submission(item);
  update public.evidence set
    title       = btrim(item ->> 'title'),
    summary     = coalesce(btrim(item ->> 'summary'), ''),
    source_url  = btrim(item ->> 'source_url'),
    source_type = item ->> 'source_type',
    event_date  = (item ->> 'event_date')::date,
    rationale   = btrim(item ->> 'rationale'),
    status      = 'pending'
  where id = p_id and submitted_by = auth.uid();
  if not found then
    raise exception 'You can only edit your own submissions.';
  end if;
  -- Draft tags are replaced wholesale; the audit log keeps the old ones.
  delete from public.evidence_claims where evidence_id = p_id;
  perform public.insert_proposed_claims(p_id, item -> 'claims');
end $$;

-- p_claims (used on approval): [{claim, direction, strength, discount}, ...].
-- Tags not listed are marked dropped. p_links replaces the item's related links.
create or replace function public.review_evidence(
  p_id uuid,
  p_decision text,
  p_note text,
  p_claims jsonb default '[]'::jsonb,
  p_is_expert_forecast boolean default null,
  p_links uuid[] default null
) returns void
language plpgsql security invoker set search_path = public as $$
declare
  tag jsonb;
begin
  if not public.is_arbiter() then
    raise exception 'Only the arbiter reviews evidence.';
  end if;
  if p_decision not in ('approved', 'rejected', 'needs_changes') then
    raise exception 'Unknown decision: %', p_decision;
  end if;
  if p_decision in ('rejected', 'needs_changes') and coalesce(btrim(p_note), '') = '' then
    raise exception 'A note is required to reject an item or request changes.';
  end if;
  if not exists (select 1 from public.evidence where id = p_id) then
    raise exception 'No such evidence item.';
  end if;

  if p_decision = 'approved' then
    update public.evidence_claims set dropped = true
    where evidence_id = p_id
      and claim not in (select x ->> 'claim' from jsonb_array_elements(p_claims) x);
    for tag in select * from jsonb_array_elements(p_claims) loop
      insert into public.evidence_claims as c (evidence_id, claim, final_direction, final_strength, discount, dropped)
      values (p_id, tag ->> 'claim', tag ->> 'direction', (tag ->> 'strength')::smallint,
              coalesce((tag ->> 'discount')::numeric, 1), false)
      on conflict (evidence_id, claim) do update set
        final_direction = excluded.final_direction,
        final_strength  = excluded.final_strength,
        discount        = excluded.discount,
        dropped         = false;
    end loop;

    if p_links is not null then
      delete from public.evidence_links where evidence_id = p_id and not (related_id = any (p_links));
      insert into public.evidence_links (evidence_id, related_id)
      select p_id, r from unnest(p_links) r where r <> p_id
      on conflict do nothing;
    end if;
  end if;

  update public.evidence set
    status             = p_decision,
    decision_note      = nullif(btrim(p_note), ''),
    is_expert_forecast = coalesce(p_is_expert_forecast, is_expert_forecast)
  where id = p_id;
end $$;

-- Bettors cannot flag their own submissions as expert forecasts at insert time either.
drop policy submit_evidence on public.evidence;
create policy submit_evidence on public.evidence for insert
  with check (public.is_bettor() and submitted_by = auth.uid() and status = 'pending' and not is_expert_forecast);
