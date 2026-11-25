
# mma-scrape

Nightly sync for FightCenter. UFC events, matchups and fighter stats come from the
[ufc-data-pipeline](../ufc-data-pipeline) BigQuery warehouse (`analytics.fct_fights`,
`analytics.dim_fighters`) and are synced into Supabase Postgres. ESPN's public scoreboard API
is used for one thing only: which broadcast segment (Main Card / Prelims / Early Prelims) each
fight is on and when that segment starts, matched onto fights by event date (±1 day) and
fighter-name pair.

[fyte-center](https://fyte-center.vercel.app/) reads the synced tables straight from Supabase;
this service only writes them.

## Technology

- Supabase Postgres (`pg`) for serving storage, schema in `db/migrations/`
- BigQuery (`@google-cloud/bigquery`) as the source of truth
- Express (single `POST /sync` endpoint, deployed on Vercel)

## Database setup

FightCenter shares a Supabase project with another app, isolated in its own `fightcenter`
schema. The sync connects as a restricted role that can only access that schema.

1. In the Supabase SQL editor, create the role (don't commit the password):
   `create role fightcenter_sync login password '<strong password>';`
2. Run `db/migrations/001_init_fightcenter.sql` in the SQL editor (or with `psql`) as `postgres`.
   Migrations here are applied by hand. They are not part of that project's Supabase CLI
   history, so if the other app uses `supabase db pull`/`db diff`, limit those commands
   to its own schemas.
3. Set `SUPABASE_DB_URL` to the transaction-pooler URL with username
   `fightcenter_sync.<project-ref>` (see `.env.example`).
4. For fyte-center's reads, `fightcenter` is listed under Dashboard → Data API → Settings →
   Exposed schemas; it queries with `createClient(url, publishableKey, { db: { schema: "fightcenter" } })`.

## Sync

```
npm run backfill        # all history, run once locally
npm run sync            # nightly window: events from the last 30 days + upcoming
npm run sync -- --segments-only   # only re-match ESPN segment times
npm run sync -- --segments-backfill [--since 2015-01-01] [--dry-run]
                        # one-time: ESPN card sections for past events that have none
npm test                # matching unit tests
```

ESPN only keeps distinct per-section start times for past events from about 2016 on, so the
segments backfill leaves older events as a single card. It also skips events whose ESPN times
don't run main → prelims → early prelims down the card (a few old events have them out of order).
New events keep the sections they got while upcoming, so the backfill doesn't need to run again.

Events the warehouse marks `event_status = 'cancelled'` (future-dated, but gone from ufcstats'
upcoming-events page) are skipped, and deleted from Postgres if an earlier sync stored them.
This needs `fct_fights` built with `event_status` (ufc-data-pipeline).

In production, the ufc-data-pipeline GitHub Actions run (5 AM Phoenix) calls `POST /sync` with
an `x-api-key` header right after loading the warehouse; a daily [cron-job.org](https://cron-job.org)
job at 6 AM makes the same call as a backup and emails on failure. The same request triggers a
sync by hand.

See `.env.example` for the environment variables.

## Tables (schema `fightcenter`)

- `events`: one row per ufcstats event, plus ESPN segment start times
- `fighters`: bio, physical attributes, career and UFC records, career rate stats
- `fights`: one row per fight, with `fight_order` (0 = main event) and the ESPN `card_segment`
- `fight_stats`: one row per fighter per fight (participants, results and per-fight stats)

RLS allows public `select` only (what fyte-center uses); writes are limited to the
`fightcenter_sync` role.

## Endpoint

#### POST /sync

Requires `x-api-key` (`ADMIN_API_KEY`, or `SCRAPER_KEY`). Runs the BigQuery sync, then the ESPN
segment match, and returns a JSON summary. Answers 500 if the ESPN step failed or looks broken
(no ESPN events, or none matched), even though the BigQuery part is saved.
