---
created: 2026-02-09T15:32:10.521Z
title: Rename stadion references to rondo in database structure
area: database
files:
  - data/stadion-sync.sqlite
  - lib/dashboard-db.js
  - lib/run-tracker.js
  - steps/*
  - pipelines/*
---

## Problem

The codebase and database structure still use "stadion" naming (from the old "Stadion" WordPress theme) throughout. This includes:
- SQLite database file: `data/stadion-sync.sqlite`
- Table names: `stadion_members`, `stadion_parents`, `stadion_teams`, `stadion_commissies`, `stadion_work_history`, `stadion_commissie_work_history`, `stadion_important_dates`, `stadion_change_detections`
- Column names: `stadion_id`, `*_stadion_modified`
- References in all pipeline and step files
- The `club_slug` defaults to 'rondo' in dashboard but 'stadion' naming persists in sync DB

This is a big chunk of work as "stadion" is referenced everywhere in the codebase — table names, column names, queries, variable names, and file names. It needs a coordinated migration to avoid breaking running syncs.

## Solution

This should be a dedicated milestone phase due to scope:
1. Rename `data/stadion-sync.sqlite` to `data/rondo-sync.sqlite` (or keep `data/rondo-sync.sqlite` if that already exists separately)
2. Rename all `stadion_*` tables to `rondo_*` (with migration scripts)
3. Rename `stadion_id` column to `rondo_id` across all tables
4. Update all code references (steps, pipelines, lib files, tools)
5. Rename `*_stadion_modified` tracking columns to `*_rondo_modified`
6. Must handle live migration gracefully (server is running cron syncs)
