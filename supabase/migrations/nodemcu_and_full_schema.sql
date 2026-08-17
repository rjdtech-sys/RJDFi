-- ============================================
-- NODEMCU REPORTING & FULL SYSTEM SCHEMA
-- ============================================

-- 1. NODEMCU DEVICES TABLE
-- Tracks individual NodeMCU units connected to a vendor's machine
CREATE TABLE IF NOT EXISTS nodemcu_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  machine_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  mac_address TEXT NOT NULL,
  name TEXT,
  status TEXT DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', 'accepted', 'rejected')),
  total_pulses INTEGER DEFAULT 0,
  total_revenue DECIMAL(10, 2) DEFAULT 0.00,
  authentication_key TEXT,
  last_seen TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(machine_id, mac_address)
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_nodemcu_devices_machine_id ON nodemcu_devices(machine_id);
CREATE INDEX IF NOT EXISTS idx_nodemcu_devices_vendor_id ON nodemcu_devices(vendor_id);

-- 2. NODEMCU SALES/PULSES TABLE
-- Records every coin pulse from a specific NodeMCU device
CREATE TABLE IF NOT EXISTS nodemcu_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  machine_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES nodemcu_devices(id) ON DELETE CASCADE,
  slot_id INTEGER NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_nodemcu_sales_device_id ON nodemcu_sales(device_id);
CREATE INDEX IF NOT EXISTS idx_nodemcu_sales_created_at ON nodemcu_sales(created_at DESC);

-- 3. CLIENTS TABLE (Customer Sessions)
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token TEXT UNIQUE NOT NULL,
  mac_address TEXT NOT NULL,
  machine_id UUID REFERENCES vendors(id) ON DELETE CASCADE,
  vendor_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  remaining_seconds INTEGER DEFAULT 0,
  total_paid DECIMAL(10, 2) DEFAULT 0.00,
  ip_address TEXT,
  connected_at TIMESTAMPTZ DEFAULT now(),
  last_seen TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_clients_mac_address ON clients(mac_address);
CREATE INDEX IF NOT EXISTS idx_clients_machine_id ON clients(machine_id);

-- 4. PPPoE CONFIGURATION TABLE
CREATE TABLE IF NOT EXISTS pppoe_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  machine_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT false,
  server_ip TEXT NOT NULL,
  netmask TEXT NOT NULL,
  gateway_ip TEXT NOT NULL,
  dns_primary TEXT,
  dns_secondary TEXT,
  start_ip TEXT NOT NULL,
  end_ip TEXT NOT NULL,
  max_connections INTEGER DEFAULT 100,
  username TEXT,
  password TEXT,
  status TEXT DEFAULT 'stopped' CHECK (status IN ('running', 'stopped', 'error')),
  last_started TIMESTAMPTZ,
  last_stopped TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 5. PPPoE USERS TABLE
CREATE TABLE IF NOT EXISTS pppoe_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  machine_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  password TEXT NOT NULL,
  service_name TEXT,
  max_sessions INTEGER DEFAULT 1,
  rate_limit TEXT,
  is_active BOOLEAN DEFAULT true,
  suspended_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(username, machine_id)
);

-- 6. PPPoE ACTIVE SESSIONS TABLE
CREATE TABLE IF NOT EXISTS pppoe_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  machine_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  session_id TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  mac_address TEXT,
  connected_at TIMESTAMPTZ DEFAULT now(),
  duration_seconds INTEGER DEFAULT 0,
  data_sent_bytes BIGINT DEFAULT 0,
  data_received_bytes BIGINT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 7. HARDWARE CONFIGURATION TABLE
