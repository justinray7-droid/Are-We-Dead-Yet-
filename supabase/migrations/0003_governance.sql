-- Phase 5: governance. Change requests open with the requester's approval in
-- one step, proposals and config are validated in the database, the bet's
-- terms are locked, and arbiter actions are checked against current state.

-- ---------------------------------------------------------------------------
-- Config: every version must be valid for the engine, or every page breaks.
-- Priors and the bet's terms (dates, time zone, combination) never change
-- directly; the arbiter can recalibrate everything else with a note.
-- ---------------------------------------------------------------------------

alter table public.config_versions alter column created_by set default auth.uid();

create or replace function public.validate_config() returns trigger
language plpgsql as $$
declare
  c jsonb := new.config;
  k text;
  v numeric;
begin
  foreach k in array array['A', 'B_LOOSE', 'B_STRICT', 'C'] loop
    v := (c -> 'priors' ->> k)::numeric;
    if v is null or v <= 0 or v >= 1 then
      raise exception 'Prior for % must be between 0 and 1.', k;
    end if;
  end loop;
  foreach k in array array['1', '2', '3', '4', '5'] loop
    v := (c -> 'strengthLR' ->> k)::numeric;
    if v is null or v < 1 then
      raise exception 'The LR for strength % must be at least 1.', k;
    end if;
  end loop;
  if jsonb_typeof(c -> 'decay' -> 'enabled') is distinct from 'boolean' then
    raise exception 'Decay must be on or off.';
  end if;
  if coalesce((c -> 'decay' ->> 'lr')::numeric, 0) < 1 then
    raise exception 'The decay LR must be at least 1.';
  end if;
  if (c -> 'decay' ->> 'skipThreshold') is null or (c -> 'decay' ->> 'skipThreshold')::int not between 1 and 5 then
    raise exception 'The decay skip threshold must be a strength from 1 to 5.';
  end if;
  if coalesce((c ->> 'backdateFlagDays')::int, -1) < 0 then
    raise exception 'The backdated-flag threshold must be zero or more days.';
  end if;
  if coalesce((c ->> 'forecastMaxLR')::numeric, 0) < 1 then
    raise exception 'The expert-forecast cap must be at least 1.';
  end if;
  foreach k in array array['perItemLR', 'perDayLR'] loop
    if jsonb_typeof(c -> 'caps' -> k) = 'number' and (c -> 'caps' ->> k)::numeric < 1 then
      raise exception 'Caps must be at least 1, or off.';
    elsif jsonb_typeof(c -> 'caps' -> k) not in ('number', 'null') then
      raise exception 'Caps must be a number or off.';
    end if;
  end loop;
  if (c ->> 'resolutionDate')::date <= (c ->> 'startDate')::date then
    raise exception 'The resolution date must be after the start date.';
  end if;
  if new.request_id is null and new.version > 1 and coalesce(btrim(new.note), '') = '' then
    raise exception 'Say why the settings changed.';
  end if;
  return new;
end $$;

create trigger config_validate before insert on public.config_versions
  for each row execute function public.validate_config();

create or replace function public.guard_config_priors() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  prev jsonb;
  k text;
begin
  select config into prev from public.config_versions where version < new.version order by version desc limit 1;
  if prev is null or new.request_id is not null then
    return new;
  end if;
  if (prev -> 'priors') is distinct from (new.config -> 'priors') then
    raise exception 'Priors can only change through a change request approved by both bettors.';
  end if;
  foreach k in array array['startDate', 'resolutionDate', 'timeZone', 'combination'] loop
    if (prev -> k) is distinct from (new.config -> k) then
      raise exception 'The bet''s dates, time zone and combination rule are locked.';
    end if;
  end loop;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Change requests: validated on insert; the requester's approval is recorded
-- in the same transaction by propose_change.
-- ---------------------------------------------------------------------------

create or replace function public.check_change_request() returns trigger
language plpgsql as $$
declare
  k text;
  v jsonb;
