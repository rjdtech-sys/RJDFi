-- ============================================
-- FULL RJD PISOWIFI MANAGEMENT SYSTEM - SUPABASE SCHEMA
-- ============================================
-- Complete database schema for the PisoWiFi Management System
-- Including all tables, functions, policies, and views
-- ============================================

-- ============================================
-- 0. USER ROLES & PROFILES
-- ============================================
-- Track user roles (superadmin, vendor, client)
CREATE TABLE IF NOT EXISTS user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('superadmin', 'vendor', 'client')),
  created_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role);

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- Helper function to check if user is superadmin (allows SQL Editor direct execution when auth.uid() IS NULL)
CREATE OR REPLACE FUNCTION is_superadmin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN (auth.uid() IS NULL) OR EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid() AND role = 'superadmin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function to check if user is vendor
CREATE OR REPLACE FUNCTION is_vendor()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid() AND role = 'vendor'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP POLICY IF EXISTS "Users can view their own roles" ON user_roles;
CREATE POLICY "Users can view their own roles"
ON user_roles FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Superadmins can manage all roles" ON user_roles;
CREATE POLICY "Superadmins can manage all roles"
ON user_roles FOR ALL
USING (is_superadmin());

-- ============================================
-- 1. LICENSES TABLE (Superadmin manages)
-- ============================================
CREATE TABLE IF NOT EXISTS licenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_key TEXT UNIQUE NOT NULL,
  
  -- Ownership
  vendor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id),
  
  -- Activation
  hardware_id TEXT UNIQUE,
  is_active BOOLEAN DEFAULT false,
  activated_at TIMESTAMPTZ,
  
  -- Expiration (optional)
  expires_at TIMESTAMPTZ,
  
  -- Metadata
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_licenses_vendor_id ON licenses(vendor_id);
CREATE INDEX IF NOT EXISTS idx_licenses_hardware_id ON licenses(hardware_id);
CREATE INDEX IF NOT EXISTS idx_licenses_active ON licenses(is_active);

ALTER TABLE licenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Superadmins can manage all licenses" ON licenses;
CREATE POLICY "Superadmins can manage all licenses"
ON licenses FOR ALL
USING (is_superadmin());

DROP POLICY IF EXISTS "Vendors can view their own licenses" ON licenses;
CREATE POLICY "Vendors can view their own licenses"
ON licenses FOR SELECT
USING (vendor_id = auth.uid() OR is_superadmin());

DROP POLICY IF EXISTS "Vendors can activate their own licenses" ON licenses;
CREATE POLICY "Vendors can activate their own licenses"
ON licenses FOR UPDATE
USING (vendor_id = auth.uid() OR is_superadmin())
WITH CHECK (vendor_id = auth.uid() OR is_superadmin());

-- ============================================
-- 2. VENDORS (MACHINES) TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Machine Information
  hardware_id TEXT UNIQUE NOT NULL,
  machine_name TEXT NOT NULL,
  location TEXT,
  
  -- License Information
  license_key TEXT REFERENCES licenses(license_key),
  is_licensed BOOLEAN DEFAULT false,
  activated_at TIMESTAMPTZ,
  
  -- Machine Status
  status TEXT DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'maintenance')),
  last_seen TIMESTAMPTZ DEFAULT now(),
  
  -- Financial Tracking
  coin_slot_pulses INTEGER DEFAULT 0,
  total_revenue DECIMAL(10, 2) DEFAULT 0.00,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT unique_vendor_hardware UNIQUE(vendor_id, hardware_id)
);

