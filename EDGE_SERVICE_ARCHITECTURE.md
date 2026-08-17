# Edge Service Architecture

## Overview
This is the **Edge Service** that runs on Orange Pi devices. It handles:
- Hardware control (coin slots, GPIO)
- License validation (local + cloud)
- PisoWiFi network management
- Data syncing to Supabase

**It does NOT include:**
- Vendor dashboard UI
- React components
- Multi-tenant management interface

## Directory Structure

```
edge-service/
├── src/
│   ├── hardware/          # Hardware control modules
│   │   ├── gpio.ts        # GPIO/coin slot handling
│   │   ├── network.ts     # Network management
│   │   └── serial.ts      # Hardware ID extraction
│   ├── license/           # Licensing logic
│   │   ├── validator.ts   # License validation
│   │   ├── trial.ts       # 7-day trial management
│   │   └── sync.ts        # Cloud license sync
│   ├── sync/              # Supabase sync
│   │   ├── sales-sync.ts  # Sync sales to cloud
│   │   ├── status-sync.ts # Machine status updates
│   │   └── client.ts      # Supabase client
│   ├── api/               # Local API endpoints
│   │   ├── portal.ts      # Captive portal
│   │   ├── sessions.ts    # Session management
│   │   └── admin.ts       # Local admin endpoints
│   ├── db/                # Local SQLite
│   │   └── database.ts    # Database operations
│   └── index.ts           # Main entry point
├── package.json
├── tsconfig.json
└── README.md
```

## What Runs on Orange Pi

### 1. Hardware Control
- Coin slot detection via GPIO
- Network interface management
- Hotspot/DHCP server
- Traffic control (QoS)

### 2. Licensing
- Check license activation status
- Validate against Supabase
- Manage 7-day trial
- Block services if unlicensed

### 3. Data Sync to Cloud
```typescript
// When coin inserted
await syncSaleToSupabase({
  machine_id: MACHINE_UUID,
  amount: 5.00,
  session_duration: 300,
  customer_mac: 'AA:BB:CC:DD:EE:FF'
});

// Periodic status updates
await syncMachineStatus({
  status: 'online',
  last_seen: new Date()
});
```

### 4. Local APIs
- Captive portal for customers
- Session management
- Local admin panel (hardware setup only)

## What Does NOT Run Here

❌ Vendor dashboard  
❌ Multi-tenant management  
❌ Revenue analytics UI  
❌ Machine fleet view  
❌ Vendor authentication  

These live in the separate **vendor-dashboard** package (cloud-hosted).

## Environment Variables

```env
# Supabase (for syncing only)
SUPABASE_URL=https://fuiabtdflbodglfexvln.supabase.co
SUPABASE_ANON_KEY=your-anon-key

# Machine Identity (set during activation)
MACHINE_ID=uuid-from-vendors-table
VENDOR_ID=uuid-of-owning-vendor

# Local Settings
PORT=80
NODE_ENV=production
```

## Deployment

This service is meant to run on Orange Pi using systemd or PM2:

```bash
# Build
npm run build

# Start
npm start

# Or with PM2
pm2 start dist/index.js --name pisowifi-edge
```

## Communication Flow

```
Orange Pi (Edge Service)
    ↓ syncs sales data
    ↓ syncs machine status
    ↓ validates license
Supabase Cloud Database
    ↑ reads data
    ↑ manages fleet
Vendor Dashboard (Cloud Web App)
```

## Next Steps

See `vendor-dashboard/` for the cloud-hosted management interface.
