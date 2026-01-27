---
created: 2026-01-27T10:00
title: Retrieve teams from Sportlink for work history
area: automation
files:
  - download-data-from-sportlink.js
  - submit-stadion-sync.js
---

## Problem

The current work history sync doesn't properly capture team roles. We need to retrieve team data directly from Sportlink to get accurate role descriptions for both players and staff members.

Currently the team sync uses simplified data. To improve work history accuracy, we need:
1. Full team list with metadata (name, activity, gender, member counts)
2. Player roles per team (via `RoleDescription`)
3. Staff roles per team (via `FunctionDescription`)

## Solution

Extend the Sportlink download process to:

1. Navigate to `https://club.sportlink.com/teams/union-teams`
2. Capture response from `/navajo/entity/common/clubweb/team/UnionTeams`
3. Extract `Team` entity array, store in new `teams` table:
   - `PublicTeamId`
   - `TeamName`
   - `GameActivityDescription`
   - `Gender`
   - `TeamMemberCount`
   - `PlayerCount`

4. For each team, navigate to `https://club.sportlink.com/teams/team-details/<PublicTeamId>/members`
5. Capture two responses:
   - `UnionTeamPlayers` → extract `Person` array, match via `PublicPersonId`, store `RoleDescription`
   - `UnionTeamNonPlayers` → extract `Person` array, match via `PublicPersonId`, store `FunctionDescription`

6. Update Teams sync to use team names from this data
7. Use `RoleDescription` (players) and `FunctionDescription` (staff) as roles in work history
