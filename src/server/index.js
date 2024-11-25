const express = require('express');
const bodyParser = require('body-parser');
const winston = require('winston');
const storage = require('node-persist');
const moment = require('moment');
const axios = require('axios');
const getRawBody = require('raw-body');
const protobuf = require('protobufjs');
const crypto = require('crypto');

// Configure logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' }),
        new winston.transports.Console({
            format: winston.format.simple()
        })
    ]
});

const app = express();
const port = 80;

// API routes
const sensorsRouter = require('./routes/v2/sensors');
const devicesRouter = require('./routes/v2/devices');

app.use('/v2/sensors', sensorsRouter);
app.use('/v2/devices', devicesRouter);

// Sense API configuration
const SENSE_API_URL = 'https://api.hello.is';
let senseAuthToken = null;

// Trust proxy
app.set('trust proxy', true);

// Initialize storage
storage.init({
    dir: 'storage',
    stringify: JSON.stringify,
    parse: JSON.parse,
    encoding: 'utf8',
    logging: false
}).catch(err => {
    logger.error('Storage initialization failed:', err);
});

// Load protobuf schema
let SenseMessage;
protobuf.load("src/server/sense.proto")
    .then(root => {
        SenseMessage = root.lookupType("hello.SenseMessage");
        console.log("Protobuf schema loaded successfully");
    })
    .catch(err => {
        console.error("Failed to load protobuf schema:", err);
    });

// Middleware for protobuf
app.use(async (req, res, next) => {
    if (req.headers['content-type'] === 'application/x-protobuf') {
        try {
            const raw = await getRawBody(req);
            req.rawBody = raw;
            
            // Try to decode with protobuf if schema is loaded
            if (SenseMessage) {
                try {
                    const message = SenseMessage.decode(raw);
                    req.protobufMessage = message;
                } catch (decodeError) {
                    console.error('Failed to decode protobuf message:', decodeError);
                }
            }
            
            next();
        } catch (error) {
            next(error);
        }
    } else {
        next();
    }
});

// Regular middleware for JSON
app.use(bodyParser.json());

app.use((req, res, next) => {
    console.log(`${req.method} ${req.path} from ${req.ip} at ${new Date().toISOString()}`);
    next();
});

// Authenticate with Sense API
async function authenticateSense(email, password) {
    try {
        const response = await axios.post(`${SENSE_API_URL}/v1/login`, {
            email,
            password
        });
        senseAuthToken = response.data.token;
        return senseAuthToken;
    } catch (error) {
        logger.error('Authentication failed:', error.message);
        throw error;
    }
}

// Get Sense API data
async function getSenseData(endpoint) {
    try {
        console.log(`\n[${new Date().toISOString()}] Getting data for endpoint: ${endpoint}`);
        
        const latestData = await storage.getItem('latest_sensor_data');
        if (!latestData) {
            throw new Error('No sensor data available');
        }
        return latestData.data;
    } catch (error) {
        console.error('Error getting sensor data:', error.message);
        throw error;
    }
}

// Login endpoint
app.post('/v1/login', async (req, res) => {
    const { email, password } = req.body;
    // Generate a mock token using timestamp to make it unique
    const mockToken = `mock_token_${Date.now()}`;
    senseAuthToken = mockToken;
    logger.info(`Login successful for ${email}`);
    res.json({ token: mockToken });
});

// Current room data endpoint
app.get('/v1/room/current', async (req, res) => {
    try {
        const data = await getSenseData('/v1/room/current');
        await storage.setItem('latest_room_data', data);
        res.json(data);
    } catch (error) {
        // Try to return cached data if available
        const cachedData = await storage.getItem('latest_room_data');
        if (cachedData) {
            res.json(cachedData);
        } else {
            res.status(500).json({ error: 'Failed to get room data' });
        }
    }
});

