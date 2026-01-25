---
created: 2026-01-25T12:30
title: Set email from name to Sportlink SYNC
area: automation
files:
  - scripts/send-email.js:57-61
---

## Problem

Postmark emails are sent without a display name - just the email address. Adding a from name like "Sportlink SYNC" makes the emails more recognizable in the inbox.

## Solution

Update the Postmark sendEmail call to include a from name:

```javascript
From: `Sportlink SYNC <${process.env.POSTMARK_FROM_EMAIL}>`
```

Or use Postmark's format: `"Sportlink SYNC" <email@domain.com>`
