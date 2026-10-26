-- 2031 AI Wager Tracker: initial schema.
-- Three members, roles enforced in the database. Probability history is never
-- stored; the app recomputes it from these tables with lib/engine.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Members and roles
-- ---------------------------------------------------------------------------

create table public.members (
  email      text primary key check (email = lower(email)),
  name       text not null,
  role       text not null check (role in ('arbiter', 'yes', 'no')),
  user_id    uuid unique references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Only one arbiter, one YES bettor, one NO bettor.
create unique index members_one_per_role on public.members (role);

-- Block sign-up for anyone not on the members list, and link the account.
create or replace function public.link_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.members set user_id = new.id where email = lower(new.email);
  if not found then
    raise exception 'This tracker is private. % is not a member.', new.email;
  end if;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.link_member();

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.members where user_id = auth.uid()
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where user_id = auth.uid())
$$;

create or replace function public.is_arbiter() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'arbiter', false)
$$;

create or replace function public.is_bettor() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('yes', 'no'), false)
$$;

-- ---------------------------------------------------------------------------
-- Audit log (append-only)
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor      uuid references auth.users (id),
  action     text not null,
  entity     text not null,
  entity_id  text,
  details    jsonb not null default '{}'::jsonb
);

create or replace function public.audit_log_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'The audit log is append-only.';
end $$;

create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();

-- Generic row-change auditor.
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rec jsonb;
  key text := TG_ARGV[0];
begin
  rec := to_jsonb(coalesce(new, old));
  insert into public.audit_log (actor, action, entity, entity_id, details)
  values (
    auth.uid(),
    lower(TG_OP),
    TG_TABLE_NAME,
    rec ->> key,
    case TG_OP
      when 'UPDATE' then jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new))
      when 'DELETE' then jsonb_build_object('old', to_jsonb(old))
      else jsonb_build_object('new', to_jsonb(new))
    end
  );
  return coalesce(new, old);
end $$;

-- ---------------------------------------------------------------------------
-- Engine config (versioned; current = highest version)
-- ---------------------------------------------------------------------------

create table public.config_versions (
  version    int primary key,
  config     jsonb not null,
  note       text not null default '',
  request_id uuid, -- set when the change came through an approved request
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Definitions (versioned; old versions never deleted)
-- ---------------------------------------------------------------------------

create table public.definition_versions (
  version    int primary key,
  change_log text not null,
  request_id uuid,
  created_at timestamptz not null default now()
);

create table public.definitions (
  version int not null references public.definition_versions (version),
  key     text not null check (key in ('autonomous', 'claim_a', 'claim_b_loose', 'claim_b_strict', 'claim_c', 'deciding_rule')),
  title   text not null,
  body    text not null,
  primary key (version, key)
);

-- ---------------------------------------------------------------------------
-- Change requests: definitions need all three approvals; priors need both bettors.
-- ---------------------------------------------------------------------------

create table public.change_requests (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('definitions', 'priors')),
  -- definitions: {"change_log": "...", "definitions": {"claim_a": {"title": "...", "body": "..."}, ...}}
  -- priors:      {"note": "...", "priors": {"A": 0.6, ...}}
  proposed     jsonb not null,
  rationale    text not null,
  status       text not null default 'open' check (status in ('open', 'applied', 'rejected')),
  requested_by uuid not null references auth.users (id) default auth.uid(),
  created_at   timestamptz not null default now()
);

create table public.change_approvals (
  request_id uuid not null references public.change_requests (id),
  approver   uuid not null references auth.users (id) default auth.uid(),
  decision   text not null check (decision in ('approve', 'reject')),
  note       text not null default '',
  at         timestamptz not null default now(),
  primary key (request_id, approver)
);

create or replace function public.apply_change_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  req public.change_requests;
  approvals int;
  bettor_approvals int;
  next_version int;
  cur jsonb;
  k text;
  v jsonb;
