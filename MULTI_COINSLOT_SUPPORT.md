# Multi-Coin Slot Support for NodeMCU ESP8266/ESP32

## Overview

This feature adds support for multiple coin slots using NodeMCU ESP8266 or ESP32 microcontrollers. The system can now handle up to 4 separate coin acceptors, each configurable for different denominations (1, 5, or 10 pesos).

## Features

- **Multi-Slot Support**: Configure up to 4 independent coin slots
- **Flexible Denominations**: Each slot can be set to accept 1, 5, or 10 peso coins
- **Individual Slot Control**: Enable/disable specific slots as needed
- **ESP8266/ESP32 Integration**: Communicate via serial connection
- **Real-time Monitoring**: Track coin insertions per slot
- **Backward Compatibility**: Works with existing single-slot setups

## Hardware Requirements

### Microcontroller Options:
1. **NodeMCU ESP8266** (Recommended for cost-effective solution)
2. **ESP32 Development Board** (More GPIO pins, better performance)

### Coin Acceptors:
- Standard coin acceptors compatible with 5V logic levels
- Recommended: CH-926 series or similar multi-coin acceptors
- Each acceptor connects to a separate GPIO pin on the ESP board

### Wiring:
```
ESP8266/ESP32    Coin Acceptor    Description
--------------   --------------   --------------------
GPIO 4 (D2)   ->  Signal Pin     Slot 1 (1 peso)
GPIO 5 (D1)   ->  Signal Pin     Slot 2 (5 pesos)  
GPIO 12 (D6)  ->  Signal Pin     Slot 3 (10 pesos)
GPIO 13 (D7)  ->  Signal Pin     Slot 4 (custom)
GND           ->  GND            Common ground
5V/VIN        ->  VCC            Power supply
```

## Software Architecture

### Communication Protocol

The Orange Pi communicates with the ESP board via WiFi protocol:

#### Configuration Message (HTTP POST):
```
POST http://<espIpAddress>:<espPort>/config
Content-Type: application/json

{
  "slots": [
    {"id":1,"pin":4,"denomination":1,"enabled":true},
    {"id":2,"pin":5,"denomination":5,"enabled":true}
  ]
}
```

#### Coin Detection Messages (WebSocket):
```
{
  "type": "coin_detected",
  "slot_id": 1,
  "denomination": 1
}
```

Or via HTTP GET:
```
GET http://<espIpAddress>:<espPort>/coin?slot=1&denomination=1
```

### File Structure Modifications

#### Types (`types.ts`):
- Added `nodemcu_esp` to `BoardType` enum
- Added `CoinSlotConfig` interface for slot configuration
- Extended `SystemConfig` with `coinSlots`, `espIpAddress`, and `espPort`
- Enhanced `VendorMachine` with `coin_slots_data`

#### Frontend (`HardwareManager.tsx`):
- Added NodeMCU ESP board option
- Implemented multi-slot configuration UI
- Added WiFi IP address and port configuration
- Created slot-by-slot configuration panel

#### Backend (`server.js`):
- Extended config API to handle multi-slot data
- Updated initialization to restore multi-slot configuration
- Added WebSocket events for multi-slot monitoring

#### GPIO Library (`lib/gpio.js`):
- Added multi-slot WiFi communication support (placeholder implementation)
- Implemented `handleMultiSlotPulse()` function
- Added slot callback registration system
- Extended `updateGPIO()` with WiFi parameters

## Configuration

### Web Interface Setup:

1. Navigate to **Admin Panel** → **Hardware** section
2. Select **NodeMCU ESP** as board type
3. Configure **WiFi Connection** (IP address and port)
4. Configure each slot:
   - Toggle **Enable/Disable** switch
   - Select **GPIO Pin** (0, 4, 5, 12, 13, 14, 15, 16)
   - Set **Denomination** (1, 5, or 10 pesos)

### Example Configuration:
```json
[
  {
    "id": 1,
    "enabled": true,
    "pin": 4,
    "denomination": 1,
    "name": "1 Peso Slot"
  },
  {
    "id": 2, 
    "enabled": true,
    "pin": 5,
    "denomination": 5,
    "name": "5 Peso Slot"
  },
  {
    "id": 3,
    "enabled": false,
    "pin": 12, 
    "denomination": 10,
    "name": "10 Peso Slot"
  }
]
```

