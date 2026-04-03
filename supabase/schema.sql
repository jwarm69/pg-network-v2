-- PG Network V2 \u2014 Supabase Database Schema
-- Run this in the Supabase SQL Editor to set up all tables.

-- ============================================================
-- 1. Tables
-- ============================================================

create table targets (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  type       text not null,        -- celebrity | podcast | organic
  status     text not null default 'new',
  priority   text not null default 'medium',
  channel    text not null default '',
  score      numeric,
  notes      text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table research (
  id         uuid primary key default gen_random_uuid(),
  target_id  uuid not null references targets(id) on delete cascade,
  field      text not null,
  value      text not null,
  source_url text,
  verified   boolean not null default false,
  created_at timestamptz not null default now()
);

create table outreach_threads (
  id         uuid primary key default gen_random_uuid(),
  target_id  uuid not null references targets(id) on delete cascade,
  lane       text not null,        -- direct | agent | wildcard
  channel    text not null,
  status     text not null default 'draft',
  created_at timestamptz not null default now()
);

create table messages (
  id                 uuid primary key default gen_random_uuid(),
  thread_id          uuid not null references outreach_threads(id) on delete cascade,
  sequence           integer not null,
  subject            text not null,
  body               text not null,
  sent               boolean not null default false,
  sent_at            timestamptz,
  response_text      text,
  response_sentiment text,          -- interested | warm | redirect | neutral | decline | spam
  created_at         timestamptz not null default now()
);

create table contact_paths (
  id         uuid primary key default gen_random_uuid(),
  target_id  uuid not null references targets(id) on delete cascade,
  type       text not null,
  name       text not null,
  role       text not null,
  email      text,
  channel    text not null,
  confidence text not null default 'medium',  -- high | medium | low
  source_url text
);

create table activity_log (
  id         uuid primary key default gen_random_uuid(),
  target_id  uuid references targets(id) on delete set null,
  action     text not null,
  details    text not null,
  created_at timestamptz not null default now()
);

create table command_history (
  id         uuid primary key default gen_random_uuid(),
  input      text not null,
  response   text not null,
  intent     text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 2. Indexes
-- ============================================================

create index idx_targets_status   on targets(status);
create index idx_targets_type     on targets(type);
create index idx_targets_priority on targets(priority);

create index idx_research_target_id on research(target_id);

create index idx_outreach_threads_target_id on outreach_threads(target_id);

create index idx_messages_thread_id on messages(thread_id);

create index idx_activity_log_target_id  on activity_log(target_id);
create index idx_activity_log_created_at on activity_log(created_at);

-- ============================================================
-- 3. Row Level Security
-- ============================================================

alter table targets          enable row level security;
alter table research         enable row level security;
alter table outreach_threads enable row level security;
alter table messages         enable row level security;
alter table contact_paths    enable row level security;
alter table activity_log     enable row level security;
alter table command_history  enable row level security;

create policy "Authenticated full access" on targets
  for all to authenticated using (true) with check (true);

create policy "Authenticated full access" on research
  for all to authenticated using (true) with check (true);

create policy "Authenticated full access" on outreach_threads
  for all to authenticated using (true) with check (true);

create policy "Authenticated full access" on messages
  for all to authenticated using (true) with check (true);

create policy "Authenticated full access" on contact_paths
  for all to authenticated using (true) with check (true);

create policy "Authenticated full access" on activity_log
  for all to authenticated using (true) with check (true);

create policy "Authenticated full access" on command_history
  for all to authenticated using (true) with check (true);

-- ============================================================
-- 4. updated_at trigger for targets
-- ============================================================

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_targets_updated_at
  before update on targets
  for each row
  execute function set_updated_at();

-- ============================================================
-- 5. Seed data (uncomment to populate on first load)
-- ============================================================

/*
insert into targets (id, name, type, status, priority, channel, score, notes)
values (
  '11111111-1111-1111-1111-111111111111',
  'Emma Stone',
  'celebrity',
  'researched',
  'high',
  'instagram',
  82,
  'Academy Award winner. Interested in sustainability and mental health advocacy.'
);

insert into research (target_id, field, value, source_url, verified) values
  ('11111111-1111-1111-1111-111111111111', 'instagram_handle', '@emmastone', 'https://instagram.com/emmastone', true),
  ('11111111-1111-1111-1111-111111111111', 'interests', 'Sustainability, mental health, independent film', null, false),
  ('11111111-1111-1111-1111-111111111111', 'management', 'WME \u2014 Partner: Patrick Whitesell', 'https://www.wmeagency.com', true);

insert into targets (id, name, type, status, priority, channel, score, notes)
values (
  '22222222-2222-2222-2222-222222222222',
  'The Tim Ferriss Show',
  'podcast',
  'new',
  'medium',
  'email',
  null,
  'Top business/self-improvement podcast. Good fit for founder stories.'
);

insert into research (target_id, field, value, source_url, verified) values
  ('22222222-2222-2222-2222-222222222222', 'host', 'Tim Ferriss', 'https://tim.blog/podcast', true),
  ('22222222-2222-2222-2222-222222222222', 'booking_email', 'podcast@tim.blog', 'https://tim.blog/contact', false),
  ('22222222-2222-2222-2222-222222222222', 'audience_size', '900M+ downloads', 'https://tim.blog/podcast', true);

insert into targets (id, name, type, status, priority, channel, score, notes)
values (
  '33333333-3333-3333-3333-333333333333',
  'Sarah Chen',
  'organic',
  'in_contact',
  'low',
  'linkedin',
  65,
  'Met at SF Climate Tech meetup. VP of Partnerships at GreenLoop.'
);

insert into research (target_id, field, value, source_url, verified) values
  ('33333333-3333-3333-3333-333333333333', 'company', 'GreenLoop Inc.', 'https://linkedin.com/in/sarahchen', true),
  ('33333333-3333-3333-3333-333333333333', 'role', 'VP of Partnerships', 'https://linkedin.com/in/sarahchen', true),
  ('33333333-3333-3333-3333-333333333333', 'met_at', 'SF Climate Tech Meetup \u2014 March 2026', null, true);
*/
