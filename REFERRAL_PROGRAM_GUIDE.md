# Referral / Affiliate Program Guide

## Overview

The Referral Program lets your customers earn free credit by referring friends to your PisoWiFi machine. Each device gets a unique 6-character referral code. When a new customer enters that code, they receive free bonus minutes — and the referrer earns credit points every time the referred friend pays.

---

## How It Works

### For Customers

```
Customer A (Referrer)                Customer B (Referee)
┌─────────────────────┐              ┌─────────────────────┐
│ 1. Connects to WiFi │              │                     │
│ 2. Sees referral    │              │                     │
│    code: A3X9K2     │              │                     │
│ 3. Shares code ─────┼──────────────┼─▶ 4. Connects       │
│                     │              │   5. Enters code     │
│                     │              │   6. Gets 5 free min │
│                     │              │                     │
│ ◀── earns 1 point ──┼──────────────┼── 7. Inserts ₱20   │
│    for every ₱20    │              │                     │
│    friend spends    │              │                     │
└─────────────────────┘              └─────────────────────┘
```

### Step by Step

1. **Customer A** connects to your PisoWiFi and sees their unique referral code (e.g., `A3X9K2`) on the portal during their active session
2. **Customer A** shares the code with **Customer B** (word of mouth, text, etc.)
3. **Customer B** connects to your PisoWiFi and sees the "Have a Referral Code?" card on the portal landing page
4. **Customer B** enters the 6-character code and taps **Redeem**
5. **Customer B** receives free bonus minutes (default: 5 minutes)
6. Every time **Customer B** inserts coins, **Customer A** earns credit points (default: 1 point per ₱20 spent)
7. Credit points are added to the referrer's balance and can be used like regular credits

---

## Admin Configuration

Navigate to **Referrals** (🤝) in the admin sidebar.

### Settings

| Setting | Description | Default |
|---------|-------------|---------|
| **Enable/Disable** | Toggle the entire referral program on/off | Disabled |
| **Pesos Per Point** | How many pesos the referred friend must spend before the referrer earns 1 credit point | ₱20 |
| **Referee Bonus Minutes** | Free minutes given to the new customer when they redeem a code | 5 min |
| **Min Pesos To Trigger** | Minimum single coin insert to count toward referrer points | ₱20 |

### Stats Dashboard

The dashboard shows:

- **Total Referrals** — number of successful code redemptions
- **Total Points Awarded** — sum of all credit points earned by referrers
- **Active Referrers** — number of unique customers who have referred at least one friend
- **Top 10 Referrers** — table showing MAC address, referral code, referral count, and points earned
- **Recent Events** — log of the last 50 referral events with timestamps

---

## Business Rules

| Rule | Description |
|------|-------------|
| **Self-referral blocked** | A customer cannot use their own referral code |
| **Existing customers blocked** | Only new devices (not seen before the referral code was created) can use referral codes |
| **One-time referee bonus** | The referred friend gets bonus minutes only once (on first redemption) |
| **One-time referral link** | A device can only be referred once (cannot change referrer) |
| **Ongoing referrer rewards** | The referrer earns points every time the referred friend pays, for the lifetime of the referral |
| **Points are credits** | Earned points are stored as credit pesos and can be used via the existing credit system |
| **Minimum spend threshold** | Only coin inserts meeting the "Min Pesos To Trigger" setting count toward referrer points |

---

## Portal UI

### Before Session (Login View)

- **"Have a Referral Code?"** card — shown when the referral program is enabled
- Contains a 6-character text input and a **Redeem** button
- Shows success/error feedback after redemption
- Hidden when the program is disabled

### During Session (Active View)

- **"Refer a Friend"** card — shown when the program is enabled and the device has a referral code
- Displays the user's unique 6-character code in large monospace text
- **Copy** button for easy sharing (copies to clipboard)
- Hidden when the program is disabled

---

## Technical Details

### Database Tables

**`referral_codes`** — Maps each device MAC to a unique 6-character code

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment primary key |
| mac_address | TEXT | Device MAC (UNIQUE) |
| code | TEXT | 6-char referral code (UNIQUE) |
| created_at | DATETIME | When the code was generated |

**`referral_events`** — Audit log of all referral activity

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment primary key |
| referrer_mac | TEXT | MAC of the referrer |
| referee_mac | TEXT | MAC of the referred friend |
| referee_ip | TEXT | IP of the referee at redemption |
| referral_code | TEXT | The code that was redeemed |
| pesos_spent | INTEGER | Pesos spent in this transaction |
| points_earned | INTEGER | Points awarded in this transaction |
| referee_bonus_minutes | INTEGER | Bonus minutes given (only on first redemption) |
| created_at | DATETIME | When the event occurred |

**`wifi_devices` columns added:**

| Column | Type | Description |
|--------|------|-------------|
| referral_code | TEXT | Quick-access copy of the device's referral code |
| referred_by | TEXT | MAC of the referrer (NULL if not referred) |
| referral_points | INTEGER | Total points earned from referrals |
| first_seen_at | DATETIME | When the device was first seen (used for existing customer check) |

### API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/referral/code` | Client | Get or create referral code for current device |
| POST | `/api/referral/redeem` | Client | Redeem a referral code |
| GET | `/api/referral/config` | Admin | Get referral configuration |
| POST | `/api/referral/config` | Admin | Save referral configuration |
| GET | `/api/referral/stats` | Admin | Get referral statistics |
| GET | `/api/referral/stats/:mac` | Admin | Get per-referrer statistics |

### Code Generation

- 6 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`
- Excludes ambiguous characters: `I`, `O`, `0`, `1`
- Collision-resistant with automatic retry on duplicates

### Payment Hooks

The `awardReferrerPoints()` function is called after every successful payment in 3 locations:

1. **`/api/credits/add`** — Admin adding credit to a device
2. **`/api/credits/use`** — Customer using credit to pay
3. **`/api/sessions/start`** — Coin insert from the main coinslot

---

## Files Modified

| File | Change |
|------|--------|
| `lib/db.js` | Added `referral_codes`, `referral_events` tables; added columns to `wifi_devices`; added `referral_config` default |
| `server.js` | Added referral helper functions, API endpoints, and payment hooks |
| `public/index.html` | Added referral entry card and referral share card HTML |
| `public/js/portal.js` | Added referral API calls, show/hide logic, copy-to-clipboard, form handlers |
| `components/Admin/ReferralManager.tsx` | New admin settings + stats dashboard component |
| `App.tsx` | Added Referrals sidebar item and tab rendering |
| `types.ts` | Added `AdminTab.Referrals` enum + referral TypeScript interfaces |
| `migrations/referral_program.sql` | SQL migration file for documentation/Supabase sync |

---

## Migration Notes

- Database schema changes are **automatic** — new tables and columns are created on server startup
- Existing `wifi_devices` records will have `NULL` for new columns (referral_code, referred_by, referral_points, first_seen_at) — this is expected
- The referral program is **disabled by default** — enable it from the admin Referrals tab
- No data loss or downtime expected during update
- The `first_seen_at` column is automatically populated for all new device registrations
