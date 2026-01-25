---
created: 2026-01-25T11:35
title: Add varlock declarative features to .env.example
area: tooling
files:
  - .env.example
---

## Problem

The `.env.example` file documents required environment variables but doesn't use varlock's declarative features. Varlock supports type annotations, required markers, and descriptions that can provide better validation and documentation.

## Solution

Review varlock documentation for declarative syntax (e.g., type hints, required markers, descriptions) and update `.env.example` to use these features for improved developer experience and runtime validation.
