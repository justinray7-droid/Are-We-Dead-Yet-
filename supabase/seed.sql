-- Seed data: members, config v1, definitions v1.
-- There is no sign-in (each person picks their name in the app), so the email
-- addresses are placeholders and nothing is ever sent to them. Change the names
-- here if you like; keep exactly one arbiter, one 'yes' and one 'no'.

insert into public.members (email, name, role) values
  ('shaun@example.com',  'Shaun',  'arbiter'),
  ('alex@example.com',   'Alex',   'yes'),
  ('justin@example.com', 'Justin', 'no');

insert into public.config_versions (version, config, note) values (1, '{
  "priors": {"A": 0.65, "B_LOOSE": 0.4, "B_STRICT": 0.125, "C": 0.4},
  "strengthLR": {"1": 1.25, "2": 1.5, "3": 2.0, "4": 3.0, "5": 5.0},
  "decay": {"enabled": true, "lr": 1.02, "skipThreshold": 3},
  "startDate": "2026-10-21",
  "resolutionDate": "2031-10-21",
  "backdateFlagDays": 30,
  "forecastMaxLR": 1.25,
  "caps": {"perItemLR": null, "perDayLR": null},
  "combination": "product",
  "timeZone": "America/Chicago"
}', 'Initial config from spec v1.1');

insert into public.definition_versions (version, change_log) values (1, 'Initial definitions from spec v1.1');

insert into public.definitions (version, key, title, body) values
  (1, 'autonomous', 'Autonomous',
   'Human prompting may be present to influence the work but is not necessary to sustain it. The AI can receive external input to advance ideas, as humans do, but it keeps working and making progress without a human driving each step.'),
  (1, 'claim_a', 'Claim A: Autonomous research and design',
   'AI independently picks a question, runs experiments or design iterations, and produces results that domain experts accept as real, under the definition of autonomous above.'),
  (1, 'claim_b_loose', 'Claim B-loose: Results beyond human understanding (primary)',
   'Humans can verify that a result works but could not have produced it or cannot follow how it was found. Reference examples: AlphaGo''s move 37, AlphaFold''s predictions.'),
  (1, 'claim_b_strict', 'Claim B-strict: Results beyond human understanding (secondary view)',
   'Experts cannot understand the result even when it is explained to them.'),
  (1, 'claim_c', 'Claim C: Speed at quality (tracked only)',
   'The AI does in weeks what a top expert team would take years to do, at equal or better quality, verified by experts. Speed alone does not count. Claim C is tracked and quantified only; it never affects the headline and does not close or gate the bet.'),
  (1, 'deciding_rule', 'How the bet is decided',
   'Shaun''s final ruling at resolution decides the bet. The live probability is a running estimate to inform and entertain; no probability threshold settles anything.');
