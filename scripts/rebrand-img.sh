#!/bin/bash
# ==============================================================================
# RJD PISOWIFI SYSTEM - OS IMAGE REBRANDING & REPACK TOOL
# Re-configures Armbian SD Card Image with RJD PisoWiFi Branding & System Payload
# ==============================================================================

set -e

ARG1="$1"
ARG2="$2"

NEW_ROOT_PASS=""
RAW_IMG=""

if [ -n "$ARG1" ]; then
  if [[ "$ARG1" == *.img ]]; then
    RAW_IMG="$ARG1"
    NEW_ROOT_PASS="$ARG2"
  else
    NEW_ROOT_PASS="$ARG1"
    RAW_IMG="$ARG2"
  fi
fi

if [ -z "$RAW_IMG" ] || [ ! -f "$RAW_IMG" ]; then
  if [ -f "Image/rjdfi_opi1_pc_v3.6.0-stable.img" ]; then
    RAW_IMG="Image/rjdfi_opi1_pc_v3.6.0-stable.img"
  elif [ -f "Image" ]; then
    RAW_IMG="Image"
  else
    RAW_IMG=$(find . -maxdepth 2 -name "*.img" 2>/dev/null | head -n 1)
  fi
fi

if [ -z "$RAW_IMG" ] || [ ! -f "$RAW_IMG" ]; then
  echo "❌ Error: Could not find any .img file in /opt/rjd-pisowifi/ or /opt/rjd-pisowifi/Image/"
  echo "👉 Please re-upload your .img file from Windows to Orange Pi using:"
  echo "   scp \"F:\\My Piso Wifi System\\RJDFi\\Image\\rjdfi_opi1_pc_v3.6.0-stable.img\" root@192.168.1.47:/opt/rjd-pisowifi/Image/"
  exit 1
fi

IMG_FILE=$(realpath "$RAW_IMG")
MOUNT_DIR="/mnt/rjdfi_img"

if [ "$EUID" -ne 0 ]; then
  echo "❌ Error: Please run this tool as root (sudo bash rebrand-img.sh <image_file>)"
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

echo "🧹 Freeing disk space inside image rootfs..."
rm -rf "$MOUNT_DIR/opt/rjd-pisowifi/Image" "$MOUNT_DIR/opt/ajc-pisowifi/Image" 2>/dev/null || true
rm -rf "$MOUNT_DIR/var/cache/apt/archives/"* "$MOUNT_DIR/var/log/"* "$MOUNT_DIR/tmp/"* "$MOUNT_DIR/var/tmp/"* 2>/dev/null || true
find "$MOUNT_DIR/opt" "$MOUNT_DIR/root" "$MOUNT_DIR/home" -name "*.img" -delete 2>/dev/null || true
find "$MOUNT_DIR/opt" "$MOUNT_DIR/root" "$MOUNT_DIR/home" -name "*.img.gz" -delete 2>/dev/null || true

echo "🎨 Applying RJD PisoWiFi Branding & Configuration..."

# Permanently mask unused network-wait-online services by linking to /dev/null
echo "🔧 Masking unused systemd-networkd-wait-online.service..."
rm -f "$MOUNT_DIR/etc/systemd/system/network-online.target.wants/systemd-networkd-wait-online.service" 2>/dev/null || true
ln -sf /dev/null "$MOUNT_DIR/etc/systemd/system/systemd-networkd-wait-online.service" 2>/dev/null || true
ln -sf /dev/null "$MOUNT_DIR/etc/systemd/system/NetworkManager-wait-online.service" 2>/dev/null || true

# 1. Update Hostname & Version
CURRENT_VER=$(node -p "require('./package.json').version" 2>/dev/null || echo "3.14.44")
echo "rjdfi-orangepi" > "$MOUNT_DIR/etc/hostname"
python3 -c "import re; f='$MOUNT_DIR/etc/hosts'; data=open(f).read(); open(f,'w').write(re.sub(r'127\.0\.1\.1.*', '127.0.1.1\trjdfi-orangepi', data))" 2>/dev/null || \
perl -pi -e 's/127.0.1.1.*/127.0.1.1\trjdfi-orangepi/g' "$MOUNT_DIR/etc/hosts" 2>/dev/null || true