// Device list endpoint
app.get('/v2/account/devices', async (req, res) => {
    try {
        const data = await getSenseData('/v2/account/devices');
        await storage.setItem('devices', data);
        res.json(data);
    } catch (error) {
        const cachedData = await storage.getItem('devices');
        if (cachedData) {
            res.json(cachedData);
        } else {
            res.status(500).json({ error: 'Failed to get devices' });
        }
    }
});

// Room timeline endpoint
app.get('/v1/room/timeline', async (req, res) => {
    try {
        const data = await getSenseData('/v1/room/timeline');
        await storage.setItem('room_timeline', data);
        res.json(data);
    } catch (error) {
        const cachedData = await storage.getItem('room_timeline');
        if (cachedData) {
            res.json(cachedData);
        } else {
            res.status(500).json({ error: 'Failed to get timeline' });
        }
    }
});

// Sensor data endpoint
app.get('/v2/sensors', async (req, res) => {
    try {
        const latestData = await storage.getItem('latest_sensor_data');
        if (!latestData) {
            console.log('No sensor data available');
            res.status(404).json({ error: 'No sensor data available' });
            return;
        }
        console.log('Returning sensor data:', latestData);
        res.json(latestData.data);
    } catch (error) {
        console.error('Error retrieving sensor data:', error);
        res.status(500).json({ error: 'Failed to get sensor data' });
    }
});

// Time endpoint
app.get('/time', (req, res) => {
    const now = new Date();
    res.json({
        timestamp: now.getTime(),
        iso: now.toISOString(),
        formatted: now.toLocaleString()
    });
});

// Utility functions
function chunk(buffer, size) {
    const chunks = [];
    for (let i = 0; i < buffer.length; i += size) {
        if (i + size <= buffer.length) {
            chunks.push(buffer.slice(i, i + size));
        }
    }
    return chunks;
}

// Store previous payload for comparison
let previousPayload = null;

// Store sensor data with timestamp
async function storeSensorData(sensorData) {
    try {
        // Store latest data
        await storage.setItem('latest_sensor_data', sensorData);

        // Store historical data
        const timestamp = moment().format();
        const history = await storage.getItem('sensor_history') || {};

        // Initialize history for each sensor if not exists
        Object.keys(sensorData).forEach(sensor => {
            if (!history[sensor]) {
                history[sensor] = {};
            }
            history[sensor][timestamp] = sensorData[sensor];
        });

        // Keep only last 7 days of data
        const cutoff = moment().subtract(7, 'days');
        Object.keys(history).forEach(sensor => {
            history[sensor] = Object.fromEntries(
                Object.entries(history[sensor]).filter(([time]) => 
                    moment(time).isAfter(cutoff)
                )
            );
        });

        await storage.setItem('sensor_history', history);
    } catch (error) {
        console.error('Error storing sensor data:', error);
    }
}

// Extract sensor data from decrypted payload
function extractSensorData(decryptedPayload) {
    const sensorData = {};

    for (const [sensorType, config] of Object.entries(SENSOR_MAPPINGS)) {
        const readings = config.positions.map(([start, length]) => {
            const bytes = decryptedPayload.slice(start, start + length);
            return config.transform(bytes);
        });

        if (readings.some(reading => reading !== null)) {
            const validReading = readings.find(reading => reading !== null);
            sensorData[sensorType] = validReading.value;
        }
    }

    console.log('Extracted sensor data:', sensorData);
    return sensorData;
}

// Encryption constants and utilities
const DEFAULT_AES_KEY = Buffer.from('1234567891234567'); // 16-byte key
const MODES = ['aes-128-ecb', 'aes-128-cbc'];
const DEVICE_KEY_PREFIX = 'sense_';  // Used in key generation

function generateDeviceKey(deviceId) {
    if (!deviceId) return DEFAULT_AES_KEY;
    
    // Use device ID with prefix to generate a device-specific key
    const hash = crypto.createHash('md5');
    hash.update(DEVICE_KEY_PREFIX + deviceId);
    return hash.digest();
}