begin
  select * into req from public.change_requests where id = new.request_id for update;
  if req.status <> 'open' then
    raise exception 'Change request is no longer open.';
  end if;

  if new.decision = 'reject' then
    update public.change_requests set status = 'rejected' where id = req.id;
    return new;
  end if;

  select count(*) into approvals
  from public.change_approvals a join public.members m on m.user_id = a.approver
  where a.request_id = req.id and a.decision = 'approve';

  select count(*) into bettor_approvals
  from public.change_approvals a join public.members m on m.user_id = a.approver
  where a.request_id = req.id and a.decision = 'approve' and m.role in ('yes', 'no');

  if req.kind = 'definitions' and approvals = 3 then
    select coalesce(max(version), 0) + 1 into next_version from public.definition_versions;
    insert into public.definition_versions (version, change_log, request_id)
    values (next_version, req.proposed ->> 'change_log', req.id);
    -- Carry forward every current definition, replacing the changed ones.
    insert into public.definitions (version, key, title, body)
    select next_version, d.key,
           coalesce(req.proposed -> 'definitions' -> d.key ->> 'title', d.title),
           coalesce(req.proposed -> 'definitions' -> d.key ->> 'body', d.body)
    from public.definitions d
    where d.version = next_version - 1;
    update public.change_requests set status = 'applied' where id = req.id;

  elsif req.kind = 'priors' and bettor_approvals = 2 and approvals = 3 then
    select coalesce(max(version), 0) + 1 into next_version from public.config_versions;
    select config into cur from public.config_versions order by version desc limit 1;
    for k, v in select * from jsonb_each(req.proposed -> 'priors') loop
      cur := jsonb_set(cur, array['priors', k], v);
    end loop;
    insert into public.config_versions (version, config, note, request_id, created_by)
    values (next_version, cur, coalesce(req.proposed ->> 'note', 'Priors change'), req.id, req.requested_by);
    update public.change_requests set status = 'applied' where id = req.id;
  end if;

  return new;
end $$;

create trigger change_approval_apply after insert on public.change_approvals
  for each row execute function public.apply_change_request();

-- The arbiter can change config directly, except priors, which need a request.
create or replace function public.guard_config_priors() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  prev jsonb;
begin
  select config into prev from public.config_versions where version < new.version order by version desc limit 1;
  if prev is not null and (prev -> 'priors') is distinct from (new.config -> 'priors') and new.request_id is null then
    raise exception 'Priors can only change through a change request approved by both bettors.';
  end if;
  return new;
end $$;

create trigger config_priors_guard before insert on public.config_versions
  for each row execute function public.guard_config_priors();

-- ---------------------------------------------------------------------------
-- Evidence
-- ---------------------------------------------------------------------------

create table public.evidence (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null check (length(title) between 3 and 200),
  summary            text not null default '',
  source_url         text not null check (source_url ~* '^https?://'),
  source_type        text not null check (source_type in ('peer_reviewed', 'company_announcement', 'news_report', 'independent_replication', 'other')),
  event_date         date not null,
  is_expert_forecast boolean not null default false,
  rationale          text not null default '',
  status             text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'needs_changes')),
  decision_note      text,
  submitted_by       uuid not null references auth.users (id) default auth.uid(),
  submitted_at       timestamptz not null default now(),
  decided_by         uuid references auth.users (id),
  decided_at         timestamptz,
  approved_at        timestamptz, -- first approval; drives the backdated flag
  check (status <> 'rejected' or coalesce(length(decision_note), 0) > 0)
);

create index evidence_status_idx on public.evidence (status);
create index evidence_event_date_idx on public.evidence (event_date);

