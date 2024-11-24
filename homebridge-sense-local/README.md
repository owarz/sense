# homebridge-sense-local

Bu Homebridge eklentisi, yerel Sense API sunucusuyla çalışarak Sense uyku takip cihazını HomeKit'e entegre eder.

## Kurulum

1. Homebridge'i yükleyin (eğer henüz yüklemediyseniz)
2. Bu eklentiyi yükleyin:
```bash
npm install -g homebridge-sense-local
```

## Yapılandırma

Homebridge'in config.json dosyasına şu yapılandırmayı ekleyin:

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

### Yapılandırma Seçenekleri

- `platform`: Her zaman "SenseLocal" olmalı
- `name`: HomeKit'te görünecek isim
- `server_address`: Yerel Sense API sunucusunun adresi (varsayılan: http://localhost:3000)

## Özellikler

Bu eklenti aşağıdaki sensörleri HomeKit'e ekler:

- Sıcaklık Sensörü
- Nem Sensörü
- Hava Kalitesi Sensörü
- Işık Sensörü
- Gürültü Sensörü

Her sensör dakikada bir güncellenir.

## Gereksinimler

- Homebridge v1.3.0 veya üzeri
- Node.js v14 veya üzeri
- Çalışan bir yerel Sense API sunucusu
