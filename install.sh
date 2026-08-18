#!/bin/bash

# ==============================================================================
# RJD PISOWIFI SYSTEM - AUTOMATED OS & BOARD INSTALLER v3.6.0
# Brand: RJD PisoWiFi Management System
# Hardware Support: Orange Pi (Armbian), Raspberry Pi, x86_64 PC (Ubuntu/Debian)
# ==============================================================================

set -e

# Color definitions
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

clear
echo -e "${CYAN}==============================================================================${NC}"
echo -e "${GREEN}                 🚀 RJD PISOWIFI SYSTEM INSTALLER v3.6.0                     ${NC}"
echo -e "${CYAN}==============================================================================${NC}"
echo -e "${YELLOW} Official Automated Setup Script for Orange Pi, Raspberry Pi & x86 Boards${NC}"
echo -e "${CYAN}==============================================================================${NC}"
echo ""

# Ensure script is run as root
if [ "$EUID" -ne 0 ]; then 
  echo -e "${RED}❌ Error: Please run this installer as root (use: sudo bash install.sh)${NC}"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="/opt/rjd-pisowifi"

# ------------------------------------------------------------------------------
# 1. Hardware Architecture Detection
# ------------------------------------------------------------------------------
echo -e "${GREEN}[1/8] 🔍 Detecting Hardware Architecture...${NC}"
ARCH=$(uname -m)
BOARD="unknown"

if grep -q "Raspberry Pi" /proc/device-tree/model 2>/dev/null; then
    BOARD="raspberry_pi"
    echo -e "${CYAN}► Detected Board: Raspberry Pi (${ARCH})${NC}"
elif [ -f /etc/armbian-release ] || grep -q "Orange Pi" /proc/cpuinfo 2>/dev/null; then
    BOARD="orange_pi"
    echo -e "${CYAN}► Detected Board: Orange Pi / Armbian (${ARCH})${NC}"
elif [[ "$ARCH" == "x86_64" ]]; then
    BOARD="x64_pc"
    echo -e "${CYAN}► Detected Board: x86_64 PC (Ubuntu/Debian Server)${NC}"
else
    echo -e "${YELLOW}► Generic hardware detected: ${ARCH}.${NC}"
fi

