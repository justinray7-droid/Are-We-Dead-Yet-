-- Database rule tests. Run with scripts/test-db.sh against a throwaway Postgres.
\set ON_ERROR_STOP on

-- Supabase grants these by default; RLS does the real gating.
grant usage on schema public to authenticated, anon;
grant select, insert, update, delete on all tables in schema public to authenticated;

create function pg_temp.expect_error(stmt text, label text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'PASS (blocked): % -> %', label, sqlerrm;
    return;
  end;
  raise exception 'FAIL: expected an error for: %', label;
end $$;

create function pg_temp.as_user(email text) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claim.sub', (select id::text from auth.users where auth.users.email = as_user.email), false);
end $$;

-- Sign-up: members link, strangers are refused.
insert into auth.users values ('00000000-0000-0000-0000-00000000000a', 'shaun@example.com');
insert into auth.users values ('00000000-0000-0000-0000-00000000000b', 'alex@example.com');
insert into auth.users values ('00000000-0000-0000-0000-00000000000c', 'justin@example.com');
select pg_temp.expect_error($$insert into auth.users values ('00000000-0000-0000-0000-0000000000ff', 'stranger@example.com')$$, 'non-member sign-up');
do $$ begin
  if (select count(*) from public.members where user_id is not null) <> 3 then raise exception 'FAIL: members not linked'; end if;
  raise notice 'PASS: three members linked';
end $$;

set role authenticated;

-- Alex submits evidence with a claim tag.
select pg_temp.as_user('alex@example.com');
insert into public.evidence (id, title, source_url, source_type, event_date, rationale)
values ('11111111-1111-1111-1111-111111111111', 'Lab reports autonomous discovery', 'https://example.com/a', 'news_report', '2026-10-22', 'Looks autonomous');
insert into public.evidence_claims (evidence_id, claim, proposed_direction, proposed_strength)
values ('11111111-1111-1111-1111-111111111111', 'A', 'YES', 4);
select pg_temp.expect_error($$update public.evidence set status = 'approved' where id = '11111111-1111-1111-1111-111111111111'$$, 'bettor approves own item');
select pg_temp.expect_error($$update public.evidence_claims set final_strength = 5 where evidence_id = '11111111-1111-1111-1111-111111111111'$$, 'bettor sets final strength');
select pg_temp.expect_error($$insert into public.arbiter_actions (kind, month, note) values ('decay_waiver', '2027-01', 'x')$$, 'bettor waives decay');
select pg_temp.expect_error($$insert into public.config_versions (version, config) values (2, '{}')$$, 'bettor edits config');
update public.evidence set summary = 'Edited by submitter' where id = '11111111-1111-1111-1111-111111111111';

-- Justin cannot edit Alex's item, but can comment.
select pg_temp.as_user('justin@example.com');
do $$ begin
  update public.evidence set summary = 'hijack' where id = '11111111-1111-1111-1111-111111111111';
  if (select summary from public.evidence where id = '11111111-1111-1111-1111-111111111111') <> 'Edited by submitter' then
    raise exception 'FAIL: other bettor edited the item';
  end if;
  raise notice 'PASS (blocked): other bettor edits item -> no rows visible for update';
end $$;
insert into public.comments (evidence_id, body) values ('11111111-1111-1111-1111-111111111111', 'Is this really autonomous?');
select pg_temp.expect_error($$insert into public.evidence (title, source_url, source_type, event_date, status) values ('Sneaky', 'https://x.com', 'other', '2026-10-22', 'approved')$$, 'bettor submits pre-approved item');
select pg_temp.expect_error($$insert into public.evidence (title, source_url, source_type, event_date) values ('No source', 'not-a-url', 'other', '2026-10-22')$$, 'evidence without URL');

-- Shaun cannot approve without final values, then approves properly.
select pg_temp.as_user('shaun@example.com');
select pg_temp.expect_error($$update public.evidence set status = 'approved' where id = '11111111-1111-1111-1111-111111111111'$$, 'approve without final values');
update public.evidence_claims set final_direction = 'YES', final_strength = 3, discount = 0.8
  where evidence_id = '11111111-1111-1111-1111-111111111111';
update public.evidence set status = 'approved', decision_note = 'Moderate; single lab' where id = '11111111-1111-1111-1111-111111111111';
select pg_temp.expect_error($$update public.evidence set status = 'rejected', decision_note = null where id = '11111111-1111-1111-1111-111111111111'$$, 'reject without reason');

-- Alex can no longer edit an approved item.
select pg_temp.as_user('alex@example.com');
select pg_temp.expect_error($$update public.evidence set summary = 'late edit' where id = '11111111-1111-1111-1111-111111111111'$$, 'bettor edits approved item');

-- Arbiter actions.
select pg_temp.as_user('shaun@example.com');
insert into public.arbiter_actions (kind, month, note) values ('decay_waiver', '2027-02', 'Conference month, lots pending');
select pg_temp.expect_error($$insert into public.arbiter_actions (kind, effective_on, note) values ('claim_a_satisfied', '2027-03-01', 'no evidence linked')$$, 'satisfied without evidence');
insert into public.arbiter_actions (kind, effective_on, evidence_ids, note)
values ('claim_a_satisfied', '2027-03-01', array['11111111-1111-1111-1111-111111111111']::uuid[], 'Meets Claim A');
do $$ begin
  update public.arbiter_actions set note = 'changed';
  if exists (select 1 from public.arbiter_actions where note = 'changed') then raise exception 'FAIL: arbiter action edited'; end if;
  raise notice 'PASS (blocked): edit arbiter action';
end $$;

-- Config: arbiter can recalibrate LRs, but not priors directly.
insert into public.config_versions (version, config, note)
select 2, jsonb_set(config, '{decay,lr}', '1.03'), 'Recalibrate decay' from public.config_versions where version = 1;
select pg_temp.expect_error($$insert into public.config_versions (version, config) select 3, jsonb_set(config, '{priors,A}', '0.5') from public.config_versions where version = 2$$, 'arbiter changes priors directly');

-- Priors change request: needs both bettors and the arbiter.
insert into public.change_requests (id, kind, proposed, rationale)
values ('22222222-2222-2222-2222-222222222222', 'priors', '{"priors": {"A": 0.6}, "note": "Recalibrate A"}', 'Forecast updated');
insert into public.change_approvals (request_id, decision) values ('22222222-2222-2222-2222-222222222222', 'approve');
select pg_temp.as_user('alex@example.com');
insert into public.change_approvals (request_id, decision) values ('22222222-2222-2222-2222-222222222222', 'approve');
do $$ begin
  if (select status from public.change_requests where id = '22222222-2222-2222-2222-222222222222') <> 'open' then
    raise exception 'FAIL: applied before both bettors approved';
  end if;
  raise notice 'PASS: priors request waits for both bettors';
end $$;
select pg_temp.as_user('justin@example.com');
insert into public.change_approvals (request_id, decision) values ('22222222-2222-2222-2222-222222222222', 'approve');
do $$ begin
  if (select (config -> 'priors' ->> 'A')::numeric from public.config_versions order by version desc limit 1) <> 0.6 then
    raise exception 'FAIL: priors not applied';
  end if;
  if (select (config -> 'decay' ->> 'lr')::numeric from public.config_versions order by version desc limit 1) <> 1.03 then
    raise exception 'FAIL: other config not carried forward';
  end if;
  raise notice 'PASS: priors applied after three approvals, other settings kept';
end $$;

-- Definitions change: needs all three; one rejection closes it.
select pg_temp.as_user('alex@example.com');
insert into public.change_requests (id, kind, proposed, rationale)
values ('33333333-3333-3333-3333-333333333333', 'definitions',
        '{"change_log": "Clarify Claim A", "definitions": {"claim_a": {"body": "Clarified body"}}}', 'Wording');
insert into public.change_approvals (request_id, decision) values ('33333333-3333-3333-3333-333333333333', 'approve');
select pg_temp.as_user('justin@example.com');
insert into public.change_approvals (request_id, decision) values ('33333333-3333-3333-3333-333333333333', 'approve');
select pg_temp.as_user('shaun@example.com');
insert into public.change_approvals (request_id, decision) values ('33333333-3333-3333-3333-333333333333', 'approve');
do $$ begin
  if (select body from public.definitions where version = 2 and key = 'claim_a') <> 'Clarified body' then
    raise exception 'FAIL: definition v2 not created';
  end if;
  if (select count(*) from public.definitions where version = 2) <> 6 then
    raise exception 'FAIL: unchanged definitions not carried forward';
  end if;
  if (select body from public.definitions where version = 1 and key = 'claim_a') = 'Clarified body' then
    raise exception 'FAIL: v1 was overwritten';
  end if;
  raise notice 'PASS: definitions v2 created, v1 kept';
end $$;

insert into public.change_requests (id, kind, proposed, rationale)
values ('44444444-4444-4444-4444-444444444444', 'definitions', '{"change_log": "x", "definitions": {}}', 'Test reject');
select pg_temp.as_user('justin@example.com');
insert into public.change_approvals (request_id, decision) values ('44444444-4444-4444-4444-444444444444', 'reject');
select pg_temp.as_user('alex@example.com');
select pg_temp.expect_error($$insert into public.change_approvals (request_id, decision) values ('44444444-4444-4444-4444-444444444444', 'approve')$$, 'approve a rejected request');

-- Evidence flow (migration 0002): submit, request changes, resubmit, review.
select pg_temp.as_user('alex@example.com');
select public.submit_evidence('{"title": "Phase 3 item", "source_url": "https://example.com/p3", "source_type": "peer_reviewed",
  "event_date": "2026-10-23", "rationale": "Shows autonomy",
  "claims": [{"claim": "A", "direction": "YES", "strength": 4}, {"claim": "C", "direction": "YES", "strength": 2}]}');
do $$ begin
  if (select count(*) from public.evidence_claims c join public.evidence e on e.id = c.evidence_id where e.title = 'Phase 3 item') <> 2 then
    raise exception 'FAIL: submit_evidence did not store both tags';
  end if;
  raise notice 'PASS: submit_evidence stores the item and its tags together';
end $$;
select pg_temp.expect_error($$select public.submit_evidence('{"title": "No tags", "source_url": "https://example.com", "source_type": "other", "event_date": "2026-10-22", "rationale": "x", "claims": []}')$$, 'submit without claim tags');
do $$ begin
  if exists (select 1 from public.evidence where title = 'No tags') then raise exception 'FAIL: untagged item left behind'; end if;
  raise notice 'PASS: failed submission leaves nothing behind';
end $$;
select pg_temp.expect_error($$select public.submit_evidence('{"title": "No rationale", "source_url": "https://example.com", "source_type": "other", "event_date": "2026-10-22", "rationale": " ", "claims": [{"claim": "A", "direction": "NO", "strength": 1}]}')$$, 'submit without rationale');
select pg_temp.expect_error($$select public.submit_evidence('{"title": "From the future", "source_url": "https://example.com", "source_type": "other", "event_date": "2099-01-01", "rationale": "x", "claims": [{"claim": "A", "direction": "NO", "strength": 1}]}')$$, 'future event date');
select pg_temp.expect_error($$insert into public.evidence (title, source_url, source_type, event_date, is_expert_forecast) values ('Self-tagged forecast', 'https://x.com', 'other', '2026-10-22', true)$$, 'bettor tags own item as expert forecast');
select pg_temp.expect_error($$update public.evidence set is_expert_forecast = true where title = 'Phase 3 item'$$, 'bettor flags pending item as expert forecast');
select pg_temp.expect_error($$insert into public.evidence_claims (evidence_id, claim, proposed_direction, proposed_strength, dropped) select id, 'B_LOOSE', 'YES', 1, true from public.evidence where title = 'Phase 3 item'$$, 'bettor marks a tag dropped');
select pg_temp.expect_error($$select public.review_evidence((select id from public.evidence where title = 'Phase 3 item'), 'approved', 'self-approval', '[{"claim": "A", "direction": "YES", "strength": 5}]')$$, 'bettor calls review_evidence');

select pg_temp.as_user('justin@example.com');
select pg_temp.expect_error($$select public.resubmit_evidence((select id from public.evidence where title = 'Phase 3 item'), '{"title": "Hijacked", "source_url": "https://x.com", "source_type": "other", "event_date": "2026-10-22", "rationale": "x", "claims": [{"claim": "A", "direction": "NO", "strength": 5}]}')$$, 'other bettor resubmits item');

select pg_temp.as_user('shaun@example.com');
select pg_temp.expect_error($$select public.review_evidence((select id from public.evidence where title = 'Phase 3 item'), 'needs_changes', '  ')$$, 'request changes without a note');
select public.review_evidence((select id from public.evidence where title = 'Phase 3 item'), 'needs_changes', 'Link the paper, not the press release');

select pg_temp.as_user('alex@example.com');
select public.resubmit_evidence((select id from public.evidence where title = 'Phase 3 item'),
  '{"title": "Phase 3 item", "source_url": "https://example.com/paper", "source_type": "peer_reviewed", "event_date": "2026-10-23",
    "rationale": "Paper linked", "claims": [{"claim": "A", "direction": "YES", "strength": 4}, {"claim": "C", "direction": "YES", "strength": 3}]}');
do $$ begin
  if (select status from public.evidence where title = 'Phase 3 item') <> 'pending' then raise exception 'FAIL: resubmission not pending'; end if;
  if (select proposed_strength from public.evidence_claims c join public.evidence e on e.id = c.evidence_id where e.title = 'Phase 3 item' and claim = 'C') <> 3 then
    raise exception 'FAIL: resubmitted tags not replaced';
  end if;
  raise notice 'PASS: resubmission returns the item to pending with new tags';
end $$;

select pg_temp.as_user('shaun@example.com');
select pg_temp.expect_error($$select public.review_evidence((select id from public.evidence where title = 'Phase 3 item'), 'approved', '', '[]')$$, 'approve with every tag removed');
select pg_temp.expect_error($$select public.review_evidence((select id from public.evidence where title = 'Phase 3 item'), 'rejected', '')$$, 'reject without a reason');
select public.review_evidence(
  (select id from public.evidence where title = 'Phase 3 item'), 'approved', 'Strong but single lab',
  '[{"claim": "A", "direction": "YES", "strength": 3, "discount": 0.5}, {"claim": "B_LOOSE", "direction": "YES", "strength": 2}]',
  true, array['11111111-1111-1111-1111-111111111111']::uuid[]);
do $$
declare ev public.evidence := (select e from public.evidence e where title = 'Phase 3 item');
begin
  if ev.status <> 'approved' or ev.approved_at is null or not ev.is_expert_forecast then raise exception 'FAIL: approval fields'; end if;
  if (select dropped from public.evidence_claims where evidence_id = ev.id and claim = 'C') is not true then
    raise exception 'FAIL: untagged claim should be kept as dropped';
  end if;
  if (select proposed_direction from public.evidence_claims where evidence_id = ev.id and claim = 'B_LOOSE') is not null
     or (select final_strength from public.evidence_claims where evidence_id = ev.id and claim = 'B_LOOSE') <> 2 then
    raise exception 'FAIL: arbiter-added tag';
  end if;
  if (select discount from public.evidence_claims where evidence_id = ev.id and claim = 'A') <> 0.5 then raise exception 'FAIL: discount'; end if;
  if not exists (select 1 from public.evidence_links where evidence_id = ev.id) then raise exception 'FAIL: link not stored'; end if;
  raise notice 'PASS: approval sets finals, keeps dropped tags, stores links and the forecast flag';
end $$;

-- Audit log: populated and append-only; no deletes.
do $$ begin
  if (select count(*) from public.audit_log) < 10 then raise exception 'FAIL: audit log thin'; end if;
  raise notice 'PASS: audit log has % entries', (select count(*) from public.audit_log);
end $$;
do $$
declare n bigint := (select count(*) from public.audit_log);
begin
  delete from public.audit_log;
  update public.audit_log set action = 'x';
  if (select count(*) from public.audit_log) <> n or exists (select 1 from public.audit_log where action = 'x') then
    raise exception 'FAIL: audit log changed';
  end if;
  raise notice 'PASS (blocked): members cannot edit or delete the audit log';
end $$;
reset role;
select pg_temp.expect_error($$delete from public.audit_log$$, 'owner deletes audit log (trigger)');
set role authenticated;
select pg_temp.as_user('justin@example.com');
do $$ begin
  delete from public.evidence;
  if (select count(*) from public.evidence) = 0 then raise exception 'FAIL: evidence deleted'; end if;
  raise notice 'PASS: evidence cannot be deleted (no delete policy)';
end $$;

-- Outsiders see nothing.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000ff', false);
do $$ begin
  if (select count(*) from public.evidence) <> 0 then raise exception 'FAIL: outsider can read'; end if;
  raise notice 'PASS: non-members see nothing';
end $$;

reset role;
\echo ALL_DB_TESTS_PASSED
