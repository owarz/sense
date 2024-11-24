<<<<<<< HEAD
# Sense Local Server & HomeKit Integration

This project provides a local server replacement for the Sense sleep tracking device, enabling continued functionality through HomeKit integration via Homebridge.

## Components

- **Local Server**: An Express.js server that mimics the original Sense API
- **Homebridge Plugin**: Modified version of homebridge-sense to work with the local server
- **DNS Redirect**: Redirects device API requests to the local server

## Prerequisites

- Node.js v16 or later
- Homebridge
- Sense sleep tracking device
- DNS server (to redirect API requests)

## Installation

1. Clone this repository
2. Install dependencies:
```bash
npm install
```

3. Install the Homebridge plugin:
```bash
npm install -g homebridge-sense-local
```

4. Configure your DNS server to redirect Sense API requests to the local server:
   - hello-sense.com -> localhost:3000
   - api.hello.is -> localhost:3000

## Configuration

Add this to your Homebridge configuration:

```json
{
    "platforms": [
        {
            "platform": "SenseLocal",
            "name": "Sense Sleep",
            "server_address": "http://localhost:3000"
        }
    ]
}
```

## Usage

1. Start the local server:
```bash
npm run server
```

2. Ensure Homebridge is running with the plugin installed
3. The Sense device should automatically connect to the local server

## API Endpoints

- `POST /v2/devices/sense/register`: Device registration
- `POST /v2/devices/sense/:device_id/data`: Sensor data submission
- `GET /v2/devices/sense/:device_id/sensors`: Get latest sensor data
- `GET /v2/devices/sense/:device_id`: Get device information
- `GET /v2/devices`: List all registered devices

## Development

- `src/server`: Local API server implementation
- `homebridge`: Homebridge plugin

## License

MIT
=======
# sense
hello sense sleep tracker local api server and homebridge plugin.
>>>>>>> 8ce97691befd877982c7e4812c68eb60a6bbb702
