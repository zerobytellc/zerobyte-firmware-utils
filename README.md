# zerobyte-firmware-utils

Firmware download and OTA update utility functions for EFR32-based IoT Devices by [Zero Byte LLC](https://zerobytellc.com).

## Installation

Install package from npm

```shell
npm install --save @zerobytellc/zerobyte-firmware-utils
```

or yarn

```shell
yarn add @zerobytellc/zerobyte-firmware-utils
```

## Features
- Version 0.0.1 has the initial API for downloading firmware updates so they do not need to be bundled in your applications.

## Usage
The module uses ES6 style export statement, simply use `import` to load the module.

```js
import { ZeroByteFW } from '@zerobyte-kraken-utils';
```

## Check for Firmware Updates
In order to check for firmware updates for a device, you must know two tokens:
- Client Name Token
- Device Model Token

If you do not know what tokens to use, contact [Tim](mailto@tim@zerobytellc.com) for more information.

### Obtaining download URLs:
To obtain the OTA firmware update bundles to flash your BLE device over the air, use `get_latest_fw_urls` as follows:

```js
let client_token = 'zerobytellc';   // Contact ZBL if you do not have your token
let device_token = 'model_a';       // The device identifier

ZeroByteFW.get_latest_fw_info(client_name, device_token)
    .then((fw_entries) => {
        fw_entries.forEach((entry) => {
            console.log(
                'Firmware Version %s can be downloaded here: %s',
                entry.version,
                entry.url
            );
        });
    });
```
**Multi-Part Updates** \
Occasionally, a firmware update may be packaged as a multi-part update. Incase of a multi-part update, there will be 
multiple URLs provided. **It is critical** that multi-part updates be applied to the device in the order returned here. Do not, under any circumstance, modify the order of the updates applied to the device.

### Downloading FW Updates
For convenience, a utility method is provided to download the URLs to the local filesystem, `download_fw(url) : string`. The method takes the URL, downloads the target to the local filesystem, and then returns path to the downloaded file.

```js
let client_token = 'zerobytellc';   // Contact ZBL if you do not have your token
let device_token = 'model_a';       // The device identifier

ZeroByteFW.get_latest_fw_info(client_name, device_token)
    .then((fw_entries) => {
        fw_entries.forEach((entry) => {
            let local_path = ZeroByteFW.download_fw(entry);
            console.log('Local path to download: %s', local_path);~~~~
        });
    });
```

### Conditional Update Checks
Optionally, you can specify your device's current firmware version. If the current device firmware is the same as the 
most recently published firmware, then no results will be returned.

```js
let client_token = 'zerobytellc';           // Contact ZBL if you do not have your token
let device_token = 'model_a';               // The device identifier
let current_device_fw = '20220101.abc1234'; // Read this from the device.

ZeroByteFW.get_latest_fw_info(client_name, device_token, current_device_fw)
    .then((fw_entries) => {
        // Nothing will be returned if current_device_fw is already the latest.
    });
```
