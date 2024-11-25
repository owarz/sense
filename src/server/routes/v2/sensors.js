const express = require('express');
const router = express.Router();
const storage = require('../../storage');
const moment = require('moment');

// GET /v2/sensors - Get current sensor values
router.get('/', async (req, res) => {
    try {
        const latestData = await storage.getItem('latest_sensor_data') || {};
        const periodicData = await storage.getItem('periodic_data') || {};

        const response = {
            status: Object.keys(latestData).length > 0 ? 'OK' : 'NO_SENSE',
            sensors: []
        };

        if (Object.keys(periodicData).length > 0) {
            // Convert periodic data to sensor format
            const sensorMappings = {
                temperature: {
                    name: 'Temperature',
                    scale: 0.01, // Convert from Celsius * 100
                    unit: '°C'
                },
                humidity: {
                    name: 'Humidity',
                    scale: 0.01, // Convert from Percentage * 100
                    unit: '%'
                },
                light: {
                    name: 'Light',
                    scale: 1,
                    unit: 'lux'
                },
                dust: {
                    name: 'Particulates',
                    scale: 1,
                    unit: 'μg/m³'
                }
            };

            for (const [type, config] of Object.entries(sensorMappings)) {
                if (periodicData[type] !== undefined) {
                    const value = periodicData[type] * config.scale;
                    const sensorData = {
                        type: type.toUpperCase(),
                        name: config.name,
                        value: value,
                        unit: config.unit,
                        condition: getSensorCondition(type, value),
                        message: getSensorMessage(type, value)
                    };
                    response.sensors.push(sensorData);
                }
            }

            // Add additional data if available
            if (periodicData.dust_max !== undefined) {
                response.sensors.push({
                    type: 'PARTICULATES_MAX',
                    name: 'Maximum Particulates',
                    value: periodicData.dust_max,
                    unit: 'μg/m³',
                    condition: getSensorCondition('dust', periodicData.dust_max),
                    message: getSensorMessage('dust', periodicData.dust_max)
                });
            }
        }

        res.json(response);
    } catch (error) {
        console.error('Error getting sensor data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /v2/sensors - Get historical sensor data
router.post('/', async (req, res) => {
    try {
        const { scope, sensors } = req.body;
        if (!scope || !sensors || !Array.isArray(sensors)) {
            return res.status(400).json({ error: 'Invalid request body' });
        }

        const history = await storage.getItem('sensor_history') || {};
        const periodicHistory = await storage.getItem('periodic_history') || [];
        
        // Get time range based on scope
        const endTime = moment();
        let startTime;
        const interval = getIntervalFromScope(scope);

        switch (scope) {
            case 'DAY_5_MINUTE':
                startTime = moment().subtract(1, 'day');
                break;
            case 'WEEK_1_HOUR':
                startTime = moment().subtract(7, 'days');
                break;
            case 'LAST_3H_5_MINUTE':
                startTime = moment().subtract(3, 'hours');
                break;
            default:
                return res.status(400).json({ error: 'Invalid scope' });
        }

        // Process periodic history data
        const timestamps = [];
        const sensorData = {};

        // Initialize sensor data arrays
        sensors.forEach(sensor => {
            sensorData[sensor] = [];
        });

        // Filter and process periodic history
        periodicHistory
            .filter(entry => {
                const entryTime = moment.unix(entry.unix_time);
                return entryTime.isBetween(startTime, endTime);
            })
            .forEach(entry => {
                timestamps.push(entry.unix_time * 1000); // Convert to milliseconds

                sensors.forEach(sensor => {
                    const value = getSensorValueFromPeriodic(sensor.toLowerCase(), entry);
                    sensorData[sensor].push(value);
                });
            });

        res.json({
            timestamps,
            sensors: sensorData
        });
    } catch (error) {
        console.error('Error getting historical sensor data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Helper functions
function getSensorUnit(type) {
    const units = {
        TEMPERATURE: '°C',
        HUMIDITY: '%',
        LIGHT: 'lux',
        DUST: 'μg/m³',
        PARTICULATES: 'μg/m³',
        PARTICULATES_MAX: 'μg/m³'
    };
    return units[type.toUpperCase()] || '';
}

function getSensorCondition(type, value) {
    // Implement condition logic based on sensor type and value
    const conditions = {
        temperature: [
            { max: 18, condition: 'COLD' },
            { min: 18, max: 24, condition: 'IDEAL' },
            { min: 24, condition: 'HOT' }
        ],
        humidity: [
            { max: 30, condition: 'DRY' },
            { min: 30, max: 60, condition: 'IDEAL' },
            { min: 60, condition: 'HUMID' }
        ],
        dust: [
            { max: 12, condition: 'IDEAL' },
            { min: 12, max: 35, condition: 'WARNING' },
            { min: 35, condition: 'ALERT' }
        ]
    };

    const ranges = conditions[type.toLowerCase()];
    if (!ranges) return 'UNKNOWN';

    for (const range of ranges) {
        if (range.max && value <= range.max) return range.condition;
        if (range.min && value >= range.min && (!range.max || value <= range.max)) return range.condition;
    }
    return 'UNKNOWN';
}

function getSensorMessage(type, value) {
    const condition = getSensorCondition(type, value);
    const messages = {
        temperature: {
            COLD: 'Room is too cold',
            IDEAL: 'Temperature is comfortable',
            HOT: 'Room is too warm'
        },
        humidity: {
            DRY: 'Air is too dry',
            IDEAL: 'Humidity is comfortable',
            HUMID: 'Air is too humid'
        },
        dust: {
            IDEAL: 'Air quality is good',
            WARNING: 'Air quality needs attention',
            ALERT: 'Air quality is poor'
        }
    };

    return messages[type.toLowerCase()]?.[condition] || 'No message available';
}

function getIntervalFromScope(scope) {
    const intervals = {
        'DAY_5_MINUTE': 300,    // 5 minutes in seconds
        'WEEK_1_HOUR': 3600,    // 1 hour in seconds
        'LAST_3H_5_MINUTE': 300 // 5 minutes in seconds
    };
    return intervals[scope] || 300;
}

function getSensorValueFromPeriodic(sensor, entry) {
    const scalings = {
        temperature: 0.01,
        humidity: 0.01,
        light: 1,
        dust: 1
    };

    const scale = scalings[sensor] || 1;
    return entry[sensor] !== undefined ? entry[sensor] * scale : null;
}

module.exports = router;