-- One row per claim tag. Proposed values come from the bettor; final values from the arbiter.
create table public.evidence_claims (
  evidence_id        uuid not null references public.evidence (id),
  claim              text not null check (claim in ('A', 'B_LOOSE', 'B_STRICT', 'C')),
  proposed_direction text not null check (proposed_direction in ('YES', 'NO')),
  proposed_strength  smallint not null check (proposed_strength between 1 and 5),
  final_direction    text check (final_direction in ('YES', 'NO')),
  final_strength     smallint check (final_strength between 1 and 5),
  discount           numeric not null default 1 check (discount >= 0 and discount <= 1),
  primary key (evidence_id, claim)
);

create table public.evidence_links (
  evidence_id uuid not null references public.evidence (id),
  related_id  uuid not null references public.evidence (id),
  primary key (evidence_id, related_id),
  check (evidence_id <> related_id)
);

create table public.comments (
  id          uuid primary key default gen_random_uuid(),
  evidence_id uuid not null references public.evidence (id),
  author      uuid not null references auth.users (id) default auth.uid(),
  body        text not null check (length(body) between 1 and 5000),
  created_at  timestamptz not null default now()
);

-- Bettors may edit their own item only while it's pending or needs changes,
-- and never the arbiter fields. Resubmitting moves needs_changes -> pending.
create or replace function public.guard_evidence() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_arbiter() then
    if new.status <> old.status or new.decision_note is distinct from old.decision_note then
      new.decided_by := auth.uid();
      new.decided_at := now();
    end if;
    if new.status = 'approved' and old.approved_at is null then
      new.approved_at := now();
    end if;
    return new;
  end if;

  if old.submitted_by <> auth.uid() or old.status not in ('pending', 'needs_changes') then
    raise exception 'Only the arbiter can change this item.';
  end if;
  if new.status not in ('pending', old.status)
     or new.decision_note is distinct from old.decision_note
     or new.decided_by is distinct from old.decided_by
     or new.decided_at is distinct from old.decided_at
     or new.approved_at is distinct from old.approved_at
     or new.submitted_by <> old.submitted_by
     or new.submitted_at <> old.submitted_at then
    raise exception 'Bettors can only edit their own submission details.';
  end if;
  return new;
end $$;

create trigger evidence_guard before update on public.evidence
  for each row execute function public.guard_evidence();

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
  if TG_OP <> 'DELETE' and (new.final_direction is not null or new.final_strength is not null or new.discount <> 1) then
    raise exception 'Final direction, strength and discount are set by the arbiter.';
  end if;
  return coalesce(new, old);
end $$;

create trigger evidence_claims_guard before insert or update or delete on public.evidence_claims
  for each row execute function public.guard_evidence_claims();

-- Approved items must have final values on every tag.
create or replace function public.check_approved_complete() returns trigger
language plpgsql as $$
begin
  if new.status = 'approved' and exists (
    select 1 from public.evidence_claims
    where evidence_id = new.id and (final_direction is null or final_strength is null)
  ) then
    raise exception 'Set final direction and strength on every claim tag before approving.';
  end if;
  if new.status = 'approved' and not exists (select 1 from public.evidence_claims where evidence_id = new.id) then
    raise exception 'An approved item needs at least one claim tag.';
  end if;
  return new;
end $$;

create constraint trigger evidence_approved_complete
  after insert or update on public.evidence
  for each row execute function public.check_approved_complete();

-- ---------------------------------------------------------------------------
-- Arbiter actions (append-only): decay waivers, Claim A satisfied, final ruling
-- ---------------------------------------------------------------------------

create table public.arbiter_actions (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('decay_waiver', 'claim_a_satisfied', 'claim_a_unsatisfied', 'final_ruling')),
  month        text check (month ~ '^\d{4}-\d{2}$'),
  effective_on date,
  evidence_ids uuid[] not null default '{}',
  note         text not null check (length(note) > 0),
  payload      jsonb not null default '{}'::jsonb, -- final_ruling: {"A": "met", "B_LOOSE": "not_met", "overall": "YES"}
  actor        uuid not null references auth.users (id) default auth.uid(),
  created_at   timestamptz not null default now(),
  check (kind <> 'decay_waiver' or month is not null),
  check (kind <> 'claim_a_satisfied' or (effective_on is not null and cardinality(evidence_ids) > 0))
);

