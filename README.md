
# MMA Events API

Serving layer for FightCenter. UFC events, matchups and fighter stats come from the
[ufc-data-pipeline](../ufc-data-pipeline) BigQuery warehouse (`analytics.fct_fights`,
`analytics.dim_fighters`) and are synced into Supabase Postgres. ESPN's public scoreboard API
is used for one thing only: which broadcast segment (Main Card / Prelims / Early Prelims) each
fight is on and when that segment starts, matched onto fights by event date (±1 day) and
fighter-name pair.

The API can be found at https://mma-events-api.vercel.app/events
My accompanying website can be found at https://fyte-center.vercel.app/

## Technology

- Supabase Postgres (`pg`) for serving storage, schema in `db/migrations/`
- BigQuery (`@google-cloud/bigquery`) as the source of truth
- Express

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
4. Later, to let fyte-center query Supabase directly, add `fightcenter` under
   Dashboard → API → Exposed schemas and use `createClient(url, anonKey, { db: { schema: "fightcenter" } })`.

## Sync

```
npm run backfill        # all history, run once locally
npm run sync            # nightly window: events from the last 30 days + upcoming
npm run sync -- --segments-only   # only re-match ESPN segment times
npm test                # matching unit tests
```

On Vercel, the nightly cron calls `GET /api/cron/sync` (authorized with `CRON_SECRET`).
`POST /sync` with an `x-api-key` header triggers the same sync manually.

See `.env.example` for the environment variables.

## Tables (schema `fightcenter`)

- `events`: one row per ufcstats event, plus ESPN segment start times
- `fighters`: bio, physical attributes, career and UFC records, career rate stats
- `fights`: one row per fight, with `fight_order` (0 = main event) and the ESPN `card_segment`
- `fight_stats`: one row per fighter per fight (participants, results and per-fight stats)

RLS allows public `select` only (once the schema is exposed through Supabase's API); writes are
limited to the `fightcenter_sync` role.

## Endpoint

#### GET /events

Upcoming events in the legacy snapshot shape (`[{ data: [event] }]`) that fyte-center reads
today. Each event has `title`, `link`, `mainCardStartIso`, `prelimsStartIso`,
`earlyPrelimsStartIso`, `dateTime`, `city`, `state`, `country`, and `fights`. Each fight has
`cardSection` (`main`, `prelims`, `early_prelims`, or `null` when ESPN hasn't listed it yet),
plus `fighter1`/`fighter2` (`name`, `link`, `fighterId`).
