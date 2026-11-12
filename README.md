# Pothos Experiment Manager

Pothos is a Hebrew laboratory experiment-management system for a darts-based
serial-performance study. It gives the experimenter a private control screen
and presents timing, turn information, and competition results on a separate
participant display.

## Main features

- Configurable numbers of participants, rounds, and darts
- Practice and serial-competition stages
- Per-dart, per-round, and cumulative score recording
- Synchronized Hebrew countdown and end-of-time audio cues
- Responsive participant display for a second screen or projector
- Automatic local recovery and live backup to an authorized HUJI network folder
- Detailed Excel export, including practice and competition throws

## Privacy and data

This public repository contains application source code only. It does not
contain participant records, experiment results, credentials, access codes, or
database contents. The deployed system uses a server-validated access code that
is configured as a protected runtime secret; making this repository public does
not make collected data or the access code public.

## Restore from GitHub

Use Node.js 22.13 or newer and pnpm 11.19.0. These steps run the
application with a fresh local D1 database and require no ChatGPT account.

```bash
git clone https://github.com/MarcianoLab/pothos-experiment-manager.git
cd pothos-experiment-manager
pnpm install --frozen-lockfile
pnpm build
```

Create `dist/server/.dev.vars` with a local access code and a signing secret.
Generate the signing secret with
`node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.

```dotenv
POTHOS_ACCESS_CODE="choose-your-local-code"
POTHOS_SESSION_SECRET="paste-the-generated-secret"
```

Initialize the database and start the built app.

```bash
pnpm dlx wrangler@4.92.0 d1 execute DB --local --persist-to .wrangler/local-state --config dist/server/wrangler.json --file drizzle/0000_empty_fantastic_four.sql
pnpm dlx wrangler@4.92.0 dev --local --persist-to .wrangler/local-state --config dist/server/wrangler.json
```

Run the initialization command once per fresh local database. Open the
localhost URL printed by Wrangler and sign in with the local access code.
Recreate `dist/server/.dev.vars` after a clean rebuild.

## Independent hosting

The application uses Cloudflare Workers and D1 for its cloud backup. To host
it in your own Cloudflare account, build as above and use the generated
`dist/server/wrangler.json` as the deployment configuration. Create a D1
database in that account and replace the placeholder `database_name` and
`database_id` in the generated file. Keep the binding named `DB`. Give the
Worker a name unique to your account and keep the generated asset settings.

Apply the SQL migration to the new database with the same `d1 execute`
command, replacing `--local --persist-to .wrangler/local-state` with
`--remote`. Configure
`POTHOS_ACCESS_CODE` and `POTHOS_SESSION_SECRET` as Worker secrets.
Deploy with `pnpm dlx wrangler@4.92.0 deploy --config dist/server/wrangler.json`.
Keep the database ID and secret values in your own deployment environment.
Repeat the generated configuration changes after rebuilding.

GitHub restores the application and its schema. To restore existing sessions
in a replacement deployment, keep a separate, authorized backup of the
experiment data and restore it to the replacement database. Excel exports
remain readable without Pothos. Browser-local drafts and folder permissions
live in the browser profile where they were created.

Current deployment (restricted):
[pothos-experiment-manager.marcianolab.chatgpt.site](https://pothos-experiment-manager.marcianolab.chatgpt.site/)

## Network folder

In the operator settings, edit the network path and copy it into the Windows
folder picker. Click the network folder selection button to grant write access,
even when replacing a folder that is already connected. The path and folder
permission are remembered in the current browser. Editing the path pauses writes
to the previous folder until a folder is selected for the new path.

## Bonus draw

The operator confirms the end of the competition after checking the recorded
scores. The end screen waits until the operator clicks the bonus draw button.
Pothos then ranks participants by cumulative competition score. Participants
with equal scores share the same rank and receive the same number of entries.
The next distinct score receives the next rank. The first rank gets as many
entries as there are participants, and each subsequent rank gets one fewer.
With six participants, a tie for second gives 6, 5, 5, 4, 3, and 2 entries.
Pothos draws one entry, awards one bonus (10 ILS by default), and
shows the winner's participant number on the participant display.

The result is stored with the session. The operator can reopen practice or
competition to correct scores. A practice correction leaves the draw intact.
If a cumulative competition score changes, the end screen labels the earlier
result and offers a new draw using the updated totals. The operator must
confirm the new draw to replace the previous result.

The Excel Summary records the current scores and identifies the saved winner.
When the scores have changed since the last draw, Session_metadata marks it
as `scores_updated` and retains the earlier draw details. After a new draw,
the Summary includes the updated ranks and ticket counts.

## Research use

Before using the system to collect research data, configure the storage
destination and access policy approved for your institution and study.