function decryptPayload(encryptedData, deviceId) {
    if (!encryptedData || encryptedData.length === 0) {
        console.error('Empty encrypted data');
        return null;
    }

    const deviceKey = generateDeviceKey(deviceId);
    console.log('Device Key:', deviceKey.toString('hex'));
    console.log('Encrypted Data:', encryptedData.toString('hex'));

    // First try ECB mode with device key
    try {
        const decipher = crypto.createDecipheriv('aes-128-ecb', deviceKey, null);
        let decrypted = decipher.update(encryptedData);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        
        if (isValidSensorData(decrypted)) {
            console.log('Successfully decrypted with ECB mode and device key');
            return decrypted;
        }
    } catch (error) {
        console.log('ECB decryption with device key failed:', error.message);
    }

    // Try ECB mode with default key
    try {
        const decipher = crypto.createDecipheriv('aes-128-ecb', DEFAULT_AES_KEY, null);
        let decrypted = decipher.update(encryptedData);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        
        if (isValidSensorData(decrypted)) {
            console.log('Successfully decrypted with ECB mode and default key');
            return decrypted;
        }
    } catch (error) {
        console.log('ECB decryption with default key failed:', error.message);
    }

    // Try CBC mode as last resort
    if (encryptedData.length >= 16) {
        try {
            const iv = encryptedData.slice(0, 16);
            const data = encryptedData.slice(16);
            
            // Try with device key
            try {
                const decipher = crypto.createDecipheriv('aes-128-cbc', deviceKey, iv);
                let decrypted = decipher.update(data);
                decrypted = Buffer.concat([decrypted, decipher.final()]);
                
                if (isValidSensorData(decrypted)) {
                    console.log('Successfully decrypted with CBC mode and device key');
                    return decrypted;
                }
            } catch (error) {
                console.log('CBC decryption with device key failed:', error.message);
            }

            // Try with default key
            try {
                const decipher = crypto.createDecipheriv('aes-128-cbc', DEFAULT_AES_KEY, iv);
                let decrypted = decipher.update(data);
                decrypted = Buffer.concat([decrypted, decipher.final()]);
                
                if (isValidSensorData(decrypted)) {
                    console.log('Successfully decrypted with CBC mode and default key');
                    return decrypted;
                }
            } catch (error) {
                console.log('CBC decryption with default key failed:', error.message);
            }
        } catch (error) {
            console.log('CBC decryption failed:', error.message);
        }
    }

    console.error('All decryption attempts failed');
    return null;
}

function isValidSensorData(data) {
    if (!data || data.length < 12) return false;
    
    try {
        // Check for valid temperature range (-50 to 100°C)
        const temp = (data[1] << 8) | data[0];
        const tempValue = (temp / 100) - 50;
        if (tempValue < -50 || tempValue > 100) return false;
        
        // Check for valid humidity range (0-100%)
        const humidity = (data[3] << 8) | data[2];
        const humidityValue = humidity / 100;
        if (humidityValue < 0 || humidityValue > 100) return false;
        
        // Check for valid light range (0-65535)
        const light = (data[5] << 8) | data[4];
        if (light > 65535) return false;
        
        // Check for valid sound range (0-100 dB)
        const sound = (data[7] << 8) | data[6];
        const soundValue = sound / 100;
        if (soundValue < 0 || soundValue > 100) return false;
        
        // Check for valid air quality range (0-500)
        const airQuality = (data[9] << 8) | data[8];
        const aqValue = airQuality / 100;
        if (aqValue < 0 || aqValue > 500) return false;
        
        // Check for valid particulates range (0-1000 μg/m³)
        const particulates = (data[11] << 8) | data[10];
        const pmValue = particulates / 10;
        if (pmValue < 0 || pmValue > 1000) return false;
        
        return true;
    } catch (error) {
        console.error('Error validating sensor data:', error);
        return false;
    }
}

