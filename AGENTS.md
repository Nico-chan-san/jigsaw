# Agent notes

## Database changes

The SQLite database in `data/` is live in production, so schema changes must never break an existing database.

- Every change to the database (new tables, columns, indexes, data fixes) goes in a new migration file in `server/migrations/`, named `NNN-short-description.sql` with the next number, for example `001-add-piece-locks.sql`.
- Migrations run automatically, in order, when the Vite server starts (`npm run dev` or `npm run start`), each exactly once. The applied version is tracked with `PRAGMA user_version` (see `migrate()` in `server/api.js`).
- Do not edit the baseline `CREATE TABLE` statements in `server/api.js`, and never edit or renumber a migration that has already shipped. Fix mistakes with a new migration.
- Write migrations so they work on a database that already holds data: give new `NOT NULL` columns a default, and backfill in the same migration when needed.
