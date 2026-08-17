# NodeMCU/Subvendo License System

## Overview

This system implements a separate license management system specifically for NodeMCU/Subvendo boards, distinct from the main PisoWiFi machine license. Each NodeMCU device requires its own license to operate.

## Key Features

### 🔑 Separate License System
- **Independent Licensing**: NodeMCU licenses are completely separate from main machine licenses
- **Per-Device Licensing**: Each NodeMCU board needs its own license
- **MAC Address Binding**: Licenses are bound to specific NodeMCU MAC addresses

### 🎯 7-Day Trial System
- **Automatic Trial**: Each NodeMCU can start a 7-day trial period
- **One-Time Trial**: Each device can only have one trial period
- **Trial Expiration**: After 7 days, the device requires a paid license

### 🏢 Admin Interface
- **License Management**: Manage licenses through the admin panel
- **Device Assignment**: Assign licenses to specific NodeMCU devices
- **License Generation**: Generate new license keys (superadmin only)
- **Trial Management**: Start trials for devices

### 📊 License Types
- **Trial**: 7-day free trial (one per device)
- **Standard**: Regular paid license with expiration
- **Premium**: Extended license with longer duration

## Database Schema

### NodeMCU Licenses Table
```sql
CREATE TABLE nodemcu_licenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_key TEXT UNIQUE NOT NULL,
  vendor_id UUID REFERENCES auth.users(id),
  device_id UUID REFERENCES nodemcu_devices(id),
  mac_address TEXT,
  is_active BOOLEAN DEFAULT false,
  activated_at TIMESTAMPTZ,
  license_type TEXT DEFAULT 'standard',
  expires_at TIMESTAMPTZ,
  trial_started_at TIMESTAMPTZ,
  trial_duration_days INTEGER DEFAULT 7,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

## API Endpoints

### License Status Check
```http
GET /api/nodemcu/license/status/:macAddress
```
Returns the license status for a specific NodeMCU device.

### License Activation
```http
POST /api/nodemcu/license/activate
Content-Type: application/json

{
  "licenseKey": "NODEMCU-XXXX-XXXX",
  "macAddress": "AA:BB:CC:DD:EE:FF"
}
```

### Start Trial
```http
POST /api/nodemcu/license/trial
Content-Type: application/json

{
  "macAddress": "AA:BB:CC:DD:EE:FF"
}
```

### Revoke License
```http
POST /api/nodemcu/license/revoke
Content-Type: application/json

{
  "licenseKey": "NODEMCU-XXXX-XXXX"
}
```

### Generate Licenses (Superadmin Only)
```http
POST /api/nodemcu/license/generate
Content-Type: application/json

{
  "count": 10,
  "licenseType": "standard",
  "expirationMonths": 12
}
```

### Get Vendor Licenses
```http
GET /api/nodemcu/license/vendor
```
Returns all licenses for the current vendor.

## Usage Instructions

### For Vendors (Machine Owners)

1. **Access Admin Panel**: Navigate to your PisoWiFi admin panel
2. **Go to NodeMCU Management**: Click on the "License Management" tab
3. **Generate Licenses**: Click "Generate Licenses" to create new license keys
4. **Assign Licenses**: 
   - Select a NodeMCU device from the dropdown
   - Enter the license key
   - Click "Activate"
5. **Start Trials**: For new devices, click "Start Trial" to begin the 7-day trial

### For Superadmins (System Administrators)

1. **Generate License Keys**: Use the license generation feature to create batches of licenses
2. **Assign to Vendors**: Distribute license keys to vendors
3. **Monitor Usage**: Track license usage and expiration dates

### License Key Format
- **Trial**: `TRIAL-{MAC_ADDRESS}-{RANDOM}`
- **Standard**: `NODEMCU-{8_CHARS}-{8_CHARS}`
- **Premium**: `NODEMCU-{8_CHARS}-{8_CHARS}`

## Implementation Details

### Frontend Components
- **NodeMCULicenseManager.tsx**: Main license management interface
- **NodeMCUManager.tsx**: Updated to include license management tab

### Backend Components
- **nodemcu-license.ts**: License manager class with all license operations
- **nodemcu_license_system.sql**: Database schema and functions

### Key Functions
- `verifyLicense()`: Check if a device has a valid license
- `startTrial()`: Start a 7-day trial for a device
- `activateLicense()`: Activate a license for a device
- `generateLicenses()`: Generate new license keys
- `revokeLicense()`: Remove license from a device

## Security Features

### Row Level Security (RLS)
- Vendors can only see and manage their own licenses
- Superadmins can manage all licenses
- License keys are unique and cannot be duplicated

### Access Control
- All license operations require admin authentication
- License generation requires superadmin privileges
- License activation is restricted to device owners

## Error Handling

### Common Error Messages
- **"Device not found or does not belong to you"**: Device doesn't exist or wrong vendor
- **"License key not found"**: Invalid license key
- **"License does not belong to you"**: License belongs to different vendor
- **"License already activated"**: License is already assigned to a device
- **"Device already has an active license"**: Device already has a valid license
- **"Device already had a trial period"**: Trial already used for this device

## Migration Instructions

### Step 1: Run Database Migration
```bash
# Apply the NodeMCU license system schema
psql -d your_supabase_db -f supabase/migrations/nodemcu_license_system.sql
```

### Step 2: Update Environment Variables
```bash
# Ensure Supabase credentials are configured
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
```

### Step 3: Restart Server
```bash
# Restart the PisoWiFi server to load new license system
npm restart
```

## Testing

### Manual Testing Checklist
- [ ] Generate license keys as superadmin
- [ ] Assign license to NodeMCU device
- [ ] Start trial for new device
- [ ] Verify license status
- [ ] Test license expiration
- [ ] Test license revocation
- [ ] Test trial restrictions (one per device)

### API Testing
```bash
# Test license status check
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:3000/api/nodemcu/license/status/AA:BB:CC:DD:EE:FF

# Test license activation
curl -X POST -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"licenseKey":"NODEMCU-XXXX-XXXX","macAddress":"AA:BB:CC:DD:EE:FF"}' \
  http://localhost:3000/api/nodemcu/license/activate
```

## Troubleshooting

### License System Not Configured
**Cause**: Missing Supabase credentials
**Solution**: Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` environment variables

### Cannot Generate Licenses
**Cause**: Not superadmin or authentication issues
**Solution**: Ensure you're logged in as superadmin (username: admin or superadmin)

### License Activation Fails
**Cause**: License already used or device has existing license
**Solution**: Revoke existing license first or use a different license key

### Trial Not Working
**Cause**: Device already had trial or has active license
**Solution**: Check device license status, use paid license if trial expired

## Future Enhancements

### Planned Features
- **Bulk License Operations**: Activate multiple licenses at once
- **License Transfer**: Move licenses between devices
- **License Analytics**: Detailed usage statistics
- **Auto-renewal**: Automatic license renewal system
- **Payment Integration**: Direct license purchase through system

### API Improvements
- **Webhooks**: License status change notifications
- **Batch Operations**: Process multiple licenses in single request
- **Advanced Filtering**: Filter licenses by status, type, expiration

---

**Implementation Date**: January 30, 2026  
**Version**: 1.0.0  
**Status**: ✅ Complete and Ready for Production