## Database Schema

### Local SQLite (Orange Pi):
New configuration keys in `config` table:
- `espIpAddress`: WiFi IP address of ESP board (e.g., '192.168.4.1')
- `espPort`: WiFi port of ESP board (e.g., '80')
- `coinSlots`: JSON array of slot configurations
- `serialPort`: (deprecated - kept for backward compatibility)

### Cloud Database (Supabase):
Extended `vendors` table includes:
- `coin_slots_data`: JSON array with per-slot statistics

## API Endpoints

### Get Configuration:
```http
GET /api/config
Response:
{
  "boardType": "nodemcu_esp",
  "coinPin": 2,
  "boardModel": null,
  "serialPort": "/dev/ttyUSB0", 
  "coinSlots": [
    {"id": 1, "enabled": true, "pin": 4, "denomination": 1},
    {"id": 2, "enabled": true, "pin": 5, "denomination": 5}
  ]
}
```

### Update Configuration:
```http
POST /api/config
Body:
{
  "boardType": "nodemcu_esp",
  "coinPin": 2,
  "serialPort": "/dev/ttyUSB0",
  "coinSlots": [
    {"id": 1, "enabled": true, "pin": 4, "denomination": 1},
    {"id": 2, "enabled": true, "pin": 5, "denomination": 5}
  ]
}
```

## WebSocket Events

### Multi-Slot Coin Detection:
```javascript
// Listen for multi-slot events
socket.on('multi-coin-pulse', (data) => {
  console.log(`Slot ${data.slot_id} inserted ${data.denomination} pesos`);
  // Update UI with slot-specific information
});
```

## ESP Firmware Development (Future)

The ESP firmware should implement:

1. **GPIO Interrupt Handling**: Detect coin pulses on configured pins
2. **Serial Communication**: Send `SLOT:id:denomination` messages
3. **Configuration Reception**: Parse `CONFIG:` messages to set up slots
4. **Debouncing**: Implement software debouncing for reliable detection
5. **Status Reporting**: Send periodic health/status updates

### Sample ESP Code Structure:
```cpp
// This will be implemented in a separate firmware project
void setup() {
  Serial.begin(115200);
  // Configure GPIO pins based on received config
  // Attach interrupts for coin detection
}

void loop() {
  // Handle serial communication
  // Process coin interrupts
  // Send SLOT messages
}
```

## Testing

### Simulation Mode:
1. Set board type to "No GPIO" 
2. Use the simulation interface to test multi-slot logic
3. Verify WebSocket events are emitted correctly

### Hardware Testing:
1. Flash ESP with firmware (to be developed)
2. Connect coin acceptors to configured GPIO pins
3. Insert coins and verify detection in admin panel
4. Check real-time slot-specific reporting

## Troubleshooting

### Common Issues:

1. **Serial Connection Failures**:
   - Check USB cable connection
   - Verify correct serial port selection
   - Ensure proper permissions on /dev/ttyUSB*

2. **Coin Detection Problems**:
   - Verify GPIO pin assignments match wiring
   - Check coin acceptor power and ground connections
   - Adjust debounce timing in ESP firmware

3. **Configuration Not Saving**:
   - Check browser console for JavaScript errors
   - Verify database write permissions
   - Restart the server after configuration changes

### Debug Commands:
```bash
# Check WiFi connection to ESP
ping 192.168.4.1

# Test HTTP API
curl http://192.168.4.1:80/coin?slot=1&denomination=5

# Send configuration via HTTP
curl -X POST http://192.168.4.1:80/config \
  -H "Content-Type: application/json" \
  -d '{"slots":[{"id":1,"pin":4,"denomination":1,"enabled":true}]}'
```

## Future Enhancements

1. **Per-Slot Analytics**: Detailed reporting on slot performance
2. **Dynamic Configuration**: Real-time slot reconfiguration without restart
3. **Error Handling**: Automatic recovery from communication failures
4. **Firmware OTA Updates**: Remote firmware updates for ESP boards
5. **Advanced Coin Acceptors**: Support for bill validators and card readers
6. **Load Balancing**: Intelligent distribution of load across slots

## Security Considerations

- Serial communication should include checksum/validation
- Firmware should authenticate with the main system
- Physical security for coin acceptors and ESP boards
- Regular monitoring for tampering attempts

---

*Last Updated: January 2026*