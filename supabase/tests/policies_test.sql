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
values ('claim_a_satisfied', '2026-10-25', array['11111111-1111-1111-1111-111111111111']::uuid[], 'Meets Claim A');
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
values ('44444444-4444-4444-4444-444444444444', 'definitions', '{"change_log": "x", "definitions": {"claim_c": {"body": "Changed"}}}', 'Test reject');
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

-- Governance (migration 0003).
-- Change requests open with the requester's approval and are validated.
select pg_temp.as_user('alex@example.com');
select public.propose_change('priors', '{"priors": {"C": 0.45}, "note": "Recalibrate C"}', 'New benchmark results');
do $$ begin
  if (select count(*) from public.change_approvals a join public.change_requests r on r.id = a.request_id
      where r.rationale = 'New benchmark results') <> 1 then
    raise exception 'FAIL: requester approval not recorded';
  end if;
  raise notice 'PASS: propose_change records the requester''s approval';
end $$;
select pg_temp.expect_error($$select public.propose_change('priors', '{"priors": {"A": 1.2}}', 'x')$$, 'prior outside 0..1');
select pg_temp.expect_error($$select public.propose_change('priors', '{"priors": {"D": 0.5}}', 'x')$$, 'prior for an unknown claim');
select pg_temp.expect_error($$select public.propose_change('priors', '{"priors": {"A": 0.5}}', '  ')$$, 'change request without rationale');
select pg_temp.expect_error($$select public.propose_change('definitions', '{"change_log": "x", "definitions": {"claim_z": {"body": "y"}}}', 'x')$$, 'unknown definition key');
select pg_temp.expect_error($$select public.propose_change('definitions', '{"change_log": "", "definitions": {"claim_a": {"body": "y"}}}', 'x')$$, 'definition change without change log');
do $$ begin
  if exists (select 1 from public.change_requests where rationale = 'x') then raise exception 'FAIL: invalid request left behind'; end if;
  raise notice 'PASS: invalid proposals leave nothing behind';
end $$;

-- Config: validated, terms locked, note required.
select pg_temp.as_user('shaun@example.com');
select pg_temp.expect_error($$insert into public.config_versions (version, config, note) select version + 1, jsonb_set(config, '{strengthLR,2}', '0.5'), 'bad' from public.config_versions order by version desc limit 1$$, 'strength LR below 1');
select pg_temp.expect_error($$insert into public.config_versions (version, config, note) select version + 1, jsonb_set(config, '{decay,skipThreshold}', '7'), 'bad' from public.config_versions order by version desc limit 1$$, 'skip threshold outside 1..5');
select pg_temp.expect_error($$insert into public.config_versions (version, config, note) select version + 1, jsonb_set(config, '{resolutionDate}', '"2035-01-01"'), 'extend' from public.config_versions order by version desc limit 1$$, 'arbiter moves the resolution date');
select pg_temp.expect_error($$insert into public.config_versions (version, config, note) select version + 1, jsonb_set(config, '{decay,lr}', '1.01'), ' ' from public.config_versions order by version desc limit 1$$, 'config change without a note');
insert into public.config_versions (version, config, note)
select version + 1, jsonb_set(config, '{caps,perItemLR}', '4'), 'Cap single items at LR 4' from public.config_versions order by version desc limit 1;
do $$ begin
  if (select created_by from public.config_versions order by version desc limit 1) <> '00000000-0000-0000-0000-00000000000a' then
    raise exception 'FAIL: config author not recorded';
  end if;
  raise notice 'PASS: valid recalibration accepted and attributed';
end $$;

-- Waivers: in range, revocable once.
select pg_temp.expect_error($$insert into public.arbiter_actions (kind, month, note) values ('decay_waiver', '2026-10', 'partial month')$$, 'waive a month with no decay step');
select pg_temp.expect_error($$insert into public.arbiter_actions (kind, month, note) values ('decay_waiver_revoked', '2027-05', 'never waived')$$, 'revoke a waiver that does not exist');
insert into public.arbiter_actions (kind, month, note) values ('decay_waiver_revoked', '2027-02', 'Waived by mistake');
do $$ begin
  if public.decay_is_waived('2027-02') then raise exception 'FAIL: waiver not revoked'; end if;
  raise notice 'PASS: waiver revoked';
end $$;
select pg_temp.expect_error($$insert into public.arbiter_actions (kind, month, note) values ('decay_waiver_revoked', '2027-02', 'again')$$, 'revoke the same waiver twice');

-- Claim A satisfied: only from the right state, linking approved evidence, dated in range.
select pg_temp.expect_error($$insert into public.arbiter_actions (kind, effective_on, evidence_ids, note) values ('claim_a_satisfied', '2026-10-25', array['11111111-1111-1111-1111-111111111111']::uuid[], 'twice')$$, 'mark Claim A satisfied twice');
insert into public.arbiter_actions (kind, note) values ('claim_a_unsatisfied', 'Replication failed');
select pg_temp.expect_error($$insert into public.arbiter_actions (kind, note) values ('claim_a_unsatisfied', 'again')$$, 'unmark when not satisfied');
select pg_temp.expect_error($$insert into public.arbiter_actions (kind, effective_on, evidence_ids, note) values ('claim_a_satisfied', '2026-10-25', array['11111111-1111-1111-1111-111111111111', '99999999-9999-9999-9999-999999999999']::uuid[], 'unknown item')$$, 'satisfied linking evidence that is not approved');
select pg_temp.expect_error($$insert into public.arbiter_actions (kind, effective_on, evidence_ids, note) values ('claim_a_satisfied', '2099-01-01', array['11111111-1111-1111-1111-111111111111']::uuid[], 'future')$$, 'satisfied dated in the future');
do $$ begin
  if public.claim_a_is_satisfied() then raise exception 'FAIL: still satisfied'; end if;
  raise notice 'PASS: satisfied state follows the latest mark';
