const axios = require('axios');

class SenseLocalPlatform {
    constructor(log, config, api) {
        this.log = log;
        this.config = config;
        this.api = api;
        this.accessories = [];

        if (!config) {
            this.log.error('No configuration found');
            return;
        }

        // Get configuration values with defaults
        this.name = config.name || 'Sense Device';
        this.email = config.email;
        this.password = config.password;
        this.updateInterval = (config.updateInterval || 60) * 1000; // Convert to milliseconds
        this.serverAddress = 'http://localhost:80'; // Default local API address

        this.log.debug('Platform configuration:', {
            name: this.name,
            email: this.email,
            updateInterval: this.updateInterval,
            serverAddress: this.serverAddress
        });

        if (this.api) {
            this.api.on('didFinishLaunching', () => {
                this.log.debug('Executed didFinishLaunching callback');
                this.initializeAccessory();
            });
        }
    }

    configureAccessory(accessory) {
        this.log.info('Configuring accessory %s', accessory.displayName);
        this.accessories.push(accessory);
    }

    removeAccessory(accessory) {
        this.log.info('Removing accessory %s', accessory.displayName);
        this.api.unregisterPlatformAccessories('homebridge-sense-local', 'SenseLocal', [accessory]);
    }

    initializeAccessory() {
        const uuid = this.api.hap.uuid.generate('sense-local-' + this.name);
        const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

        if (existingAccessory) {
            this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
            existingAccessory.context.device = this.config;
            this.setupSensorServices(existingAccessory);
            this.startPolling(existingAccessory);
        } else {
            this.log.info('Adding new accessory');
            const accessory = new this.api.platformAccessory(this.name, uuid);
            accessory.context.device = this.config;
            this.setupSensorServices(accessory);
            this.api.registerPlatformAccessories('homebridge-sense-local', 'SenseLocal', [accessory]);
            this.accessories.push(accessory);
            this.startPolling(accessory);
        }
    }

    setupSensorServices(accessory) {
        const Service = this.api.hap.Service;
        const Characteristic = this.api.hap.Characteristic;

        // Basic accessory setup
        const infoService = accessory.getService(Service.AccessoryInformation) ||
                          accessory.addService(Service.AccessoryInformation);
        
        infoService
            .setCharacteristic(Characteristic.Manufacturer, 'Hello')
            .setCharacteristic(Characteristic.Model, 'Sense')
            .setCharacteristic(Characteristic.SerialNumber, 'Default-Serial');

        // Setup individual sensors
        this.setupTemperatureSensor(accessory);
        this.setupHumiditySensor(accessory);
        this.setupLightSensor(accessory);
        this.setupAirQualitySensor(accessory);
    }

    setupTemperatureSensor(accessory) {
        const Service = this.api.hap.Service;
        const Characteristic = this.api.hap.Characteristic;

        const service = accessory.getService(Service.TemperatureSensor) || 
                       accessory.addService(Service.TemperatureSensor);
        
        service.getCharacteristic(Characteristic.CurrentTemperature)
            .setProps({
                minValue: -20,
                maxValue: 50,
                minStep: 0.1
            });
    }

    setupHumiditySensor(accessory) {
        const Service = this.api.hap.Service;
        const Characteristic = this.api.hap.Characteristic;

        const service = accessory.getService(Service.HumiditySensor) ||
                       accessory.addService(Service.HumiditySensor);
        
        service.getCharacteristic(Characteristic.CurrentRelativeHumidity)
            .setProps({
                minValue: 0,
                maxValue: 100,
                minStep: 1
            });
    }

    setupLightSensor(accessory) {
        const Service = this.api.hap.Service;
        const Characteristic = this.api.hap.Characteristic;

        const service = accessory.getService(Service.LightSensor) ||
                       accessory.addService(Service.LightSensor);
        
        service.getCharacteristic(Characteristic.CurrentAmbientLightLevel)
            .setProps({
                minValue: 0.0001,
                maxValue: 100000,
                minStep: 0.0001
            });
    }

