# 🛡️ RaidShield

> Real-time raid and coordinated spam protection for Reddit communities — built natively on the Devvit platform.

[![Devvit](https://img.shields.io/badge/Built%20with-Devvit-FF4500?style=flat-square)](https://developers.reddit.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/License-BSD--3--Clause-blue?style=flat-square)](LICENSE)

---

## The Problem

Coordinated raids can destroy a community in minutes. A wave of bot accounts floods the feed with identical spam, harassment keywords, or crypto scam links — faster than any mod team can respond manually. Existing defenses rely on brittle external Python scripts running on someone's laptop, which break under load and require constant maintenance.

## The Solution

RaidShield is a native Devvit app that runs entirely inside Reddit's infrastructure. It monitors every post and comment in real time using three independent detection engines, and automatically locks down the community the moment an attack is detected — before the content ever reaches the live feed.

No external servers. No API keys. One-click install from the App Directory.

---

## How It Works

### Detection Engines

**Velocity Monitor**
Tracks submission rate using a Redis sliding window. If the number of posts or comments exceeds the configured threshold within the time window, the circuit breaker trips automatically.

**Text Cluster Detector**
Fingerprints every submission using a djb2 hash of normalized text (homoglyphs stripped, zero-width characters removed, casing normalized). If N unique accounts post identical or near-identical content within the cluster window, it triggers lockdown. Catches copy-paste spam even when bots substitute Cyrillic lookalikes or add invisible characters.

**New-Account Swarm Detector**
Tracks the ratio of submissions from accounts younger than the configured age threshold. If new accounts make up more than 75% of traffic while total velocity is elevated, it flags a coordinated swarm.

### Response

When any engine trips:
1. The circuit breaker activates — all new submissions from non-approved users are silently moved to the mod queue
2. The incident is logged with timestamp, type, and reason
3. Mods receive an immediate modmail notification with full details
4. The dashboard updates in real time (no refresh needed — 5-second polling)

Mods can also activate a manual 1-hour emergency lockdown from the dashboard with a single button press.

---

## Architecture

```
src/
  main.ts        — Entry point, Devvit.configure()
  constants.ts   — Redis key factories, non-configurable constants
  config.ts      — RaidShieldConfig schema, Redis persistence, validation
  shingling.ts   — Text normalization, k-shingle generation, Jaccard similarity, djb2 fingerprinting
  redis.ts       — Sliding window velocity, cluster tracking, incident log, lockdown state
  mitigation.ts  — Quarantine, circuit breaker, manual lockdown, modmail notifications
  triggers.ts    — PostCreate + CommentCreate ingestion pipeline
  settings.ts    — Devvit App Settings (install-time) + AppInstall/AppUpgrade triggers
  dashboard.tsx  — Mod-only custom post type with live polling
```

### Data Flow

```
Reddit Event (PostCreate / CommentCreate)
        │
        ▼
  [Circuit Breaker Check] ──── LOCKED ──→ Quarantine content, return
        │ OPEN
        ▼
  [Velocity Monitor] ─────── BREACH ───→ Trip breaker, quarantine, modmail
        │ OK
        ▼
  [Swarm Detector] ──────── BREACH ───→ Trip breaker, quarantine, modmail
        │ OK
        ▼
  [Text Cluster Detector] ── BREACH ───→ Trip breaker, quarantine, modmail
        │ OK
        ▼
  Content passes to live feed
```

### Why Redis Sorted Sets

All rate tracking uses Redis sorted sets (`ZADD` / `ZREMRANGEBYSCORE`) rather than simple counters. This gives true sliding window semantics — entries expire naturally as time passes, with no cron job or scheduled cleanup needed. Memory is bounded by `ZREMRANGEBYRANK` to prevent unbounded growth under extreme load.

---

## Installation

### From the App Directory

1. Visit the [RaidShield App Directory page]([#](https://developers.reddit.com/apps/raidshield26))
2. Click **Add to Community**
3. Select your subreddit
4. Configure initial thresholds in the Settings panel
5. Go to your subreddit → overflow menu → **🛡️ Create RaidShield Dashboard**

### Development / Playtest

```bash
# Install dependencies
npm install

# Log in to Devvit
npm run login

# Start playtest on your test subreddit
npm run dev

# Deploy to App Directory
npm run deploy
```

**Requirements:** Node.js 18+, a Reddit account with mod permissions on a test subreddit.

---

## Configuration

All settings are adjustable live from the dashboard — no redeployment needed. Changes take effect on the next incoming event.

| Setting | Default | Description |
|---|---|---|
| Velocity threshold | 30 | Max submissions per window before lockdown |
| Velocity window | 60s | Sliding window duration |
| Cluster threshold | 50 | Unique accounts posting identical content |
| Cluster window | 180s | Time window for cluster tracking |
| New account age | 30 days | Age below which accounts are "new" |
| Auto lockdown duration | 30 min | How long automatic lockdown holds |
| Manual lockdown duration | 60 min | How long the emergency button holds |
| Auto-quarantine | ON | Move flagged content to mod queue |

### Demo / Testing Mode

To test with a single account, set:
- **Velocity threshold → 1** (trips on the first post)
- **Cluster threshold → 1** (trips on the first identical comment)

---

## Dashboard

The mod dashboard is a custom post type pinned to your subreddit. It shows:

- Live community status (NOMINAL / LOCKDOWN) — updates every 5 seconds without refresh
- 24-hour incident counter
- Recent incident feed with timestamps and detection type
- One-click emergency lockdown button
- Full settings panel with inline help text for every option

Non-moderators see a public-facing "Community Protection Active" notice. The full console is only visible to mods.

---

## Security Model

- **Mod-only access:** The dashboard checks `getModPermissionsForSubreddit` on every render. Non-mods never see operational controls.
- **No external dependencies:** All processing happens inside Reddit's infrastructure. No outbound network calls, no third-party APIs.
- **Non-destructive quarantine:** Flagged content is removed with `spam=true`, which hides it from the feed but preserves it in the mod queue for review and restoration.
- **Fail-safe defaults:** If Redis is unavailable, the detection pipeline fails open (content passes through) rather than blocking all submissions.

---

## Hackathon Submission

Built for the [Reddit Mod Tools Hackathon](https://mod-tools-migration.devpost.com/).

**Problem addressed:** Communities face existential threats from coordinated bot networks and bad-faith swarms. Current defenses rely on brittle external automation that breaks under load.

**Impact:** Reduces emergency incident response time from minutes of manual deletion to sub-100ms automatic detection and quarantine — before content reaches the live feed.

**Technical highlights:**
- Zero blocking dependencies on external infrastructure
- Redis sliding window rate limiting with O(log N) complexity per event
- Text shingling with homoglyph normalization catches obfuscated spam
- Live dashboard with 5-second polling — no page refresh needed
- Modmail notifications alert the full mod team instantly on lockdown

---

## License

BSD 3-Clause. See [LICENSE](LICENSE).