end $$;

-- Final ruling (migration 0004): opens 30 days before resolution, covers every claim.
select pg_temp.as_user('shaun@example.com');
select pg_temp.expect_error($$insert into public.arbiter_actions (kind, note, payload) values ('final_ruling', 'early', '{"A": "met", "B_LOOSE": "met", "B_STRICT": "not_met", "C": "met", "overall": "YES"}')$$, 'final ruling years early');
-- Move resolution to 10 days from now (as the owner, standing in for an approved request).
reset role;
insert into public.config_versions (version, config, note, request_id)
select version + 1, jsonb_set(config, '{resolutionDate}', to_jsonb(to_char(public.bet_today() + 10, 'YYYY-MM-DD'))), 'Test: resolution near', gen_random_uuid()
from public.config_versions order by version desc limit 1;
set role authenticated;
select pg_temp.as_user('alex@example.com');
select pg_temp.expect_error($$insert into public.arbiter_actions (kind, note, payload) values ('final_ruling', 'I win', '{"A": "met", "B_LOOSE": "met", "B_STRICT": "met", "C": "met", "overall": "YES"}')$$, 'bettor records the final ruling');
select pg_temp.as_user('shaun@example.com');
select pg_temp.expect_error($$insert into public.arbiter_actions (kind, note, payload) values ('final_ruling', 'x', '{"A": "met", "B_LOOSE": "met", "overall": "YES"}')$$, 'ruling that skips claims');
select pg_temp.expect_error($$insert into public.arbiter_actions (kind, note, payload) values ('final_ruling', 'x', '{"A": "met", "B_LOOSE": "met", "B_STRICT": "met", "C": "met", "overall": "MAYBE"}')$$, 'ruling without a YES/NO verdict');
insert into public.arbiter_actions (kind, note, payload, effective_on)
values ('final_ruling', 'Autonomous labs are real; results still explainable', '{"A": "met", "B_LOOSE": "not_met", "B_STRICT": "not_met", "C": "met", "overall": "NO"}', '2000-01-01');
insert into public.arbiter_actions (kind, note, payload)
values ('final_ruling', 'Amended after AlphaProof review', '{"A": "met", "B_LOOSE": "met", "B_STRICT": "not_met", "C": "met", "overall": "YES"}');
do $$ begin
  if (select count(*) from public.arbiter_actions where kind = 'final_ruling') <> 2 then raise exception 'FAIL: rulings not recorded'; end if;
  if exists (select 1 from public.arbiter_actions where kind = 'final_ruling' and effective_on <> public.bet_today()) then
    raise exception 'FAIL: ruling date not set to today';
  end if;
  raise notice 'PASS: final ruling recorded and amendable; dated today';
end $$;

-- Honor system (migration 0005): the app sends the chosen member in a header.
reset role;
grant select, insert, update, delete on all tables in schema public to anon;
create function pg_temp.as_header(v text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('request.headers', coalesce(json_build_object('x-wager-member', v)::text, ''), false);
end $$;
set role anon;
select pg_temp.as_header(null);
do $$ begin
  if (select count(*) from public.member_directory()) <> 3 then raise exception 'FAIL: directory'; end if;
  if exists (select 1 from public.evidence) then raise exception 'FAIL: no identity can read evidence'; end if;
  raise notice 'PASS: picker lists names before anyone picks; no identity reads nothing';
end $$;
select pg_temp.expect_error($$insert into public.comments (evidence_id, body) values ('11111111-1111-1111-1111-111111111111', 'anonymous')$$, 'comment with no identity');
select pg_temp.as_header('not-a-uuid');
do $$ begin
  if public.actor_id() is not null or exists (select 1 from public.evidence) then raise exception 'FAIL: malformed header accepted'; end if;
  raise notice 'PASS: malformed header is no identity';
end $$;
select pg_temp.as_header('00000000-0000-0000-0000-0000000000ff');
do $$ begin
  if exists (select 1 from public.evidence) then raise exception 'FAIL: non-member header reads'; end if;
  raise notice 'PASS: a non-member id reads nothing';
end $$;
select pg_temp.as_header('00000000-0000-0000-0000-00000000000c');
insert into public.comments (evidence_id, body) values ('11111111-1111-1111-1111-111111111111', 'Picked Justin from the menu');
do $$ begin
  if (select author from public.comments where body = 'Picked Justin from the menu') <> '00000000-0000-0000-0000-00000000000c' then
    raise exception 'FAIL: comment author not taken from header';
  end if;
  if (select actor from public.audit_log order by id desc limit 1) <> '00000000-0000-0000-0000-00000000000c' then
    raise exception 'FAIL: audit actor not taken from header';
  end if;
  raise notice 'PASS: header identity writes as that member and is audited';
end $$;
do $$ begin
  if public.is_arbiter() or public.my_role() <> 'no' then raise exception 'FAIL: header role'; end if;
  update public.evidence set status = 'rejected', decision_note = 'x' where id = '11111111-1111-1111-1111-111111111111';
  if (select status from public.evidence where id = '11111111-1111-1111-1111-111111111111') <> 'approved' then
    raise exception 'FAIL: bettor by header decided evidence';
  end if;
  raise notice 'PASS (blocked): picking Justin gives NO-side rights only; he cannot decide evidence';
end $$;
select pg_temp.as_header('00000000-0000-0000-0000-00000000000a');
do $$ begin
  if not public.is_arbiter() then raise exception 'FAIL: arbiter by header'; end if;
  raise notice 'PASS: picking Shaun gives arbiter rights';
end $$;
reset role;
select set_config('request.headers', '', false);
set role authenticated;
select pg_temp.as_user('shaun@example.com');

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