    setupAirQualitySensor(accessory) {
        const Service = this.api.hap.Service;
        const Characteristic = this.api.hap.Characteristic;

        const service = accessory.getService(Service.AirQualitySensor) ||
                       accessory.addService(Service.AirQualitySensor);
        
        service.getCharacteristic(Characteristic.AirQuality);
        service.getCharacteristic(Characteristic.PM2_5Density)
            .setProps({
                minValue: 0,
                maxValue: 500,
                minStep: 0.1
            });
    }

    startPolling(accessory) {
        const Service = this.api.hap.Service;
        const Characteristic = this.api.hap.Characteristic;
        const POLL_INTERVAL = this.updateInterval;

        setInterval(async () => {
            try {
                const response = await axios.get(`${this.serverAddress}/v2/room/current`);
                const roomData = response.data;

                this.log.debug('Received room data:', JSON.stringify(roomData));

                if (!roomData || !roomData.room) {
                    this.log.debug('No room data available');
                    return;
                }

                const sensors = roomData.room;

                // Update temperature
                const tempService = accessory.getService(Service.TemperatureSensor);
                if (tempService && typeof sensors.temperature === 'number') {
                    this.log.debug('Updating temperature:', sensors.temperature);
                    tempService.updateCharacteristic(
                        Characteristic.CurrentTemperature,
                        sensors.temperature
                    );
                }

                // Update humidity
                const humidityService = accessory.getService(Service.HumiditySensor);
                if (humidityService && typeof sensors.humidity === 'number') {
                    this.log.debug('Updating humidity:', sensors.humidity);
                    humidityService.updateCharacteristic(
                        Characteristic.CurrentRelativeHumidity,
                        Math.min(100, Math.max(0, sensors.humidity))
                    );
                }

                // Update light level
                const lightService = accessory.getService(Service.LightSensor);
                if (lightService && typeof sensors.light === 'number') {
                    this.log.debug('Raw light value:', sensors.light);
                    // Convert percentage to lux (HomeKit expects 0.0001 to 100000)
                    // Using exponential scale for better range mapping
                    const luxValue = Math.max(0.0001, Math.min(100000, Math.pow(10, sensors.light / 20)));
                    this.log.debug('Converted light value (lux):', luxValue);
                    lightService.updateCharacteristic(
                        Characteristic.CurrentAmbientLightLevel,
                        luxValue
                    );
                }

                // Update air quality and particulates
                const airService = accessory.getService(Service.AirQualitySensor);
                if (airService) {
                    // Update particulate level
                    if (typeof sensors.particulates === 'number') {
                        this.log.debug('Raw particulates value:', sensors.particulates);
                        // Convert to air quality level based on PM2.5 AQI scale
                        let airQualityLevel;
                        const pm = sensors.particulates;
                        if (pm <= 12) airQualityLevel = 1; // EXCELLENT (0-12 μg/m³)
                        else if (pm <= 35.4) airQualityLevel = 2; // GOOD (12.1-35.4 μg/m³)
                        else if (pm <= 55.4) airQualityLevel = 3; // FAIR (35.5-55.4 μg/m³)
                        else if (pm <= 150.4) airQualityLevel = 4; // INFERIOR (55.5-150.4 μg/m³)
                        else airQualityLevel = 5; // POOR (>150.5 μg/m³)

                        this.log.debug('Air quality level:', airQualityLevel);
                        airService.updateCharacteristic(
                            Characteristic.AirQuality,
                            airQualityLevel
                        );

                        airService.updateCharacteristic(
                            Characteristic.PM2_5Density,
                            Math.max(0, Math.min(500, pm))
                        );
                    }
                }

            } catch (error) {
                this.log.error('Failed to update sensor values:', error.message);
                if (error.response) {
                    this.log.debug('Error response:', error.response.data);
                }
            }
        }, POLL_INTERVAL);
    }
}

module.exports = (api) => {
    api.registerPlatform('homebridge-sense-local', 'SenseLocal', SenseLocalPlatform);
};
