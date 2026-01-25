---
created: 2026-01-25T09:15
title: Switch email sending to Postmark
area: automation
files:
  - scripts/cron-wrapper.sh:47-50
---

## Problem

Cron sync report emails are landing in spam when sent via the server's `mail` command. This makes the automated reports unreliable since the operator may not see them.

Current implementation uses basic `mail -s` command which lacks proper authentication (SPF/DKIM), making emails likely to be flagged as spam.

## Solution

Switch to Postmark transactional email service:
- Sign up for Postmark account
- Add POSTMARK_API_KEY to .env
- Replace `mail` command in cron-wrapper.sh with curl to Postmark API
- Or create a small Node.js script for email sending

TBD: Evaluate if worth adding a dependency vs simple curl approach.