// Sensor data extraction
const SENSOR_MAPPINGS = {
    temperature: {
        positions: [[0, 2]],
        transform(bytes) {
            const rawValue = (bytes[1] << 8) | bytes[0];
            const calibratedValue = rawValue / 100 - 50;
            return {
                raw_value: rawValue,
                calibrated_value: parseFloat(calibratedValue.toFixed(1)),
                unit: "CELSIUS",
                condition: getTemperatureCondition(calibratedValue),
                status: calibratedValue >= -50 && calibratedValue <= 100 ? 1 : 0
            };
        }
    },
    humidity: {
        positions: [[2, 2]],
        transform(bytes) {
            const rawValue = (bytes[1] << 8) | bytes[0];
            const calibratedValue = rawValue / 100;
            return {
                raw_value: rawValue,
                calibrated_value: parseFloat(calibratedValue.toFixed(1)),
                unit: "PERCENTAGE",
                condition: getHumidityCondition(calibratedValue),
                status: calibratedValue >= 0 && calibratedValue <= 100 ? 1 : 0
            };
        }
    },
    light: {
        positions: [[4, 2]],
        transform(bytes) {
            const rawValue = (bytes[1] << 8) | bytes[0];
            const calibratedValue = rawValue / 100;
            return {
                raw_value: rawValue,
                calibrated_value: parseFloat(calibratedValue.toFixed(1)),
                unit: "LUX",
                condition: getLightCondition(calibratedValue),
                status: rawValue <= 65535 ? 1 : 0
            };
        }
    },
    sound: {
        positions: [[6, 2]],
        transform(bytes) {
            const rawValue = (bytes[1] << 8) | bytes[0];
            const calibratedValue = rawValue / 100;
            return {
                raw_value: rawValue,
                calibrated_value: parseFloat(calibratedValue.toFixed(1)),
                unit: "DECIBEL",
                condition: getSoundCondition(calibratedValue),
                status: calibratedValue >= 0 && calibratedValue <= 100 ? 1 : 0
            };
        }
    },
    airQuality: {
        positions: [[8, 2]],
        transform(bytes) {
            const rawValue = (bytes[1] << 8) | bytes[0];
            const calibratedValue = rawValue / 100;
            return {
                raw_value: rawValue,
                calibrated_value: parseFloat(calibratedValue.toFixed(1)),
                unit: "VOC",
                condition: getAirQualityCondition(calibratedValue),
                status: calibratedValue >= 0 && calibratedValue <= 500 ? 1 : 0
            };
        }
    },
    particulates: {
        positions: [[10, 2]],
        transform(bytes) {
            const rawValue = (bytes[1] << 8) | bytes[0];
            const calibratedValue = rawValue / 10;
            return {
                raw_value: rawValue,
                calibrated_value: parseFloat(calibratedValue.toFixed(1)),
                unit: "UG_M3",
                condition: getParticulatesCondition(calibratedValue),
                status: calibratedValue >= 0 && calibratedValue <= 1000 ? 1 : 0
            };
        }
    }
};

// Sensor condition helpers
function getTemperatureCondition(value) {
    if (value < 16) return "TOO_COLD";
    if (value > 25) return "TOO_HOT";
    return "IDEAL";
}

function getHumidityCondition(value) {
    if (value < 30) return "TOO_DRY";
    if (value > 60) return "TOO_HUMID";
    return "IDEAL";
}

function getLightCondition(value) {
    if (value < 20) return "TOO_DARK";
    if (value > 80) return "TOO_BRIGHT";
    return "IDEAL";
}

function getSoundCondition(value) {
    if (value > 60) return "TOO_LOUD";
    return "IDEAL";
}

function getAirQualityCondition(value) {
    if (value > 60) return "POOR";
    if (value > 30) return "FAIR";
    return "GOOD";
}

function getParticulatesCondition(value) {
    if (value > 50) return "POOR";
    if (value > 25) return "FAIR";
    return "GOOD";
}