CREATE INDEX IF NOT EXISTS idx_vendors_vendor_id ON vendors(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendors_hardware_id ON vendors(hardware_id);
CREATE INDEX IF NOT EXISTS idx_vendors_status ON vendors(status);

ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Superadmins can manage all machines" ON vendors;
CREATE POLICY "Superadmins can manage all machines"
ON vendors FOR ALL
USING (is_superadmin());

DROP POLICY IF EXISTS "Vendors can view their own machines" ON vendors;
CREATE POLICY "Vendors can view their own machines"
ON vendors FOR SELECT
USING (auth.uid() = vendor_id);

DROP POLICY IF EXISTS "Vendors can insert their own machines" ON vendors;
CREATE POLICY "Vendors can insert their own machines"
ON vendors FOR INSERT
WITH CHECK (auth.uid() = vendor_id);

DROP POLICY IF EXISTS "Vendors can update their own machines" ON vendors;
CREATE POLICY "Vendors can update their own machines"
ON vendors FOR UPDATE
USING (auth.uid() = vendor_id)
WITH CHECK (auth.uid() = vendor_id);

-- ============================================
-- 3. SALES LOGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS sales_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  machine_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  
  amount DECIMAL(10, 2) NOT NULL,
  currency TEXT DEFAULT 'PHP',
  session_duration INTEGER,
  data_used BIGINT,
  customer_mac TEXT,
  customer_ip TEXT,
  transaction_type TEXT DEFAULT 'coin_insert' CHECK (transaction_type IN ('coin_insert', 'voucher', 'refund')),
  created_at TIMESTAMPTZ DEFAULT now(),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_sales_logs_vendor_id ON sales_logs(vendor_id);
CREATE INDEX IF NOT EXISTS idx_sales_logs_machine_id ON sales_logs(machine_id);
CREATE INDEX IF NOT EXISTS idx_sales_logs_created_at ON sales_logs(created_at DESC);

ALTER TABLE sales_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Superadmins can manage all sales" ON sales_logs;
CREATE POLICY "Superadmins can manage all sales"
ON sales_logs FOR ALL
USING (is_superadmin());

DROP POLICY IF EXISTS "Vendors can view their own sales" ON sales_logs;
CREATE POLICY "Vendors can view their own sales"
ON sales_logs FOR SELECT
USING (auth.uid() = vendor_id);

DROP POLICY IF EXISTS "Vendors can insert their own sales" ON sales_logs;
CREATE POLICY "Vendors can insert their own sales"
ON sales_logs FOR INSERT
WITH CHECK (auth.uid() = vendor_id);

-- ============================================
-- 4. CLIENTS TABLE (Customer Sessions)
-- ============================================
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

CREATE INDEX IF NOT EXISTS idx_clients_session_token ON clients(session_token);
CREATE INDEX IF NOT EXISTS idx_clients_mac_address ON clients(mac_address);
CREATE INDEX IF NOT EXISTS idx_clients_machine_id ON clients(machine_id);
CREATE INDEX IF NOT EXISTS idx_clients_active ON clients(is_active);

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Superadmins can manage all clients" ON clients;
CREATE POLICY "Superadmins can manage all clients"
ON clients FOR ALL
USING (is_superadmin());

DROP POLICY IF EXISTS "Vendors can view clients on their machines" ON clients;
CREATE POLICY "Vendors can view clients on their machines"
ON clients FOR SELECT
USING (auth.uid() = vendor_id);

DROP POLICY IF EXISTS "Public can create client sessions" ON clients;
CREATE POLICY "Public can create client sessions"
ON clients FOR INSERT
WITH CHECK (true);

DROP POLICY IF EXISTS "Public can update client sessions" ON clients;
CREATE POLICY "Public can update client sessions"
ON clients FOR UPDATE
USING (true)
WITH CHECK (true);

-- ============================================
-- 5. PPPoE CONFIGS, USERS & SESSIONS
-- ============================================
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

ALTER TABLE pppoe_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Superadmins can manage all PPPoE configs" ON pppoe_configs;
CREATE POLICY "Superadmins can manage all PPPoE configs"
ON pppoe_configs FOR ALL
USING (is_superadmin());

DROP POLICY IF EXISTS "Vendors can manage their own PPPoE configs" ON pppoe_configs;
CREATE POLICY "Vendors can manage their own PPPoE configs"
ON pppoe_configs FOR ALL
USING (auth.uid() = vendor_id);

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

ALTER TABLE pppoe_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Superadmins can manage all PPPoE users" ON pppoe_users;
CREATE POLICY "Superadmins can manage all PPPoE users"
ON pppoe_users FOR ALL
USING (is_superadmin());

DROP POLICY IF EXISTS "Vendors can manage their own PPPoE users" ON pppoe_users;
CREATE POLICY "Vendors can manage their own PPPoE users"
ON pppoe_users FOR ALL
USING (auth.uid() = vendor_id);

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

ALTER TABLE pppoe_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Superadmins can manage all PPPoE sessions" ON pppoe_sessions;
CREATE POLICY "Superadmins can manage all PPPoE sessions"
ON pppoe_sessions FOR ALL
USING (is_superadmin());

DROP POLICY IF EXISTS "Vendors can view their own PPPoE sessions" ON pppoe_sessions;
CREATE POLICY "Vendors can view their own PPPoE sessions"
ON pppoe_sessions FOR SELECT
USING (auth.uid() = vendor_id);

-- ============================================
-- 6. HARDWARE CONFIGS, RATES, NETWORK & SYSTEM SETTINGS
-- ============================================
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

ALTER TABLE hardware_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Superadmins can manage all hardware configs" ON hardware_configs;
CREATE POLICY "Superadmins can manage all hardware configs"
ON hardware_configs FOR ALL
USING (is_superadmin());

DROP POLICY IF EXISTS "Vendors can manage their own hardware configs" ON hardware_configs;
CREATE POLICY "Vendors can manage their own hardware configs"
ON hardware_configs FOR ALL
USING (auth.uid() = vendor_id);

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

ALTER TABLE rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Superadmins can manage all rates" ON rates;
CREATE POLICY "Superadmins can manage all rates"
ON rates FOR ALL
USING (is_superadmin());

DROP POLICY IF EXISTS "Vendors can manage their own rates" ON rates;
CREATE POLICY "Vendors can manage their own rates"
ON rates FOR ALL
USING (auth.uid() = vendor_id);

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

ALTER TABLE network_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Superadmins can manage all network settings" ON network_settings;
CREATE POLICY "Superadmins can manage all network settings"
ON network_settings FOR ALL
USING (is_superadmin());

DROP POLICY IF EXISTS "Vendors can manage their own network settings" ON network_settings;
CREATE POLICY "Vendors can manage their own network settings"
ON network_settings FOR ALL
USING (auth.uid() = vendor_id);

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

ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Superadmins can manage all system settings" ON system_settings;
CREATE POLICY "Superadmins can manage all system settings"
ON system_settings FOR ALL
USING (is_superadmin());

DROP POLICY IF EXISTS "Vendors can manage their own system settings" ON system_settings;
CREATE POLICY "Vendors can manage their own system settings"
ON system_settings FOR ALL
USING (auth.uid() = vendor_id);

-- ============================================
-- 7. FUNCTIONS & TRIGGERS
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_vendors_updated_at ON vendors;
CREATE TRIGGER update_vendors_updated_at 
BEFORE UPDATE ON vendors
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION update_vendor_revenue()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE vendors
    SET total_revenue = total_revenue + NEW.amount
    WHERE id = NEW.machine_id;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_revenue_on_sale ON sales_logs;
CREATE TRIGGER update_revenue_on_sale 
AFTER INSERT ON sales_logs
FOR EACH ROW EXECUTE FUNCTION update_vendor_revenue();

-- ============================================
-- 8. SUPERADMIN HELPER FUNCTIONS
-- ============================================
CREATE OR REPLACE FUNCTION generate_license_keys(
  batch_size INTEGER DEFAULT 1,
  assigned_vendor_id UUID DEFAULT NULL,
  expiration_months INTEGER DEFAULT NULL
)
RETURNS TABLE (
  license_key TEXT,
  expires_at TIMESTAMPTZ
) AS $$
DECLARE
  i INTEGER;
  new_key TEXT;
  exp_date TIMESTAMPTZ;
  creator_id UUID;
BEGIN
  IF NOT is_superadmin() THEN
    RAISE EXCEPTION 'Only superadmins can generate license keys';
  END IF;

  creator_id := auth.uid();

  FOR i IN 1..batch_size LOOP
    new_key := 'RJD-' || 
               substring(md5(random()::text || clock_timestamp()::text) from 1 for 8) || '-' ||
               substring(md5(random()::text || clock_timestamp()::text) from 1 for 8);
    
    IF expiration_months IS NOT NULL THEN
      exp_date := now() + (expiration_months || ' months')::interval;
    ELSE
      exp_date := NULL;
    END IF;
    
    INSERT INTO licenses (license_key, vendor_id, created_by, expires_at)
    VALUES (new_key, assigned_vendor_id, creator_id, exp_date);
    
    license_key := new_key;
    expires_at := exp_date;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_global_stats()
RETURNS JSON AS $$
DECLARE
  stats JSON;
BEGIN
  IF NOT is_superadmin() THEN
    RAISE EXCEPTION 'Only superadmins can view global stats';
  END IF;

  SELECT json_build_object(
    'total_vendors', (SELECT COUNT(DISTINCT vendor_id) FROM vendors),
    'total_machines', (SELECT COUNT(*) FROM vendors),
    'active_machines', (SELECT COUNT(*) FROM vendors WHERE status = 'online'),
    'total_licenses', (SELECT COUNT(*) FROM licenses),
    'active_licenses', (SELECT COUNT(*) FROM licenses WHERE is_active = true),
    'available_licenses', (SELECT COUNT(*) FROM licenses WHERE hardware_id IS NULL),
    'total_revenue', (SELECT COALESCE(SUM(total_revenue), 0) FROM vendors),
    'revenue_today', (SELECT COALESCE(SUM(amount), 0) FROM sales_logs WHERE created_at >= CURRENT_DATE),
    'revenue_this_month', (SELECT COALESCE(SUM(amount), 0) FROM sales_logs WHERE created_at >= date_trunc('month', CURRENT_DATE)),
    'total_transactions', (SELECT COUNT(*) FROM sales_logs),
    'active_clients', (SELECT COUNT(*) FROM clients WHERE is_active = true)
  ) INTO stats;

  RETURN stats;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 9. VIEWS FOR ANALYTICS
-- ============================================
CREATE OR REPLACE VIEW vendor_dashboard_summary AS
SELECT 
    v.vendor_id,
    COUNT(DISTINCT v.id) as total_machines,
    COUNT(DISTINCT CASE WHEN v.status = 'online' THEN v.id END) as online_machines,
    SUM(v.total_revenue) as total_revenue,
    COUNT(sl.id) as total_transactions,
    SUM(CASE WHEN sl.created_at >= now() - interval '24 hours' THEN sl.amount ELSE 0 END) as revenue_24h,
    SUM(CASE WHEN sl.created_at >= now() - interval '7 days' THEN sl.amount ELSE 0 END) as revenue_7d,
    SUM(CASE WHEN sl.created_at >= now() - interval '30 days' THEN sl.amount ELSE 0 END) as revenue_30d
FROM vendors v
LEFT JOIN sales_logs sl ON sl.machine_id = v.id
GROUP BY v.vendor_id;

ALTER VIEW vendor_dashboard_summary SET (security_invoker = on);

CREATE OR REPLACE VIEW superadmin_global_dashboard AS
SELECT 
    v.vendor_id,
    u.email as vendor_email,
    COUNT(DISTINCT v.id) as machines,
    COUNT(DISTINCT CASE WHEN v.status = 'online' THEN v.id END) as online_machines,
    SUM(v.total_revenue) as total_revenue,
    COUNT(sl.id) as total_transactions,
    SUM(CASE WHEN sl.created_at >= now() - interval '24 hours' THEN sl.amount ELSE 0 END) as revenue_24h,
    SUM(CASE WHEN sl.created_at >= now() - interval '30 days' THEN sl.amount ELSE 0 END) as revenue_30d,
    COUNT(DISTINCT l.id) as total_licenses,
    COUNT(DISTINCT CASE WHEN l.is_active = true THEN l.id END) as active_licenses
FROM auth.users u
LEFT JOIN vendors v ON v.vendor_id = u.id
LEFT JOIN sales_logs sl ON sl.vendor_id = u.id
LEFT JOIN licenses l ON l.vendor_id = u.id
WHERE EXISTS (SELECT 1 FROM user_roles WHERE user_id = u.id AND role = 'vendor')
GROUP BY v.vendor_id, u.email;

ALTER VIEW superadmin_global_dashboard SET (security_invoker = on);
