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

// Analyze sensor payload with pattern detection
function analyzeSensorPayload(payload) {
    console.log('\nPayload Analysis:');
    console.log('Current  :', payload.toString('hex'));
    
    if (previousPayload) {
        console.log('Previous :', previousPayload.toString('hex'));
        
        // Compare bytes
        console.log('\nByte changes:');
        const changes = [];
        for (let i = 0; i < payload.length; i++) {
            if (payload[i] !== previousPayload[i]) {
                changes.push({
                    position: i,
                    previous: previousPayload[i],
                    current: payload[i],
                    diff: payload[i] - previousPayload[i]
                });
            }
        }
        console.log('Changed bytes:', changes);
        
        // Look for patterns in changes
        if (changes.length > 0) {
            // Group changes by their difference
            const diffGroups = changes.reduce((acc, change) => {
                const diff = change.diff;
                if (!acc[diff]) acc[diff] = [];
                acc[diff].push(change.position);
                return acc;
            }, {});
            console.log('\nChanges grouped by difference:', diffGroups);
            
            // Look for regular intervals
            console.log('\nPosition intervals:');
            changes.forEach((change, i) => {
                if (i > 0) {
                    const interval = change.position - changes[i-1].position;
                    console.log(`Interval between positions ${changes[i-1].position} and ${change.position}: ${interval} bytes`);
                }
            });
        }
    }
    
    // Store for next comparison
    previousPayload = Buffer.from(payload);
    
    // Look for potential sensor values
    const potentialSensors = [];
    for (let i = 0; i < payload.length - 3; i++) {
        // Try different byte combinations
        const value1 = payload[i];
        const value2 = (payload[i] << 8) | payload[i + 1];
        const value4 = (payload[i] << 24) | (payload[i + 1] << 16) | (payload[i + 2] << 8) | payload[i + 3];
        
        // Check if values are in typical sensor ranges
        if (value1 >= 0 && value1 <= 100) {
            potentialSensors.push({ start: i, length: 1, value: value1, type: 'percentage' });
        }
        if (value2 >= 0 && value2 <= 10000) { // For scaled values (e.g. temp * 100)
            const scaledValue = value2 / 100;
            if (scaledValue >= -20 && scaledValue <= 50) { // Temperature range
                potentialSensors.push({ start: i, length: 2, value: scaledValue, type: 'temperature' });
            }
        }
    }

    // Group potential sensors by position
    const sensorsByPosition = potentialSensors.reduce((acc, sensor) => {
        const key = `${sensor.start}-${sensor.length}`;
        if (!acc[key]) acc[key] = [];
        acc[key].push(sensor);
        return acc;
    }, {});

    console.log('\nPotential sensors by position:', sensorsByPosition);
    
    // Look for consistent patterns
    const patterns = [];
    for (let i = 0; i < payload.length - 1; i++) {
        const byte = payload[i];
        const nextByte = payload[i + 1];
        
        // Look for specific patterns
        if (byte <= 100 && nextByte <= 100) {
            patterns.push({
                position: i,
                type: 'consecutive_percentage',
                values: [byte, nextByte]
            });
        }
    }
    
    console.log('\nByte patterns:', patterns);
}

// Encryption constants and utilities
const DEFAULT_AES_KEY = Buffer.from('1234567891234567'); // 16-byte key
const MODES = ['aes-128-ecb', 'aes-128-cbc', 'aes-128-ctr'];

function generateDeviceKey(deviceId) {
    // Use device ID to generate a device-specific key
    const hash = crypto.createHash('md5');
    hash.update(deviceId);
    return hash.digest();
}

