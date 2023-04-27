# zerobyte-firmware-utils

Firmware download and OTA update utility functions for IoT Devices designed by [Zero Byte LLC](https://zerobytellc.com). This library is released under Creative Commons Attribution No-Derivatives 4.0 International. See [LICENSE.txt](LICENSE.txt).

Copyright &copy; 2023 Zero Byte LLC, All Rights Reserved

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
- Version 0.0.2 has minor bug and documentation fixes.

## Usage
The module uses ES6 style export statement, simply use `import` to load the module.

```js
import { ZeroByteFW } from '@zerobytellc/zerobyte-firmware-utils';
```

## Check for Firmware Updates
In order to check for firmware updates for a device, you must know two tokens:
- Client Name Token
- Device Model Token

If you do not know what tokens to use, contact [Tim](mailto:tim@zerobytellc.com) for more information.

### Obtaining FW Information
To obtain information about the latest available firmware for your device, use the `get_latest_fw_info` method as shown here. This method
returns an array of FirmwareInformation instances which describe the latest available firmware version. Occasionally, a firmware update may be packaged as a multi-part update. Incase of a multi-part update, there will be
multiple entries provided. *It is critical that multi-part updates be applied to the device in the order returned here.*


```js
let client_token = 'zerobytellc';   // Contact ZBL if you do not have your token
let device_token = 'model_a';       // The device identifier

ZeroByteFW.get_latest_fw_info(client_name, device_token)
    .then((fw_entries) => {
        fw_entries.forEach((entry) => {
            console.log(
                '%s ver %s can be downloaded here: %s\n' +
                'MD5: %s',
                entry.name,
                entry.version,
                entry.url,
                entry.md5
            );
        });
    });
```

Each entry returned has three properties:
1. `name` the name of the firmware file
2. `version` the version of the firmware file
3. `md5` the md5 sum of the firmware file
4. `url` the url to download the firmware file. *Note:* do not cache this url, it is subject to change.
### Downloading FW Updates
For convenience, a utility method is provided to download the URLs to the local filesystem, `download_fw(fw_info) : string`. The method takes the firmware info returned by `get_latest_fw_info`, downloads the target to the local filesystem, and then returns path to the downloaded file.

```js
let client_token = 'zerobytellc';   // Contact ZBL if you do not have your token
let device_token = 'model_a';       // The device identifier

ZeroByteFW.get_latest_fw_info(client_name, device_token)
    .then((fw_entries) => {
        fw_entries.forEach((entry) => {
            let local_path = ZeroByteFW.download_fw(entry);
            console.log(
                '%s firmware version %s downloaded to: %s',
                entry.name, 
                entry.version, 
                local_path);
            
            // Load file from local_path and apply to device via OTA here.
        });
    });
```

An alternative implementation:
```js
let client_token = 'zerobytellc';   // Contact ZBL if you do not have your token
let device_token = 'model_a';       // The device identifier
let local_paths = [];

// Retrieve the latest fw info:
let fw_entries = await ZeroByteFW.get_latest_fw_info(
    client_token,
    device_token
);

for (let i = 0; i < fw_entries.length; ++i) {
    // Download each firmware to a temporary path in the local filesystem
    let entry = fw_entries[i];
    let path  = await ZeroByteFW.download_fw(entry);

    local_paths.push(path);
}

// local_paths now contains the list of downloaded firmware files 
// to apply to the device over the air.
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
