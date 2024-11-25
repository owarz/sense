homebridge-sense-local
This Homebridge plugin integrates the Sense sleep tracking device with HomeKit by communicating with a local Sense API server.

Installation
Install Homebridge (if you haven't already)
Install this plugin:
npm install 
Configuration
Add the following configuration to Homebridge's config.json file:

{
    "platforms": [
        {
            "name": "Sense Device",
            "email": "demo@example.com",
            "password": "demo123",
            "updateInterval": 10,
            "platform": "SenseLocal"
        }
    ]
}


Features
This plugin adds the following sensors to HomeKit:

Temperature Sensor
Humidity Sensor
Air Quality Sensor
Light Sensor
Sound Sensor
Each sensor is updated every minute.

Requirements
Homebridge v1.3.0 or later
Node.js v14 or later
A working local Sense API server