app.post('/', async (req, res) => {
    console.log('----------------------------------------');
    console.log('POST Request Headers:', req.headers);
    console.log('Device ID:', req.headers['x-hello-sense-id']);

    try {
        const rawBody = await getRawBody(req);
        const deviceId = req.headers['x-hello-sense-id'];
        
        // Decrypt and validate payload
        const decryptedPayload = await decryptPayload(rawBody, deviceId);
        if (!decryptedPayload) {
            return res.status(400).send('Invalid payload');
        }

        // Extract sensor data
        const sensorData = extractSensorData(decryptedPayload);
        if (!sensorData) {
            return res.status(400).send('Invalid sensor data');
        }

        // Store sensor data
        await storeSensorData(sensorData);

        res.status(200).send('OK');
    } catch (error) {
        console.error('Error processing request:', error);
        res.status(500).send('Internal server error');
    }
});

// Sense API endpoints
app.get('/v2/timeline/current', async (req, res) => {
    try {
        const latestData = await storage.getItem('latest_sensor_data');
        if (!latestData) {
            res.status(404).json({ error: 'No sensor data available' });
            return;
        }

        // Get the actual sensor values
        const sensorValues = latestData.data.sensors || {};
        
        // Format response according to Sense API format
        const response = {
            "status": {
                "sensor_id": latestData.device_id,
                "temp": sensorValues.temperature ? sensorValues.temperature.calibrated_value : 0,
                "humidity": sensorValues.humidity ? sensorValues.humidity.calibrated_value : 0,
                "particulates": sensorValues.particulates ? sensorValues.particulates.calibrated_value : 0,
                "light": sensorValues.light ? sensorValues.light.calibrated_value : 0,
                "sound": 0,  // Sound sensor not implemented yet
                "air_quality": sensorValues.airQuality ? sensorValues.airQuality.calibrated_value : 0
            },
            "last_updated": latestData.timestamp,
            "device_id": latestData.device_id
        };

        console.log('Sending sensor data:', JSON.stringify(response, null, 2));
        res.json(response);
    } catch (error) {
        console.error('Error retrieving sensor data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/v2/room/current', async (req, res) => {
    try {
        const latestData = await storage.getItem('latest_sensor_data');
        if (!latestData) {
            res.status(404).json({ error: 'No sensor data available' });
            return;
        }

        // Get the actual sensor values
        const sensorValues = latestData.data.sensors || {};
        
        // Format response according to Sense API format
        const response = {
            "room": {
                "temperature": sensorValues.temperature ? sensorValues.temperature.calibrated_value : 0,
                "humidity": sensorValues.humidity ? sensorValues.humidity.calibrated_value : 0,
                "particulates": sensorValues.particulates ? sensorValues.particulates.calibrated_value : 0,
                "light": sensorValues.light ? sensorValues.light.calibrated_value : 0,
                "sound": 0,  // Sound sensor not implemented yet
                "light_peak": sensorValues.light ? sensorValues.light.calibrated_value : 0,
                "sound_peak": 0,
                "light_perc": sensorValues.light ? sensorValues.light.calibrated_value : 0,
                "sound_perc": 0,
                "air_quality": sensorValues.airQuality ? sensorValues.airQuality.calibrated_value : 0
            },
            "last_updated": latestData.timestamp,
            "device_id": latestData.device_id
        };

        console.log('Sending room data:', JSON.stringify(response, null, 2));
        res.json(response);
    } catch (error) {
        console.error('Error retrieving room data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/v2/account/preferences', (req, res) => {
    // Return default preferences
    res.json({
        "preferences": {
            "temp_unit": "c",
            "timezone": "Europe/Istanbul",
            "smart_alarm": true,
            "smart_alarm_time": "07:00"
        },
        "message": "OK"
    });
});

app.get('/v2/account', (req, res) => {
    // Return mock account info
    res.json({
        "account": {
            "id": "mock_account",
            "email": "demo@example.com",
            "name": "Demo User",
            "created": Date.now() - 86400000 * 30, // 30 days ago
            "last_modified": Date.now()
        },
        "message": "OK"
    });
});

app.listen(port, () => {
    logger.info(`Sense API proxy server running on port ${port}`);
});