begin
  if coalesce(btrim(new.rationale), '') = '' then
    raise exception 'Explain why the change is needed.';
  end if;
  if new.kind = 'priors' then
    if jsonb_typeof(new.proposed -> 'priors') is distinct from 'object' or new.proposed -> 'priors' = '{}'::jsonb then
      raise exception 'Propose at least one prior.';
    end if;
    for k, v in select * from jsonb_each(new.proposed -> 'priors') loop
      if k not in ('A', 'B_LOOSE', 'B_STRICT', 'C') then
        raise exception 'Unknown claim: %', k;
      end if;
      if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric <= 0 or (v #>> '{}')::numeric >= 1 then
        raise exception 'Priors must be between 0 and 1.';
      end if;
    end loop;
  else
    if coalesce(btrim(new.proposed ->> 'change_log'), '') = '' then
      raise exception 'Describe the change for the change log.';
    end if;
    if jsonb_typeof(new.proposed -> 'definitions') is distinct from 'object' or new.proposed -> 'definitions' = '{}'::jsonb then
      raise exception 'Change at least one definition.';
    end if;
    for k, v in select * from jsonb_each(new.proposed -> 'definitions') loop
      if k not in ('autonomous', 'claim_a', 'claim_b_loose', 'claim_b_strict', 'claim_c', 'deciding_rule') then
        raise exception 'Unknown definition: %', k;
      end if;
      if coalesce(btrim(v ->> 'title'), '') = '' and coalesce(btrim(v ->> 'body'), '') = '' then
        raise exception 'A changed definition needs a title or body.';
      end if;
    end loop;
  end if;
  return new;
end $$;

create trigger change_request_check before insert on public.change_requests
  for each row execute function public.check_change_request();

create or replace function public.propose_change(p_kind text, p_proposed jsonb, p_rationale text) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  new_id uuid;
begin
  insert into public.change_requests (kind, proposed, rationale)
  values (p_kind, p_proposed, btrim(p_rationale))
  returning id into new_id;
  insert into public.change_approvals (request_id, decision, note) values (new_id, 'approve', 'Proposed it');
  return new_id;
end $$;

-- ---------------------------------------------------------------------------
-- Arbiter actions: a waiver can be revoked; actions must make sense now.
-- ---------------------------------------------------------------------------

alter table public.arbiter_actions drop constraint arbiter_actions_kind_check;
alter table public.arbiter_actions add constraint arbiter_actions_kind_check
  check (kind in ('decay_waiver', 'decay_waiver_revoked', 'claim_a_satisfied', 'claim_a_unsatisfied', 'final_ruling'));
alter table public.arbiter_actions add constraint arbiter_actions_revoke_month
  check (kind <> 'decay_waiver_revoked' or month is not null);

create or replace function public.claim_a_is_satisfied() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select kind = 'claim_a_satisfied' from public.arbiter_actions
    where kind in ('claim_a_satisfied', 'claim_a_unsatisfied')
    order by created_at desc, id desc limit 1
  ), false)
$$;

create or replace function public.decay_is_waived(p_month text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select kind = 'decay_waiver' from public.arbiter_actions
    where kind in ('decay_waiver', 'decay_waiver_revoked') and month = p_month
    order by created_at desc, id desc limit 1
  ), false)
$$;

create or replace function public.check_arbiter_action() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cfg jsonb := (select config from public.config_versions order by version desc limit 1);
  first_month text := to_char(date_trunc('month', (cfg ->> 'startDate')::date) + interval '1 month', 'YYYY-MM');
  last_month text := to_char((cfg ->> 'resolutionDate')::date, 'YYYY-MM');
begin
  if new.kind in ('decay_waiver', 'decay_waiver_revoked')
     and (new.month < first_month or new.month > last_month) then
    raise exception 'Decay steps run from % to %.', first_month, last_month;
  end if;
  if new.kind = 'decay_waiver_revoked' and not public.decay_is_waived(new.month) then
    raise exception '% is not waived.', new.month;
  end if;
  if new.kind = 'claim_a_satisfied' then
    if public.claim_a_is_satisfied() then
      raise exception 'Claim A is already marked satisfied.';
    end if;
    if new.effective_on < (cfg ->> 'startDate')::date or new.effective_on > public.bet_today() then
      raise exception 'The satisfied date must be between the bet start and today.';
    end if;
    if exists (
      select 1 from unnest(new.evidence_ids) e
      where not exists (select 1 from public.evidence where id = e and status = 'approved')
    ) then
      raise exception 'Link only approved evidence.';
    end if;
  end if;
  if new.kind = 'claim_a_unsatisfied' and not public.claim_a_is_satisfied() then
    raise exception 'Claim A is not marked satisfied.';
  end if;
  return new;
end $$;

create trigger arbiter_action_check before insert on public.arbiter_actions
  for each row execute function public.check_arbiter_action();