create trigger arbiter_actions_immutable before update or delete on public.arbiter_actions
  for each row execute function public.audit_log_immutable();

-- ---------------------------------------------------------------------------
-- Audit triggers
-- ---------------------------------------------------------------------------

create trigger audit_evidence after insert or update on public.evidence
  for each row execute function public.audit_row('id');
create trigger audit_evidence_claims after insert or update or delete on public.evidence_claims
  for each row execute function public.audit_row('evidence_id');
create trigger audit_evidence_links after insert or delete on public.evidence_links
  for each row execute function public.audit_row('evidence_id');
create trigger audit_comments after insert on public.comments
  for each row execute function public.audit_row('id');
create trigger audit_arbiter_actions after insert on public.arbiter_actions
  for each row execute function public.audit_row('id');
create trigger audit_config after insert on public.config_versions
  for each row execute function public.audit_row('version');
create trigger audit_definition_versions after insert on public.definition_versions
  for each row execute function public.audit_row('version');
create trigger audit_change_requests after insert or update on public.change_requests
  for each row execute function public.audit_row('id');
create trigger audit_change_approvals after insert on public.change_approvals
  for each row execute function public.audit_row('request_id');

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.members             enable row level security;
alter table public.audit_log           enable row level security;
alter table public.config_versions     enable row level security;
alter table public.definition_versions enable row level security;
alter table public.definitions         enable row level security;
alter table public.change_requests     enable row level security;
alter table public.change_approvals    enable row level security;
alter table public.evidence            enable row level security;
alter table public.evidence_claims     enable row level security;
alter table public.evidence_links      enable row level security;
alter table public.comments            enable row level security;
alter table public.arbiter_actions     enable row level security;

-- Everyone in the bet can read everything.
create policy read_members     on public.members             for select using (public.is_member());
create policy read_audit       on public.audit_log           for select using (public.is_member());
create policy read_config      on public.config_versions     for select using (public.is_member());
create policy read_defv        on public.definition_versions for select using (public.is_member());
create policy read_defs        on public.definitions         for select using (public.is_member());
create policy read_requests    on public.change_requests     for select using (public.is_member());
create policy read_approvals   on public.change_approvals    for select using (public.is_member());
create policy read_evidence    on public.evidence            for select using (public.is_member());
create policy read_claims      on public.evidence_claims     for select using (public.is_member());
create policy read_links       on public.evidence_links      for select using (public.is_member());
create policy read_comments    on public.comments            for select using (public.is_member());
create policy read_actions     on public.arbiter_actions     for select using (public.is_member());

-- Bettors submit evidence; arbiter decides. Edits are further checked by triggers.
create policy submit_evidence on public.evidence for insert
  with check (public.is_bettor() and submitted_by = auth.uid() and status = 'pending');
create policy edit_evidence on public.evidence for update
  using (public.is_arbiter() or submitted_by = auth.uid());

create policy write_claims on public.evidence_claims for all
  using (public.is_member()) with check (public.is_member());

create policy write_links on public.evidence_links for all
  using (public.is_arbiter()) with check (public.is_arbiter());

create policy write_comments on public.comments for insert
  with check (public.is_member() and author = auth.uid());

create policy write_actions on public.arbiter_actions for insert
  with check (public.is_arbiter() and actor = auth.uid());

create policy write_config on public.config_versions for insert
  with check (public.is_arbiter() and request_id is null);

create policy write_requests on public.change_requests for insert
  with check (public.is_member() and requested_by = auth.uid() and status = 'open');

create policy write_approvals on public.change_approvals for insert
  with check (public.is_member() and approver = auth.uid());

-- No delete policies anywhere: nothing is deleted from the UI.