# ------------------------------------------------------------------------------
# 2. Package Manager Cleanup & Repositories Update
# ------------------------------------------------------------------------------
echo -e "${GREEN}[2/8] 🔄 Updating System Repositories...${NC}"
apt-get clean
rm -rf /var/lib/apt/lists/*
apt-get update -y

# ------------------------------------------------------------------------------
# 3. Installing Core System & Networking Dependencies
# ------------------------------------------------------------------------------
echo -e "${GREEN}[3/8] 📦 Installing Core Packages & Network Dependencies...${NC}"
apt-get install -y \
    bridge-utils \
    build-essential \
    conntrack \
    curl \
    dnsmasq \
    ffmpeg \
    git \
    hostapd \
    iproute2 \
    iptables \
    iputils-ping \
    iw \
    libcap2-bin \
    libffi-dev \
    libsqlite3-dev \
    libssl-dev \
    libudev-dev \
    net-tools \
    pkg-config \
    ppp \
    pppoe \
    psmisc \
    python3 \
    python3-dev \
    python3-venv \
    python-is-python3 \
    python3-pip \
    sqlite3 \
    vlan \
    xz-utils

# Hardware-specific packages
case $BOARD in
    "raspberry_pi")
        apt-get install -y raspberrypi-kernel-headers || echo "Skipping RPi headers..."
        ;;
    "x64_pc")
        apt-get install -y setserial
        usermod -a -G dialout root || true
        ;;
esac

# Install ESP Flashing Tool for sub-vendos
echo -e "${GREEN}► Installing ESP8266 Flashing Tools (esptool)...${NC}"
if apt-get install -y esptool 2>/dev/null; then
    echo -e "${CYAN}esptool installed via apt.${NC}"
elif apt-get install -y python3-esptool 2>/dev/null; then
    echo -e "${CYAN}python3-esptool installed via apt.${NC}"
else
    ESPTOOL_VENV="/opt/rjd-esptool-venv"
    python3 -m venv "$ESPTOOL_VENV"
    "$ESPTOOL_VENV/bin/python" -m pip install --no-input esptool
    ln -sf "$ESPTOOL_VENV/bin/esptool" /usr/local/bin/esptool
    echo -e "${CYAN}esptool installed in python venv (/usr/local/bin/esptool).${NC}"
fi

# ------------------------------------------------------------------------------
# 4. Installing Node.js & PM2 Process Manager
# ------------------------------------------------------------------------------
echo -e "${GREEN}[4/8] 🟢 Installing Node.js & PM2 Process Manager...${NC}"
DEB_ARCH=$(dpkg --print-architecture 2>/dev/null || echo "")

if ! command -v node &> /dev/null || [[ $(node -v | cut -d'.' -f1) < "v20" ]]; then
    if [[ "$DEB_ARCH" == "amd64" || "$DEB_ARCH" == "arm64" ]]; then
        echo -e "${CYAN}► Installing Node.js v22 (LTS) via NodeSource...${NC}"
        curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
        apt-get install -y nodejs
    elif [[ "$DEB_ARCH" == "armhf" || "$ARCH" == "armv7l" ]]; then
        echo -e "${CYAN}► Downloading official Node.js v20 (LTS) prebuilt binary for 32-bit ARM (${ARCH})...${NC}"
        curl -fsSL https://nodejs.org/dist/v20.18.3/node-v20.18.3-linux-armv7l.tar.xz -o /tmp/node-v20.tar.xz
        tar -xJf /tmp/node-v20.tar.xz -C /usr/local --strip-components=1
        rm -f /tmp/node-v20.tar.xz
    else
        apt-get install -y nodejs npm
    fi
else
    echo -e "${CYAN}Node.js $(node -v) is already installed.${NC}"
fi

npm config set fetch-retry-maxtimeout 120000
npm config set fetch-retry-mintimeout 20000
npm config set fetch-retries 5
npm config set timeout 120000

npm install -g node-gyp pm2

# ------------------------------------------------------------------------------
# 5. Deploying Project Directory
# ------------------------------------------------------------------------------
echo -e "${GREEN}[5/8] 📂 Deploying RJD PisoWiFi System Files...${NC}"
mkdir -p "$INSTALL_DIR"

if [ -f "$SCRIPT_DIR/server.js" ]; then
    echo -e "${CYAN}► Copying local installation payload from MicroSD...${NC}"
    cp -r "$SCRIPT_DIR"/* "$INSTALL_DIR"/ 2>/dev/null || true
else
    REPO_URL="${RJD_REPO_URL:-https://github.com/rjdtech-sys/RJDFi.git}"
    echo -e "${CYAN}► Cloning latest RJD PisoWiFi repository from ${REPO_URL}...${NC}"
    git clone "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

# Configure .env file if template exists and .env is missing
if [ ! -f "$INSTALL_DIR/.env" ]; then
    if [ -f "$SCRIPT_DIR/.env.template" ]; then
        cp "$SCRIPT_DIR/.env.template" "$INSTALL_DIR/.env"
    elif [ -f "$INSTALL_DIR/.env.example" ]; then
        cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
    fi
fi

# ------------------------------------------------------------------------------
# 6. Building Dependencies & Transpiling TypeScript UI
# ------------------------------------------------------------------------------
echo -e "${GREEN}[6/8] 🛠️ Building Application & Installing NPM Modules...${NC}"
rm -rf node_modules package-lock.json dist

npm config set fetch-retry-maxtimeout 120000
npm config set fetch-retry-mintimeout 20000
npm config set fetch-retries 5
npm config set timeout 120000

npm install --unsafe-perm --no-audit --no-fund
npm run build || echo "Frontend build finished."

# ------------------------------------------------------------------------------
# 7. Service Persistence & Systemd Autostart
# ------------------------------------------------------------------------------
echo -e "${GREEN}[7/8] 🔄 Registering PM2 System Auto-Start...${NC}"
pm2 delete rjd-pisowifi 2>/dev/null || true
pm2 start server.js --name "rjd-pisowifi"
pm2 save

PM2_STARTUP=$(pm2 startup systemd -u root --hp /root | grep "sudo env" || true)
if [ -n "$PM2_STARTUP" ]; then
    eval "$PM2_STARTUP"
fi
pm2 save

# Install WAN DHCP Recovery Service
if [ -f "$INSTALL_DIR/scripts/rjd-wan-dhcp-wait.sh" ]; then
    chmod +x "$INSTALL_DIR/scripts/rjd-wan-dhcp-wait.sh"
    if [ -f "$INSTALL_DIR/scripts/rjd-wan-dhcp-wait.service" ]; then
        cp "$INSTALL_DIR/scripts/rjd-wan-dhcp-wait.service" /etc/systemd/system/rjd-wan-dhcp-wait.service
        systemctl daemon-reload
        systemctl enable rjd-wan-dhcp-wait.service 2>/dev/null || true
    fi
fi

# ------------------------------------------------------------------------------
# 8. Network Capabilities & Permissions
# ------------------------------------------------------------------------------
echo -e "${GREEN}[8/8] 🔒 Configuring System Network Capabilities...${NC}"
setcap 'cap_net_bind_service,cap_net_admin,cap_net_raw+ep' $(eval readlink -f $(which node))

IP_ADDR=$(hostname -I | awk '{print $1}')

echo ""
echo -e "${CYAN}==============================================================================${NC}"
echo -e "${GREEN}           🎉 RJD PISOWIFI SYSTEM INSTALLATION SUCCESSFUL!                    ${NC}"
echo -e "${CYAN}==============================================================================${NC}"
echo -e "${YELLOW} Board Model:          ${BOARD} (${ARCH})${NC}"
echo -e "${YELLOW} Admin Dashboard:      http://${IP_ADDR}:8080/admin${NC} (or http://${IP_ADDR}/admin)"
echo -e "${YELLOW} Captive Portal:       http://${IP_ADDR}${NC}"
echo -e "${YELLOW} Status Logs Command:  pm2 logs rjd-pisowifi${NC}"
echo -e "${CYAN}==============================================================================${NC}"
echo -e "${GREEN} You may now configure licensing under Admin > System Settings.${NC}"
echo -e "${CYAN}==============================================================================${NC}"
