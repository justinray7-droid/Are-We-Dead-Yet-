-- Honor-system identity. There is no sign-in: each person picks their name in
-- the app, and the app's server sends that member's id in the x-wager-member
-- request header. PostgREST exposes request headers to SQL, so every rule
-- below keys off actor_id() instead of auth.uid(). The Supabase key lives only
-- on the app's server, so the database is reachable only through the app.

-- The acting member: a Supabase Auth user if there is one, else the header.
create or replace function public.actor_id() returns uuid
language plpgsql stable as $$
declare
  h text := nullif(current_setting('request.headers', true), '')::json ->> 'x-wager-member';
begin
  return coalesce(auth.uid(), case when h ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then h::uuid end);
end $$;

-- ---------------------------------------------------------------------------
-- Members get their own ids; nothing references Supabase Auth any more.
-- ---------------------------------------------------------------------------

alter table public.members drop constraint members_user_id_fkey;
update public.members set user_id = gen_random_uuid() where user_id is null;
alter table public.members alter column user_id set default gen_random_uuid();
alter table public.members alter column user_id set not null;

alter table public.audit_log       drop constraint audit_log_actor_fkey;
alter table public.config_versions drop constraint config_versions_created_by_fkey;
alter table public.change_requests drop constraint change_requests_requested_by_fkey;
alter table public.change_approvals drop constraint change_approvals_approver_fkey;
alter table public.evidence        drop constraint evidence_submitted_by_fkey;
alter table public.evidence        drop constraint evidence_decided_by_fkey;
alter table public.comments        drop constraint comments_author_fkey;
alter table public.arbiter_actions drop constraint arbiter_actions_actor_fkey;

alter table public.audit_log        add foreign key (actor) references public.members (user_id);
alter table public.config_versions  add foreign key (created_by) references public.members (user_id);
alter table public.change_requests  add foreign key (requested_by) references public.members (user_id);
alter table public.change_approvals add foreign key (approver) references public.members (user_id);
alter table public.evidence         add foreign key (submitted_by) references public.members (user_id);
alter table public.evidence         add foreign key (decided_by) references public.members (user_id);
alter table public.comments         add foreign key (author) references public.members (user_id);
alter table public.arbiter_actions  add foreign key (actor) references public.members (user_id);

alter table public.config_versions  alter column created_by   set default public.actor_id();
alter table public.change_requests  alter column requested_by set default public.actor_id();
alter table public.change_approvals alter column approver     set default public.actor_id();
alter table public.evidence         alter column submitted_by set default public.actor_id();
alter table public.comments         alter column author       set default public.actor_id();
alter table public.arbiter_actions  alter column actor        set default public.actor_id();

-- Names for the "who are you?" picker, before anyone has picked.
create or replace function public.member_directory() returns table (user_id uuid, name text, role text)
language sql stable security definer set search_path = public as $$
  select user_id, name, role from public.members
  order by case role when 'yes' then 1 when 'no' then 2 else 3 end
$$;
grant execute on function public.member_directory() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Roles and guards, now keyed off actor_id(). "is distinct from" so a request
-- with no identity can never pass a bettor check.
-- ---------------------------------------------------------------------------

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.members where user_id = public.actor_id()
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where user_id = public.actor_id())
$$;

create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rec jsonb;
  key text := TG_ARGV[0];
begin
  rec := to_jsonb(coalesce(new, old));
  insert into public.audit_log (actor, action, entity, entity_id, details)
  values (
    public.actor_id(),
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

create or replace function public.guard_evidence() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_arbiter() then
    if new.status <> old.status or new.decision_note is distinct from old.decision_note then
      new.decided_by := public.actor_id();
      new.decided_at := now();
    end if;
    if new.status = 'approved' and old.approved_at is null then
      new.approved_at := now();
    end if;
    return new;
  end if;

  if old.submitted_by is distinct from public.actor_id() or old.status not in ('pending', 'needs_changes') then
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

create or replace function public.guard_evidence_claims() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ev public.evidence;
begin
  if public.is_arbiter() then
    return coalesce(new, old);
  end if;
  select * into ev from public.evidence where id = coalesce(new.evidence_id, old.evidence_id);
  if ev.submitted_by is distinct from public.actor_id() or ev.status not in ('pending', 'needs_changes') then
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
  where id = p_id and submitted_by = public.actor_id();
  if not found then
    raise exception 'You can only edit your own submissions.';
  end if;
  delete from public.evidence_claims where evidence_id = p_id;
  perform public.insert_proposed_claims(p_id, item -> 'claims');
end $$;

-- ---------------------------------------------------------------------------
-- Policies that named auth.uid().
-- ---------------------------------------------------------------------------

drop policy submit_evidence on public.evidence;
create policy submit_evidence on public.evidence for insert
  with check (public.is_bettor() and submitted_by = public.actor_id() and status = 'pending' and not is_expert_forecast);

drop policy edit_evidence on public.evidence;
create policy edit_evidence on public.evidence for update
  using (public.is_arbiter() or submitted_by = public.actor_id());

drop policy write_comments on public.comments;
create policy write_comments on public.comments for insert
  with check (public.is_member() and author = public.actor_id());

drop policy write_actions on public.arbiter_actions;
create policy write_actions on public.arbiter_actions for insert
  with check (public.is_arbiter() and actor = public.actor_id());

drop policy write_requests on public.change_requests;
create policy write_requests on public.change_requests for insert
  with check (public.is_member() and requested_by = public.actor_id() and status = 'open');

drop policy write_approvals on public.change_approvals;
create policy write_approvals on public.change_approvals for insert
  with check (public.is_member() and approver = public.actor_id());
