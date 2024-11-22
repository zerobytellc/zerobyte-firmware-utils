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

### Obtaining FW Information From Zero Byte LLC's Servers
If Zero Byte LLC manages your firmware distribution, then follow this section. If you manage firmware distributions on your 
own infrastructure, then skip below to *Obtaining Firmware Information from your own server*

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

Each entry returned has these properties:
1. `name` the name of the firmware file
2. `version` the version of the firmware file
3. `md5` the md5 sum of the firmware file
4. `url` the url to download the firmware file. *Note:* do not cache this url, it is subject to change.
5. `apploader` (optional) the name of the entry in the index that contains the pre-requisite apploader for this firmware

### Obtaining Firmware Information from your own server
By default, firmware indices and bundles are obtained from https://firmware.zerobytellc.com/firmware/, however, many client will wish to 
deploy their own firmware distribution server. To support this, the `get_latest_fw_info` method takes several additional *optional* parameters:
1. `current_fw_version`: If specified, then this will be checked against the latest version number in the firmware index. If they match, then no updates are returned, indicating that your current firmware version is already the latest. See *Conditional Update Checks* below for details.
2. `channel`: The release channel for the firmware bundles, e.g. `alpha`, `beta`, `prod`, etc. Defaults to `prod`
3. `url_base`: The base URL from which to build the path to the firmware index. Firmware indices are expected to be found at `${url_base}/${client_name}/${channel}/index.json`. The value of `url_base` must begin with the protocol to use, e.g. `http://` or `https://` 

```js
let client_token = 'zerobytellc';   // Contact ZBL if you do not have your token
let device_token = 'model_a';       // The device identifier
let firmware_server_url = 'https://myfirmware.mycompany.org/'
let release_channel = 'prod'

/*
 * Retrieve the firmware index from 
 *    https://myfirmware.mycompany.org/zerobytellc/model_a/prod/index.json
 *    |-------------------------------/-----------/-------/----/index.json
 *                 |                         |        |     |
 *                 |                         |        |     +-- release_channel
 *                 |                         |        +-------- device_token
 *                 |                         +----------------- client_name
 *                 +------------------------------------------- url_base
 */
ZeroByteFW.get_latest_fw_info(client_name, device_token, undefined, release_channel, firmware_server_url)
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

## Downloading FW Updates
For convenience, a utility method is provided to download the URLs to the local filesystem, `download_fw(fw_info) : string`. The method takes the firmware info returned by `get_latest_fw_info`, downloads the target to the local filesystem, and then returns path to the downloaded file.

```js
let client_token = 'zerobytellc';   // Contact ZBL if you do not have your token
let device_token = 'model_a';       // The device identifier

ZeroByteFW.get_latest_fw_info(client_name, device_token)
    .then((fw_entries) => {
        fw_entries.forEach((entry) => {
            let local_path = ZeroByteFW.download_fw(entry);
            console.log(
                '%s firmware version %s downloaded from %2 to: %s',
                entry.name, 
                entry.version, 
                entry.url,
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

// local_paths now contains the list of downloaded firmware files to apply to the device over the air.
```

## Conditional Update Checks
Optionally, you can specify your device's current firmware version. If the current device firmware is the same as the 
most recently published firmware, then no results will be returned.

```js
let client_token = 'zerobytellc';           // Contact ZBL if you do not have your token
let device_token = 'model_a';               // The device identifier
let current_device_fw = '20220101.abc1234'; // Read this from the device.

ZeroByteFW.get_latest_fw_info(client_name, device_token, current_device_fw)
    .then((fw_entries) => {
        // Nothing will be returned if current_device_fw is already the latest.
    })    
    .catch((error) => {
        switch(error) {
            case FIRMWARE_INDEX_UNAVAILABLE:
                console.log('Unable to retrieve the current firmware index at this time.');
                break;
            case FIRMWARE_INDEX_MALFORMED:
                console.log('Unable to parse firmware index as valid JSON response.');
                break;
            case FIRMWARE_INDEX_DEVICE_UNKNOWN:
                console.log('device_token is not listed in the firmware index.');
                break;
            case FIRMWARE_INDEX_LATEST_VERSION_UNKNOWN:
                console.log('Unable to determine the latest firmware version from the firmware index (index is malformed).');
                break;
            case FIRMWARE_BUNDLE_UNAVAILABLE:
                console.log('Unable to retrieve the firmware gbl file from the URL provided in the firmware index.');
                break;
            case UNKNOWN_ERROR:
                console.log('Some other unexpected error condition occurred.');
                break;
        }
    })
```

## Applying Firmware Updates
This library provides a full turn-key method to apply the latest firmware update to your device: `ZeroByteDFU.startDFU(...)` which takes 
the following parameters:

This is meant to be a helpful utility but is really only provided as a source code reference for how you might implement it in your own applications. 
Feel free to use it if you find it helpful, Zero Byte LLC uses it in their own applications, but the turn key implementation is a complete end-to-end 
workflow which may not meet your specific needs.

1. `peripheralId` The device.id of the device to update
2. `bleManager` The initialized BleManager instance from the application
3. `clientName` The name of the client
3. `deviceName` The device's hardware identifier ... 'A' for Kraken, 'B' for Range Extender ... don't ask why, it just is.
4. `channel` The firmware update channel from which the index.json is retrieved (e.g. "prod", "beta", "alpha" or "dev")
5. `currentFWVersion` (*optional*, default: undefined). The current FW version used on the device
6. `url_base` (*optional*, default; https://firmware.zerobytellc.com/firmware/). The url_base from which to retrieve the firmware index.
7. `isInOTA` optional (default: false). Set to true if the device is already in DFU mode prior to the update.
8. `onDone` callback invoked after DFU has completed: (string)=>void
9. `onProgress` callback invoked repeatedly throughout the DFU process: (number)=>void where number = percent complete
10. `updateStatus` callback invoked to pass a status message to the application for display: (string)=>void


This relies on you having already initialized a BleManager from the `react-native-ble-plx` API.

```js
import {BleManager} from 'react-native-ble-plx';

const bleManager = new BleManager();
const myDevice = undefined; // Use bleManager to discover a device ... out of scope for this tutorial.

await ZeroByteDFU.startDFU(
    myDevice.id,
    bleManager,
    'acme_co',
    'acme_tnt',
    'prod',
    undefined,  // Optionally pass the version of the firmware currently running on myDevice...
    'https://firmware.acme.co/',
    false,      // If myDevice was already in OTA, then this should be set to true.
    () => { console.log("Firmware update is done!"); },
    (i) => { console.log("Firmware update is " + i + "% complete"); },
    (statusMsg) => { console.log("Current status is: " + statusMsg); }
)
```

