-- One-time database setup on a self-hosted Postgres (Coolify): run as the
-- superuser in the database's Terminal:   psql -U postgres
-- Replace CHANGE_ME with a long random password (e.g. `openssl rand -hex 24`).
--
-- The app must NOT connect as a superuser: row-level security (tenant
-- isolation) is only a guarantee for a role that can't bypass it, and the app
-- refuses to start in production otherwise. This role owns the database, so it
-- can also run the migrations.
CREATE ROLE liquidledger LOGIN PASSWORD 'CHANGE_ME' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE DATABASE liquidledger OWNER liquidledger;
\connect liquidledger
ALTER SCHEMA public OWNER TO liquidledger;
