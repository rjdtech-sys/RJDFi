#!/bin/bash
# ==============================================================================
# RJD PISOWIFI SYSTEM - OS IMAGE REBRANDING & REPACK TOOL
# Re-configures Armbian SD Card Image with RJD PisoWiFi Branding & System Payload
# ==============================================================================

set -e

IMG_FILE="${1:-rjdfi_opi1_pc_v3.6.0-stable.img}"
MOUNT_DIR="/mnt/rjdfi_img"

if [ "$EUID" -ne 0 ]; then
  echo "❌ Error: Please run this tool as root (sudo bash rebrand-img.sh <image_file>)"
  exit 1
fi

if [ ! -f "$IMG_FILE" ]; then
  echo "❌ Error: Image file '$IMG_FILE' not found!"
  exit 1
fi

echo "🚀 Setting up loop device for $IMG_FILE..."
LOOP_DEV=$(losetup -fP --show "$IMG_FILE")
ROOT_PART="${LOOP_DEV}p1"

if [ ! -b "$ROOT_PART" ]; then
  ROOT_PART="${LOOP_DEV}p2"
fi

echo "📂 Mounting root partition $ROOT_PART to $MOUNT_DIR..."
mkdir -p "$MOUNT_DIR"
mount "$ROOT_PART" "$MOUNT_DIR"

echo "🎨 Applying RJD PisoWiFi Branding & Configuration..."

# Disable unused systemd-networkd-wait-online service to ensure clean boot logs
echo "🔧 Disabling unused systemd-networkd-wait-online.service..."
rm -f "$MOUNT_DIR/etc/systemd/system/network-online.target.wants/systemd-networkd-wait-online.service" 2>/dev/null || true

# 1. Update Hostname
echo "rjdfi-orangepi" > "$MOUNT_DIR/etc/hostname"
sed -i 's/127.0.1.1.*/127.0.1.1\trjdfi-orangepi/g' "$MOUNT_DIR/etc/hosts" 2>/dev/null || true

# 2. Update MOTD Welcome Banner
cat << 'EOF' > "$MOUNT_DIR/etc/motd"

  ██████╗  ██╗██████╗     ██████╗ ██╗███████╗██╗██╗  ██╗██╗
  ██╔══██╗ ██║██╔══██╗    ██╔══██╗██║██╔════╝██║██║  ██║██║
  ██████╔╝ ██║██║  ██║    ██████╔╝██║███████╗██║███████║██║
  ██╔══██╗██   ██║  ██║    ██╔═══╝ ██║╚════██║██║██╔══██║██║
  ██║  ██║╚█████╔╝██████╔╝    ██║     ██║███████║██║██║  ██║██║
  ╚═╝  ╚═╝ ╚════╝ ╚═════╝     ╚═╝     ╚═╝╚══════╝╚═╝╚═╝  ╚═╝╚═╝

  ================================================================
          🚀 RJD PISOWIFI SYSTEM v3.6.0 - OFFICIAL BOARD OS
  ================================================================
  Official Management Portal:  http://10.0.0.1:8080/admin
  Captive Portal Gateway:     http://10.0.0.1
  Status Logs Command:        pm2 logs rjd-pisowifi
  ================================================================

EOF

cp "$MOUNT_DIR/etc/motd" "$MOUNT_DIR/etc/issue" 2>/dev/null || true

# 3. Optional: Update Root Password for Security
NEW_ROOT_PASS="${2:-}"
if [ -n "$NEW_ROOT_PASS" ]; then
  echo "🔒 Updating root password in image /etc/shadow..."
  PASS_HASH=$(openssl passwd -6 "$NEW_ROOT_PASS" 2>/dev/null || openssl passwd -1 "$NEW_ROOT_PASS")
  sed -i "s|^root:[^:]*:|root:${PASS_HASH}:|" "$MOUNT_DIR/etc/shadow"
  echo "✅ Root password updated successfully."
fi

# 3. Inject / Update RJDFi Application
INSTALL_DIR="$MOUNT_DIR/opt/rjd-pisowifi"
mkdir -p "$INSTALL_DIR"

if [ -f "./server.js" ]; then
  echo "📦 Copying latest RJDFi system code into image..."
  cp -rf ./* "$INSTALL_DIR/" 2>/dev/null || true
fi

echo "🧹 Unmounting root partition..."
umount "$MOUNT_DIR"
losetup -d "$LOOP_DEV"

echo "⚡ Compressing image into gzip format..."
gzip -fk9 "$IMG_FILE"

echo ""
echo "=================================================================="
echo "  🎉 REBRANDING SUCCESSFUL!"
echo "  Output Raw Image:        $IMG_FILE"
echo "  Output Compressed GZ:   ${IMG_FILE}.gz"
echo "=================================================================="