function decryptPayload(encryptedData, deviceId) {
    const deviceKey = generateDeviceKey(deviceId);
    
    for (const mode of MODES) {
        try {
            // For modes that need IV, use first 16 bytes of encrypted data
            const needsIV = mode !== 'aes-128-ecb';
            const iv = needsIV ? encryptedData.slice(0, 16) : null;
            const data = needsIV ? encryptedData.slice(16) : encryptedData;
            
            // Try with both default and device-specific keys
            const keys = [DEFAULT_AES_KEY, deviceKey];
            
            for (const key of keys) {
                try {
                    const decipher = crypto.createDecipheriv(mode, key, iv);
                    let decrypted = decipher.update(data);
                    decrypted = Buffer.concat([decrypted, decipher.final()]);
                    
                    // Check if decrypted data looks valid (contains some values between 0-100)
                    const hasValidRanges = decrypted.some(b => b >= 0 && b <= 100);
                    if (hasValidRanges) {
                        console.log(`Successfully decrypted with mode: ${mode}, key type: ${key === DEFAULT_AES_KEY ? 'default' : 'device'}`);
                        return decrypted;
                    }
                } catch (error) {
                    // Continue trying other combinations
                }
            }
        } catch (error) {
            console.error(`Decryption failed for mode ${mode}:`, error.message);
        }
    }
    
    console.error('All decryption attempts failed');
    return encryptedData; // Return original data if all decryption attempts fail
}

// Sensor data extraction
const SENSOR_MAPPINGS = {
    temperature: {
        positions: [[36, 2], [43, 2]],
        transform(bytes) {
            return parseFloat((bytes[0] + bytes[1] / 256).toFixed(2));
        }
    },
    humidity: {
        positions: [[2, 1], [19, 1], [37, 1]],
        transform(bytes) {
            return parseFloat((bytes[0]).toFixed(2));
        }
    },
    light: {
        positions: [[27, 1], [28, 1]],
        transform(bytes) {
            // Convert raw values to lux (0-100 scale)
            const rawValue = bytes[0] + (bytes[1] << 8);
            return parseFloat((rawValue / 65535 * 100).toFixed(2));
        }
    },
    airQuality: {
        positions: [[3, 1], [4, 1]],
        transform(bytes) {
            return parseFloat(((bytes[0] + bytes[1]) / 2).toFixed(2));
        }
    },
    particulates: {
        positions: [[10, 1], [11, 1], [12, 1]],
        transform(bytes) {
            // Convert raw values to PM2.5 (μg/m³)
            const values = bytes.filter(b => b !== null && b !== undefined);
            if (values.length === 0) return null;
            
            // Calculate PM2.5 value (typical range 0-500 μg/m³)
            const rawValue = values.reduce((sum, val) => sum + val, 0) / values.length;
            return parseFloat((rawValue * 2).toFixed(2)); // Scale to typical PM2.5 range
        }
    }
};

function extractSensorData(decryptedPayload) {
    try {
        const sensorData = {};
        
        // Extract values for each sensor type
        for (const [sensorType, config] of Object.entries(SENSOR_MAPPINGS)) {
            const values = config.positions.map(([pos, len]) => {
                if (pos >= decryptedPayload.length) return null;
                const bytes = decryptedPayload.slice(pos, pos + len);
                return bytes.length === len ? bytes : null;
            }).filter(Boolean);

            if (values.length > 0) {
                const transformedValues = values.map(bytes => config.transform(bytes));
                // Use the first valid value
                sensorData[sensorType] = transformedValues.find(v => v !== null) ?? null;
            } else {
                sensorData[sensorType] = null;
            }
        }

        console.log('Extracted sensor values:', JSON.stringify(sensorData, null, 2));
        return sensorData;
    } catch (error) {
        console.error('Error extracting sensor data:', error);
        return {
            temperature: null,
            humidity: null,
            light: null,
            airQuality: null,
            particulates: null
        };
    }
}

function average(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const validValues = arr.filter(v => !isNaN(v) && v !== null);
    return validValues.length > 0 ? 
        parseFloat((validValues.reduce((a, b) => a + b) / validValues.length).toFixed(2)) : 
        null;
}

// Timestamp handling
function decodeTimestamp(timestamp) {
    try {
        // Convert BigInt to Number safely for dates
        const milliseconds = typeof timestamp === 'bigint' ? 
            Number(timestamp) : Number(timestamp.toString());
        
        if (isNaN(milliseconds)) {
            console.error('Invalid timestamp value:', timestamp);
            return null;
        }
        
        const date = new Date(milliseconds);
        return date.toString() === 'Invalid Date' ? null : date;
    } catch (error) {
        console.error('Error decoding timestamp:', error);
        return null;
    }
}

function encodeTimestamp() {
    // Current time in milliseconds as string to avoid BigInt serialization issues
    return Date.now().toString();
}

