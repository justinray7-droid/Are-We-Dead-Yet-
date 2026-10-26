-- Phase 6: resolution mode. Shaun's final ruling is an arbiter action
-- (kind final_ruling). It opens 30 days before the resolution date, rules on
-- every claim and on the bet, and may be amended; the latest ruling stands.

create or replace function public.ruling_opens_on() returns date
language sql stable security definer set search_path = public as $$
  select ((select config ->> 'resolutionDate' from public.config_versions order by version desc limit 1)::date - 30)
$$;

create or replace function public.check_arbiter_action() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cfg jsonb := (select config from public.config_versions order by version desc limit 1);
  first_month text := to_char(date_trunc('month', (cfg ->> 'startDate')::date) + interval '1 month', 'YYYY-MM');
  last_month text := to_char((cfg ->> 'resolutionDate')::date, 'YYYY-MM');
  k text;
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
  if new.kind = 'final_ruling' then
    if public.bet_today() < public.ruling_opens_on() then
      raise exception 'The final ruling opens on %.', public.ruling_opens_on();
    end if;
    foreach k in array array['A', 'B_LOOSE', 'B_STRICT', 'C'] loop
      if coalesce(new.payload ->> k, '') not in ('met', 'not_met') then
        raise exception 'Rule on every claim (met or not met): % is missing.', k;
      end if;
    end loop;
    if coalesce(new.payload ->> 'overall', '') not in ('YES', 'NO') then
      raise exception 'Rule on the bet: YES or NO.';
    end if;
    new.effective_on := public.bet_today();
  end if;
  return new;
end $$;