# 2. Update MOTD Welcome Banner
cat << EOF > "$MOUNT_DIR/etc/motd"

  ██████╗  ██╗██████╗     ██████╗ ██╗███████╗██╗██╗  ██╗██╗
  ██╔══██╗ ██║██╔══██╗    ██╔══██╗██║██╔════╝██║██║  ██║██║
  ██████╔╝ ██║██║  ██║    ██████╔╝██║███████╗██║███████║██║
  ██╔══██╗██   ██║  ██║    ██╔═══╝ ██║╚════██║██║██╔══██║██║
  ██║  ██║╚█████╔╝██████╔╝    ██║     ██║███████║██║██║  ██║██║
  ╚═╝  ╚═╝ ╚════╝ ╚═════╝     ╚═╝     ╚═╝╚══════╝╚═╝╚═╝  ╚═╝╚═╝

  ================================================================
          🚀 RJD PISOWIFI SYSTEM v${CURRENT_VER} - OFFICIAL BOARD OS
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
  python3 -c "import re; f='$MOUNT_DIR/etc/shadow'; data=open(f).read(); open(f,'w').write(re.sub(r'^root:[^:]*:', 'root:${PASS_HASH}:', data, count=1, flags=re.M))" 2>/dev/null || \
  perl -pi -e "s|^root:[^:]*:|root:${PASS_HASH}:|" "$MOUNT_DIR/etc/shadow" 2>/dev/null || true
  echo "✅ Root password updated successfully."
fi

# 4. Inject / Update RJDFi Application (Include compiled dist, JS modules, and metadata)
INSTALL_DIR="$MOUNT_DIR/opt/rjd-pisowifi"
mkdir -p "$INSTALL_DIR"

if [ -f "./server.js" ]; then
  echo "📦 Injecting latest RJDFi v${CURRENT_VER} system code & compiled assets into image..."
  rm -rf "$INSTALL_DIR/Image" "$INSTALL_DIR/orangepi-one_patch_v3.img.gz" 2>/dev/null || true

  # Build production frontend bundle if dist doesn't exist
  if [ ! -d "./dist" ]; then
    echo "⚡ Building production frontend bundle..."
    npm run build 2>/dev/null || true
  fi

  # Copy application files and production build
  cp -f ./server.js "$INSTALL_DIR/server.js" 2>/dev/null || true
  cp -f ./package.json "$INSTALL_DIR/package.json" 2>/dev/null || true
  cp -f ./metadata.json "$INSTALL_DIR/metadata.json" 2>/dev/null || true
  cp -f ./update_release.json "$INSTALL_DIR/update_release.json" 2>/dev/null || true
  cp -f ./install.sh "$INSTALL_DIR/install.sh" 2>/dev/null || true
  cp -f ./index.html "$INSTALL_DIR/index.html" 2>/dev/null || true
  cp -f ./App.tsx "$INSTALL_DIR/App.tsx" 2>/dev/null || true
  cp -f ./types.ts "$INSTALL_DIR/types.ts" 2>/dev/null || true
  cp -f ./index.tsx "$INSTALL_DIR/index.tsx" 2>/dev/null || true

  for folder in dist lib public components scripts data; do
    if [ -d "./$folder" ]; then
      cp -rf "./$folder" "$INSTALL_DIR/" 2>/dev/null || true
    fi
  done

  # Convert CRLF line endings to LF for Linux compatibility
  find "$INSTALL_DIR" -name "*.sh" -exec sed -i 's/\r$//' {} + 2>/dev/null || true
  find "$INSTALL_DIR/scripts" -type f -exec sed -i 's/\r$//' {} + 2>/dev/null || true
  sed -i 's/\r$//' "$INSTALL_DIR/install.sh" 2>/dev/null || true
fi

# 5. Clean & Rebrand PM2 Process & Legacy Paths
echo "🔄 Rebranding PM2 process dump and flushing stale logs..."
rm -rf "$MOUNT_DIR/opt/ajc-pisowifi" 2>/dev/null || true
ln -sf /opt/rjd-pisowifi "$MOUNT_DIR/opt/ajc-pisowifi" 2>/dev/null || true

# Flush stale PM2 logs inside image
rm -rf "$MOUNT_DIR/root/.pm2/logs/"* 2>/dev/null || true
rm -rf "$MOUNT_DIR/home"/*/.pm2/logs/* 2>/dev/null || true

for pm2dump in "$MOUNT_DIR/root/.pm2/dump.pm2" "$MOUNT_DIR/home"/*/.pm2/dump.pm2; do
  if [ -f "$pm2dump" ]; then
    sed -i 's/ajc-pisowifi/rjd-pisowifi/g' "$pm2dump" 2>/dev/null || true
    sed -i 's|/opt/ajc-pisowifi|/opt/rjd-pisowifi|g' "$pm2dump" 2>/dev/null || true
  fi
done

echo "🧹 Syncing disk buffers & unmounting root partition..."
sync
umount "$MOUNT_DIR" 2>/dev/null || (sleep 2 && umount -f "$MOUNT_DIR" 2>/dev/null) || true
losetup -d "$LOOP_DEV" 2>/dev/null || true
sync
sleep 2

if [ -f "$IMG_FILE" ]; then
  echo "⚡ Compressing image into gzip format (${IMG_FILE}.gz)..."
  gzip -c9 "$IMG_FILE" > "${IMG_FILE}.gz"
fi

echo ""
echo "=================================================================="
echo "  🎉 REBRANDING SUCCESSFUL!"
echo "  Output Raw Image:        $IMG_FILE"
echo "  Output Compressed GZ:   ${IMG_FILE}.gz"
echo "=================================================================="