// Manual protobuf decoding
function decodeProtobuf(buffer) {
    try {
        let offset = 0;
        let result = {
            version: null,
            timestamp: null,
            timestampDate: null,
            payload: null,
            sensors: null
        };

        // Version field (1) - varint
        if (buffer[offset] === 0x08) {
            offset += 1;
            result.version = buffer[offset];
            offset += 1;
        }

        // Timestamp field (2) - varint
        if (buffer[offset] === 0x10) {
            offset += 1;
            let timestamp = 0n;
            let shift = 0n;
            while (offset < buffer.length) {
                const byte = buffer[offset];
                timestamp |= BigInt(byte & 0x7f) << shift;
                offset += 1;
                if ((byte & 0x80) === 0) break;
                shift += 7n;
            }
            // Convert BigInt to string for safe serialization
            result.timestamp = timestamp.toString();
            result.timestampDate = decodeTimestamp(timestamp);
        }

        // Remaining data is the payload
        if (offset < buffer.length) {
            result.payload = buffer.slice(offset).toString('hex');
            
            // Try to decrypt the payload
            const deviceId = global.currentDeviceId;
            if (deviceId) {
                const decryptedPayload = decryptPayload(buffer.slice(offset), deviceId);
                if (decryptedPayload) {
                    console.log('Decrypted payload:', decryptedPayload);
                    
                    // Extract sensor values
                    const sensorData = extractSensorData(decryptedPayload);
                    if (sensorData) {
                        result.sensors = sensorData;
                    }
                }
            }
        }

        return result;
    } catch (error) {
        console.error('Error decoding protobuf:', error);
        return null;
    }
}

app.post('/', async (req, res) => {
    console.log('----------------------------------------');
    console.log('POST Request Headers:', req.headers);
    
    // Store device ID for decryption
    global.currentDeviceId = req.headers['x-hello-sense-id'];
    
    try {
        if (req.headers['content-type'] === 'application/x-protobuf' && req.rawBody) {
            const decoded = decodeProtobuf(req.rawBody);
            console.log('Decoded message:', {
                version: decoded.version,
                timestamp: decoded.timestamp,
                timestampDate: decoded.timestampDate,
                payload: decoded.payload
            });

            // Analyze payload to find sensor data format
            analyzeSensorPayload(Buffer.from(decoded.payload, 'hex'));
            
            // Store the latest data
            const latestData = {
                timestamp: Date.now(),
                data: decoded,
                headers: req.headers,
                device_id: req.headers['x-hello-sense-id']
            };
            
            await storage.setItem('latest_sensor_data', latestData);
            
            res.status(200).send({
                server_time: encodeTimestamp()
            });
        } else {
            console.log('Not a protobuf request');
            res.status(400).send('Invalid content type');
        }
    } catch (error) {
        console.error('Error details:', error);
        console.error('Error stack:', error.stack);
        res.status(500).send('Internal Server Error');
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

        // Format response according to Sense API format
        const response = {
            "status": {
                "sensor_id": latestData.device_id,
                "temp": 25.5,
                "humidity": 45,
                "particulates": 50,
                "light": 5,
                "sound": 35,
                "wave": 0,
                "timestamp": parseInt(latestData.data.timestamp)
            },
            "message": "OK"
        };

        res.json(response);
    } catch (error) {
        console.error('Error getting timeline data:', error);
        res.status(500).json({ error: 'Failed to get timeline data' });
    }
});

app.get('/v2/room/current', async (req, res) => {
    try {
        const latestData = await storage.getItem('latest_sensor_data');
        if (!latestData) {
            res.status(404).json({ error: 'No sensor data available' });
            return;
        }

        // Format response according to Sense API format
        const response = {
            "room": {
                "temperature": 25.5,
                "humidity": 45,
                "particulates": 50,
                "light": 5,
                "sound": 35,
                "light_peak": 10,
                "sound_peak": 50,
                "light_peaktime": Date.now() - 300000, // 5 minutes ago
                "sound_peaktime": Date.now() - 300000
            },
            "message": "OK"
        };

        res.json(response);
    } catch (error) {
        console.error('Error getting room data:', error);
        res.status(500).json({ error: 'Failed to get room data' });
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