CREATE TABLE IF NOT EXISTS hardware_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  machine_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  coin_input_pin INTEGER,
  coin_output_pin INTEGER,
  led_status_pin INTEGER,
  relay_control_pin INTEGER,
  pulses_per_coin INTEGER DEFAULT 1,
  coin_detection_threshold INTEGER DEFAULT 500,
  debounce_time_ms INTEGER DEFAULT 100,
  last_hardware_check TIMESTAMPTZ,
  hardware_status TEXT DEFAULT 'unknown' CHECK (hardware_status IN ('working', 'error', 'maintenance', 'unknown')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 8. RATES TABLE
CREATE TABLE IF NOT EXISTS rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  machine_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  rate_name TEXT NOT NULL,
  coins_required INTEGER NOT NULL,
  time_seconds INTEGER NOT NULL,
  is_active BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 9. NETWORK SETTINGS TABLE
CREATE TABLE IF NOT EXISTS network_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  machine_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  interface_name TEXT NOT NULL,
  ip_address TEXT,
  netmask TEXT,
  gateway TEXT,
  dns_servers TEXT[],
  ssid TEXT,
  wifi_password TEXT,
  wifi_security TEXT DEFAULT 'wpa2' CHECK (wifi_security IN ('open', 'wep', 'wpa', 'wpa2', 'wpa3')),
  dhcp_enabled BOOLEAN DEFAULT true,
  dhcp_start_ip TEXT,
  dhcp_end_ip TEXT,
  dhcp_lease_time INTEGER DEFAULT 86400,
  bandwidth_limit_up INTEGER,
  bandwidth_limit_down INTEGER,
  qos_enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 10. SYSTEM SETTINGS TABLE
CREATE TABLE IF NOT EXISTS system_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  machine_id UUID REFERENCES vendors(id) ON DELETE CASCADE,
  setting_key TEXT NOT NULL,
  setting_value TEXT NOT NULL,
  setting_type TEXT DEFAULT 'string' CHECK (setting_type IN ('string', 'number', 'boolean', 'json')),
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(setting_key, vendor_id, machine_id)
);

-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================

-- Function to update NodeMCU device stats and machine revenue on new sale
CREATE OR REPLACE FUNCTION update_nodemcu_revenue()
RETURNS TRIGGER AS $$
BEGIN
    -- Update the NodeMCU device's total pulses and revenue
    UPDATE nodemcu_devices
    SET total_pulses = total_pulses + 1,
        total_revenue = total_revenue + NEW.amount,
        last_seen = now()
    WHERE id = NEW.device_id;
    
    -- Also update the main machine's (vendor) total revenue
    UPDATE vendors
    SET total_revenue = total_revenue + NEW.amount,
        coin_slot_pulses = coin_slot_pulses + 1,
        last_seen = now()
    WHERE id = (SELECT machine_id FROM nodemcu_devices WHERE id = NEW.device_id);
    
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to auto-update revenue on new NodeMCU sale
DROP TRIGGER IF EXISTS tr_update_nodemcu_revenue ON nodemcu_sales;
CREATE TRIGGER tr_update_nodemcu_revenue
AFTER INSERT ON nodemcu_sales
FOR EACH ROW EXECUTE FUNCTION update_nodemcu_revenue();

-- Enable RLS on all new tables
ALTER TABLE nodemcu_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE nodemcu_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE pppoe_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pppoe_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE pppoe_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE hardware_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE network_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

-- Basic RLS Policies (Allow vendors to see their own data)
-- Note: is_superadmin() and is_vendor() functions are assumed to exist or be created elsewhere

CREATE POLICY "Vendors can manage their own NodeMCU devices" ON nodemcu_devices
  FOR ALL USING (auth.uid() = vendor_id);

CREATE POLICY "Vendors can manage their own NodeMCU sales" ON nodemcu_sales
  FOR ALL USING (auth.uid() = vendor_id);

CREATE POLICY "Vendors can manage their own clients" ON clients
  FOR ALL USING (auth.uid() = vendor_id);

CREATE POLICY "Vendors can manage their own PPPoE configs" ON pppoe_configs
  FOR ALL USING (auth.uid() = vendor_id);

CREATE POLICY "Vendors can manage their own PPPoE users" ON pppoe_users
  FOR ALL USING (auth.uid() = vendor_id);

CREATE POLICY "Vendors can manage their own PPPoE sessions" ON pppoe_sessions
  FOR ALL USING (auth.uid() = vendor_id);

CREATE POLICY "Vendors can manage their own hardware configs" ON hardware_configs
  FOR ALL USING (auth.uid() = vendor_id);

CREATE POLICY "Vendors can manage their own rates" ON rates
  FOR ALL USING (auth.uid() = vendor_id);

CREATE POLICY "Vendors can manage their own network settings" ON network_settings
  FOR ALL USING (auth.uid() = vendor_id);

CREATE POLICY "Vendors can manage their own system settings" ON system_settings
  FOR ALL USING (auth.uid() = vendor_id);
