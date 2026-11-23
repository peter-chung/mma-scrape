-- FightCenter serving schema. Lives in its own `fightcenter` schema inside a
-- Supabase project shared with another app; nothing here touches `public` or
-- any other schema. Apply by hand (Supabase SQL editor or psql) as `postgres`.
-- This is NOT part of that project's Supabase CLI migration history.
--
-- Prerequisite, run once in the SQL editor (keep the password out of git):
--   create role fightcenter_sync login password '<strong password>';
--
-- Source of truth is the ufc-data-pipeline BigQuery warehouse
-- (analytics.fct_fights / analytics.dim_fighters); every id below is a
-- ufcstats.com id. Only card_segment / segment_start (fights) and the *_start
-- columns (events) come from ESPN, written by the segment-matching step.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'fightcenter_sync') then
    raise exception 'create role fightcenter_sync first (see header comment)';
  end if;
end
$$;

create schema fightcenter;

create table fightcenter.fighters (
  fighter_id                       text primary key,
  first_name                       text,
  last_name                        text,
  nickname                         text,
  link                             text,
  height_inches                    integer,
  weight_lbs                       integer,
  reach_inches                     double precision,
  stance                           text,
  date_of_birth                    date,
  career_sig_str_landed_per_min    double precision,
  career_sig_str_acc_pct           double precision,
  career_sig_str_absorbed_per_min  double precision,
  career_sig_str_def_pct           double precision,
  career_td_avg_per_15min          double precision,
  career_td_acc_pct                double precision,
  career_td_def_pct                double precision,
  career_sub_avg_per_15min         double precision,
  -- whole-MMA-career record (may include other promotions)
  career_wins                      integer,
  career_losses                    integer,
  career_draws                     integer,
  career_no_contests               integer,
  -- UFC-only record, computed in the warehouse from fight results
  ufc_wins                         integer,
  ufc_losses                       integer,
  ufc_draws                        integer,
  ufc_no_contests                  integer,
  -- false for stub rows created because a fight references a fighter whose
  -- ufcstats profile hasn't been scraped yet
  has_profile                      boolean not null default true,
  synced_at                        timestamptz not null default now()
);

create index fighters_last_name_idx on fightcenter.fighters (lower(last_name));

create table fightcenter.events (
  event_id             text primary key,
  name                 text not null,
  event_date           date,
  completed            boolean not null default false,
  city                 text,
  state                text,
  country              text,
  link                 text,
  -- ESPN-sourced, null until the event is matched to an ESPN event
  main_card_start      timestamptz,
  prelims_start        timestamptz,
  early_prelims_start  timestamptz,
  segments_synced_at   timestamptz,
  synced_at            timestamptz not null default now()
);

create index events_event_date_idx on fightcenter.events (event_date);

create table fightcenter.fights (
  fight_id                text primary key,
  event_id                text not null references fightcenter.events (event_id) on delete cascade,
  fight_order             integer,          -- 0 = main event, ascending down the card
  weight_class            text,
  method                  text,
  method_category         text,             -- KO/TKO, SUB, DEC, DQ, NC, OTHER
  finish_round            integer,
  finish_time             text,
  time_format             text,
  referee                 text,
  details                 text,
  round_lengths_seconds   integer[],
  fight_duration_seconds  integer,
  winner_fighter_id       text references fightcenter.fighters (fighter_id),
  -- ESPN-sourced, null when no ESPN match (shown as "Unassigned Fights")
  card_segment            text check (card_segment in ('main', 'prelims', 'early_prelims')),
  segment_start           timestamptz,
  synced_at               timestamptz not null default now()
);

create index fights_event_id_idx on fightcenter.fights (event_id, fight_order);

-- One row per fighter per fight. Doubles as the participants table, so upcoming
-- fights have rows here too (with null stats).
create table fightcenter.fight_stats (
  fight_id                text not null references fightcenter.fights (fight_id) on delete cascade,
  fighter_id              text not null references fightcenter.fighters (fighter_id),
  corner                  smallint not null check (corner in (1, 2)),
  result                  text,             -- W / L / D / NC / null (upcoming or unparsed)
  knockdowns              integer,
  sig_str_landed          integer,
  sig_str_attempted       integer,
  sig_str_pct             double precision,
  total_str_landed        integer,
  total_str_attempted     integer,
  td_landed               integer,
  td_attempted            integer,
  td_pct                  double precision,
  sub_attempts            integer,
  reversals               integer,
  control_time_seconds    integer,
  head_str_landed         integer,
  head_str_attempted      integer,
  body_str_landed         integer,
  body_str_attempted      integer,
  leg_str_landed          integer,
  leg_str_attempted       integer,
  distance_str_landed     integer,
  distance_str_attempted  integer,
  clinch_str_landed       integer,
  clinch_str_attempted    integer,
  ground_str_landed       integer,
  ground_str_attempted    integer,
  synced_at               timestamptz not null default now(),
  primary key (fight_id, fighter_id),
  unique (fight_id, corner)
);

create index fight_stats_fighter_id_idx on fightcenter.fight_stats (fighter_id);

-- Access ------------------------------------------------------------------
-- Custom schemas don't get Supabase's default API grants, so grant explicitly.
-- anon/authenticated: read-only (for fyte-center via Supabase's API, once
-- `fightcenter` is added to Dashboard → API → Exposed schemas).
-- fightcenter_sync: read/write on this schema only; it has no grants anywhere else.
grant usage on schema fightcenter to anon, authenticated, fightcenter_sync;
grant select on all tables in schema fightcenter to anon, authenticated;
grant select, insert, update, delete on all tables in schema fightcenter to fightcenter_sync;

alter default privileges in schema fightcenter
  grant select on tables to anon, authenticated;
alter default privileges in schema fightcenter
  grant select, insert, update, delete on tables to fightcenter_sync;

alter table fightcenter.fighters    enable row level security;
alter table fightcenter.events      enable row level security;
alter table fightcenter.fights      enable row level security;
alter table fightcenter.fight_stats enable row level security;

create policy "public read" on fightcenter.fighters    for select to anon, authenticated using (true);
create policy "public read" on fightcenter.events      for select to anon, authenticated using (true);
create policy "public read" on fightcenter.fights      for select to anon, authenticated using (true);
create policy "public read" on fightcenter.fight_stats for select to anon, authenticated using (true);

-- RLS applies to the sync role too (it doesn't own the tables), so give it
-- explicit full access.
create policy "sync full access" on fightcenter.fighters    for all to fightcenter_sync using (true) with check (true);
create policy "sync full access" on fightcenter.events      for all to fightcenter_sync using (true) with check (true);
create policy "sync full access" on fightcenter.fights      for all to fightcenter_sync using (true) with check (true);
create policy "sync full access" on fightcenter.fight_stats for all to fightcenter_sync using (true) with check (true);
