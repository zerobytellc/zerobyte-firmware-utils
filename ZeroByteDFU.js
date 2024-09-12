import RNFetchBlob from 'rn-fetch-blob';
import {Platform} from 'react-native';
import {BleManager} from 'react-native-ble-plx';
import {download_fw, get_latest_fw_info} from "./ZeroByteFirmwareUtils";
import {Device} from "react-native-ble-plx";

const Buffer = require('buffer/').Buffer;

function osUUID(uuid) {
    return Platform.OS === 'ios' ? uuid.toUpperCase() : uuid.toLowerCase();
}

const OTA_SERVICE = osUUID('1D14D6EE-FD63-4FA1-BFA4-8F47B42119F0');

/**
 * The attribute for putting the bootloader in a state to receive a new firmware (GBL file).
 * Control words:
 * 0x00 to start the update. (Testing shows it's 0x01 that starts the update)
 * 0x03 to indicate the upload is finished.
 * 0x04 request that the target device close the connection.
 *       Typically the connection is closed by OTA client but using this control value
 *       it is possible to request that disconnection is initiated by the OTA target device
 * BLE Type: hex
 * BLE length: 1 byte
 * BLE Support: mandatory
 * BLE Properties: Write
 * @type {string}
 */
const OTA_CONTROL_ATTRIBUTE = osUUID('F7BF3564-FB6D-4E53-88A4-5E37E0326063');
const CTL_START = 0x00;
const CTL_DONE = 0x03;
const CTL_CLOSE = 0x04;

/**
 * The attribute for sending firmware data to the bootloader.
 * BLE Type: hex
 * BLE length: 0-244 bytes
 * BLE Support: mandatory
 * BLE Properties: Write without response, write
 * @type {string}
 */
const OTA_DATA_ATTRIBUTE = osUUID('984227F3-34FC-4045-A5D0-2C581F81A153');
const APPLOADER_VERSION = osUUID('4F4A2368-8CCA-451E-BFFF-CF0E2EE23E9F');
const OTA_VERSION = osUUID('4CC07BCF-0868-4B32-9DAD-BA4CC41E5316');
const GECKO_BOOTLOADER_VERSION = osUUID('25F05C0A-E917-46E9-B2A5-AA2BE1245AFE');
const APPLICATION_VERSION = osUUID('0D77CC11-4AC1-49F2-BFA9-CD96AC7A92F8');

/**
 * Turn-key DFU method ... checks for new firmware, downloads the images, and flashes them onto the device.
 *
 * This method ALWAYS applies the latest available firmware to the device. If the latest firmware version in the update
 * channel matches currentFWVersion, no action is taken.
 *
 * @param peripheralId The device.id of the device to update
 * @param bleManager The initialized BleManager instance from the application
 * @param model The device's hardware identifier ... 'A' for Kraken, 'B' for Range Extender ... don't ask why, it just is.
 * @param channel The firmware update channel from which the index.json is retrieved (e.g. "prod", "beta", "alpha" or "dev")
 * @param currentFWVersion optional (default: undefined). The current FW version used on the device
 * @param isInOTA optional (default: false). Set to true if the device is already in DFU mode prior to the update.
 * @param onDone callback invoked after DFU has completed: (string)=>void
 * @param onProgress callback invoked repeatedly throughout the DFU process: (number)=>void where number = percent complete
 * @param updateStatus callback invoked to pass a status message to the application for display: (string)=>void
 */
export function startDFU(peripheralId, bleManager, deviceName, channel, currentFWVersion = undefined, isInOTA = false, onDone, onProgress, updateStatus) {
    console.log('Starting firmware update for ' + peripheralId + " - " + deviceName);

    // We're really just wrapping DFUHandler in a convenient package here ...
    // all the work starts in ota_update_firmware.
    let dfu = new DFUHandler(peripheralId, bleManager, deviceName, channel, currentFWVersion, isInOTA, updateStatus, onProgress);
    dfu.ota_turnkey_firmware_update().then((status) => {
        console.trace('Got status: ' + status);
        let message;
        switch (status) {
            case 0:
                message = 'Update failed...';
                break;
            case -1:
                message = 'No update available...';
                break;
            case 1:
                message = 'Update completed successfully...';
                break;
            default:
                message = 'Unexpected result from firmware update. Please contact support.';
                break;
        }

        onDone(message);
    });
}

class Model {
    name;
    size;
    hardwareRevisionId;

    constructor(name, size, id) {
        this.name = name;
        this.size = size;
        this.hardwareRevisionId = id;
    }
}

const models = Object.freeze({
    KRAKEN: new Model('kraken', 256, 'A'),
                             ARCUS: new Model('arcus', 1024, 'B'),
});

function modelById(hardwareRevision) {
    switch (hardwareRevision[0]) {
        case models.KRAKEN.hardwareRevisionId:
            return models.KRAKEN;
        case models.ARCUS.hardwareRevisionId:
            return models.ARCUS;
    }
    throw new ModelNotFoundException(
        `No SmartMonster model found for "${hardwareRevision}".`,
    );
}

class DFUHandler {
    static shouldCancel = false;
    bleManager: BleManager;
    REQUEST_MTU: number = 245;
    BLOCK_SIZE: number = this.REQUEST_MTU - 8;
    peripheralId: string;
    deviceName: string;
    version: string;
    channel: string;
    currentFWVersion: string;
    isInOTA: boolean;
    updateStatus: (string)=>void;       // Used to notify the app of a status message intended to show the user -- but it's not internationalized so use with care.
    onProgress: (number)=>void;         // Used to nofify the app of progress ... given values 0 to 100 to represent % complete of an upload

    /**
     *
     * @param peripheralId The bluetooth device.id
     * @param bleManager The initialized BleManager used by the application
     * @param model The device model name (e.g. "arcus", "kraken"...)
     * @param updateStatus A callback with signature (string)=>void, used to send status messages to the app for display to the user...
     * @param channel The update channel to use (e.g. "prod", "beta", "alpha" or "dev")
     * @param currentFWVersion The current firmware version on the device we're updating. Used to determine if the latest available is already applied. May be undefined.
     * @param isInOTA Defaults to false. Set to true if you're calling this for a peripheral that is already in DFU mode.
     */
    constructor(peripheralId, bleManager, deviceName, channel, currentFWVersion, isInOTA, updateStatus, onProgress) {
        this.peripheralId = peripheralId;
        this.bleManager = bleManager;
        this.deviceName = deviceName;
        this.updateStatus = updateStatus;
        this.channel = channel;
        this.currentFWVersion = currentFWVersion;
        this.isInOTA = isInOTA;
        this.onProgress = onProgress;
    }

    static cancel() {
        this.shouldCancel = true;
    }

    /**
     * Obtains the array of firmware modules that need to be applied to the device
     *
     * @param currentFW
     * @returns {Promise<[]>}
     */
    async ota_get_firmware_modules(currentFW): Promise<string[]> {
        let modules = [];
        let latest_fw_infos = await get_latest_fw_info('hosemonster', this.deviceName, this.currentFWVersion, this.channel,).catch((error) => {
            switch (error) {
                case ZeroByteErrorCodes.FIRMWARE_INDEX_UNAVAILABLE:
                    console.error('Unable to fetch the firmware index right now...',);
                    return modules;

                case ZeroByteErrorCodes.FIRMWARE_INDEX_LATEST_VERSION_UNKNOWN:
                    console.error('Unable to determine the latest version ...',);
                    return modules;
            }
        });

        if (latest_fw_infos.length > 0 && currentFW === latest_fw_infos[0].version) {
            console.log('Device already has latest available firmware version: ' + latest_fw_infos[0].version,);
            return modules;
        }

        for (let i = 0; i < latest_fw_infos.length; ++i) {
            let latest_fw_info = latest_fw_infos[i];
            console.log('Downloading ' + this.deviceName + ' FW Version: ' + latest_fw_info.version,);
            modules.push(await download_fw(latest_fw_info));
        }

        return modules;
    }

    /**
     * Loads the file at filePath into a Uint8Array instance
     *
     * @param filePath
     * @returns {Promise<Uint8Array>}
     */
    async ota_read_firmware_bytes(filePath): Uint8Array {
        console.log(`Getting stats for ${filePath}`);
        console.log(`Type of filePath: ${typeof filePath}`);
        let stats = await RNFetchBlob.fs.stat(`${filePath}`);

        let firmwareSize = stats.size;
        let firmwareBuffer = new ArrayBuffer(firmwareSize);
        let firmwareBytes = new Uint8Array(firmwareBuffer);
        let done = false;
        console.log(`Firmware bundle is ${firmwareSize} bytes.`);

        if (stats.size > 0) {
            RNFetchBlob.fs.readStream(filePath, 'ascii').then((stream) => {
                let bytesRead = 0;

                stream.open();
                stream.onError((err) => {
                    console.error(err);
                });
                stream.onData((chunk) => {
                    firmwareBytes.set(chunk, bytesRead);
                    bytesRead += chunk.length;
                    this.onProgress(bytesRead / firmwareSize);
                });
                stream.onEnd(() => {
                    console.log('Done reading firmware file from storage.');
                    done = true;
                });
            });

            while (!done) {
                await new Promise((r) => setTimeout(r, 100));
            }
        }

        console.log('Returning firmware bytes.');
        return firmwareBytes;
    }

    /**
     * Reads the firmware into an in-memory buffer and passes it along to ota_perform_device_update
     *
     * @param firmwarePath the local path on this device to the firmware bundle (these were downloaded previously)
     * @param skipReboot if true, skips rebooting the device -- useful when device was already in OTA, or when there are more than 1 update image to apply (don't reboot for 2nd image)
     * @param counts an array of two integers, index 0 representing the # of the current update, and index 1 being the total number of updates. Used for status messages
     * @returns {Promise<boolean>}
     */
    async ota_flash(firmwarePath, skipReboot?: boolean, counts?: number[],): Promise<boolean> {
        console.log('Flashing firmware at path: ' + firmwarePath);

        this.updateStatus('Reading firmware...');
        let firmwareBytes = await this.ota_read_firmware_bytes(firmwarePath);

        return this.ota_perform_device_update(this.peripheralId, firmwareBytes, skipReboot, counts,);
    }

    /**
     * This is a turn-key solution to apply the latest available firmware to the device.... it fetches the latest
     * available firmware posted to the update channel specified by this.channel for device. It applies each update
     * to the device in order with onProgress being called from 0 to 100 for each update individually.
     *
     * Return:
     *  1: success!
     *  0: error :(
     *  -1: no update!
     *
     * @returns {{result: Error}}
     */
    async ota_turnkey_firmware_update(): Promise<number> {
        DFUHandler.shouldCancel = false;

        this.updateStatus('Identifying firmware modules...');
        let firmwarePaths = await this.ota_get_firmware_modules(this.currentFWVersion);

        let result = true;
        let skipReboot = this.isInOTA;

        if (firmwarePaths.length === 0) {
            this.onProgress(100);
            return -1;
        }

        for (let i = firmwarePaths.length - 1; result && i >= 0; --i) {
            let firmwarePath = firmwarePaths[i];
            this.updateStatus('Beginning update (Step ' + (firmwarePaths.length - i) + ' of ' + firmwarePaths.length + ')...',);

            try {
                await this.bleManager.cancelDeviceConnection(this.peripheralId);
            } catch (error) {
                console.warn('You can safely ignore this if it is a BleError: device not connected error',);
                console.warn(error);
            }

            result &= await this.ota_flash(firmwarePath, skipReboot, [firmwarePaths.length - i, firmwarePaths.length,]).then((result) => {
                return new Promise((resolve) => {
                    console.log('Pausing for DFU Reboot after module installation...',);

                    // Wait 5 seconds for device to reboot...
                    this.updateStatus('Rebooting device...');
                    setTimeout(() => {
                        resolve(result);
                    }, 2500);
                });
            });

            skipReboot = true;
        }

        return result ? 1 : 0;
    }

    async ota_begin_upload_process(): Promise<> {
        let newValueBuffer = Buffer.alloc(1);
        newValueBuffer.writeUInt8(CTL_START);

        try {
            console.log('Sending CTL_START (0x00)');
            return this.bleManager
            .writeCharacteristicWithResponseForDevice(this.peripheralId, OTA_SERVICE, OTA_CONTROL_ATTRIBUTE, newValueBuffer.toString('base64'),)
            .then(() => {
                console.log('Waiting 1000ms after writing CTL_START');
                return new Promise((r) => setTimeout(r, 1000));
            })
            .catch((error) => {
                console.error(error);
            });
        } catch (error) {
            console.error(error);
        }
    }

    async ota_end_upload_process(): Promise<> {
        let doneBuffer = Buffer.alloc(1);
        let closeBuffer = Buffer.alloc(1);

        doneBuffer.writeUInt8(CTL_DONE);
        closeBuffer.writeUInt8(CTL_CLOSE);

        try {
            console.log('Sending CTL_END (0x03)');
            return this.bleManager
            .writeCharacteristicWithResponseForDevice(this.peripheralId, OTA_SERVICE, OTA_CONTROL_ATTRIBUTE, doneBuffer.toString('base64'),)
            .then(() => {
                console.log('Waiting 1000ms after writing CTL_END');
                return new Promise((r) => setTimeout(r, 1000));
            })
            .then(() => {
                console.log('Sending CTL_CLOSE (0x04)');
                return this.bleManager.writeCharacteristicWithoutResponseForDevice(this.peripheralId, OTA_SERVICE, OTA_CONTROL_ATTRIBUTE, closeBuffer.toString('base64'),);
            })
            .then(() => {
                console.log('Waiting 1000ms after writing CTL_CLOSE');
                return new Promise((r) => setTimeout(r, 1000));
            })
            .catch((error) => {
                console.error('HERE!');
                console.error(error + ' ::: ' + error.reason);

                this.bleManager.readCharacteristicForDevice(this.peripheralId, OTA_SERVICE, OTA_CONTROL_ATTRIBUTE)
                .then((c) => {
                    let b = new Buffer(c.value, 'base64');
                    console.error(b.readInt32LE());
                })

                return new Promise((r, f) => setTimeout(f, 1000));
            });
        } catch (error) {
            console.error('THERE!');
            console.error(error);
        }
    }

    async ota_perform_device_update(deviceId, firmwareBytes: Uint8Array, skip_reboot?: boolean, counts: number[]): Promise<boolean> {
        let totalBytesWritten = 0;

        try {
            this.updateStatus('Connecting to device...');
            try {
                await this.ota_connect_and_discover();
            } catch (error) {
                console.warn(error);
            }

            console.log("Initiating update sequence...");
            if (!skip_reboot) {
                this.updateStatus('Restarting to DFU...');
                await this.ota_reboot_device_into_dfu();
                await this.ota_connect_and_discover();
            } else {
                console.log('Skipping reboot, we expect the device is already in DFU mode. Should add a check here for safety...')
            }

            // Send the CTL_START (0x00) command
            await this.ota_begin_upload_process();

            // Reset the progress indicator in the application
            this.onProgress(0.0);

            // Set a status message ...
            let message = 'Flashing firmware';
            if (counts) {
                message += ' (Update ' + counts[0] + ' of ' + counts[1] + ')';
            }
            message += '...';
            this.updateStatus(message);

            // Upload the image to the device...
            totalBytesWritten = await this.ota_write_firmware_to_device_in_dfu(deviceId, Array.from(firmwareBytes));

            // Arbitrary delay that we probably don't actually need ... I think this was added for UX purposes so we could
            // observe the 100% status.
            await new Promise((r) => setTimeout(r, 1000));

            // Send the CTL_END (0x03) and CTL_CLOSE (0x04) commands to the device
            await this.ota_end_upload_process();

            // Disconnect from the device -- triggers a reboot on disconnect.
            //  Note, for 2-part updates, after applying the first part (the 'apploader'), the device will
            //  automatically reboot back into DFU mode. After the second part, it'll reboot back into normal
            //  operating mode. (hopefully...)
            await this.bleManager.cancelDeviceConnection(this.peripheralId);
        } catch (error) {
            console.error('An unexpected error occurred in ota_perform_device_update ... ' + error,);
        }

        return totalBytesWritten === firmwareBytes.length;
    }

    async ota_reboot_device_into_dfu() {
        let newValueBuffer = Buffer.alloc(1);
        newValueBuffer.writeUInt8(CTL_START);

        try {
            await this.bleManager.writeCharacteristicWithResponseForDevice(this.peripheralId, OTA_SERVICE, OTA_CONTROL_ATTRIBUTE, newValueBuffer.toString('base64'))
            await this.bleManager.cancelDeviceConnection(this.peripheralId);
        } catch (error) {
            console.error('Error occurred rebooting into DFU: ' + error);
            await this.bleManager.cancelDeviceConnection(this.peripheralId);
        }

        return new Promise((resolve) => setTimeout(resolve, 1000));
    }

    async ota_connect_and_discover(): Promise<> {
        return new Promise((resolve) => setTimeout(resolve, 1000))
        .then(() => {
            console.log('Attempting to connect.');
            return this.bleManager.connectToDevice(this.peripheralId, {
                requestMTU: 245,
            });
        })
        .then((device) => {
            console.log('Attempting to discover services and characteristics.');
            return device.discoverAllServicesAndCharacteristics();
        })
        .then((device) => {
            console.log('Requesting MTU ' + this.REQUEST_MTU);
            return this.bleManager.requestMTUForDevice(device.id, this.REQUEST_MTU);
        })
        .then((device) => {
            console.log('Negotiated MTU: ' + device.mtu + '; setting BLOCK_SIZE = ' + (device.mtu - 8),);
            this.BLOCK_SIZE = device.mtu - 8;
            return device;
        })
        .catch((error) => {
            console.warn('Error occurred during ota_connect_and_discover -- probably because we were already connected... ignoring: ' + error,);
        });
    }

    async ota_write_firmware_to_device_in_dfu(deviceId, bytes: Array): Promise<number> {
        let index = 0;
        let bytesWritten = 0;
        let currentSlice = bytes.slice(index, index + this.BLOCK_SIZE);

        while (currentSlice.length > 0) {
            let currentData = Buffer.from(currentSlice).toString('base64');
            // console.trace('Current slice index: ' + index + ', length: ' + Math.min(this.BLOCK_SIZE, currentSlice.length));

            let block_success = false;
            let block_first_attempt = true;

            while (block_first_attempt && !block_success) {
                try {
                    await this.bleManager
                    .writeCharacteristicWithoutResponseForDevice(this.peripheralId, OTA_SERVICE, OTA_DATA_ATTRIBUTE, currentData,);

                    block_success = true;
                    // console.log("wrote block...");
                    if (!block_first_attempt) {
                        console.log('Writing slice at index ' + index + ' succeeded on retry.',);
                    }
                } catch (error) {
                    const log_method = block_first_attempt ? console.warn : console.error;
                    log_method('Error writing current slice at index ' + index + ': ' + error);

                    if (!block_first_attempt) {
                        throw error;
                    }

                    block_first_attempt = false;
                }
            }

            index += this.BLOCK_SIZE;
            bytesWritten += Math.min(currentSlice.length, this.BLOCK_SIZE);
            currentSlice = currentSlice = bytes.slice(index, index + this.BLOCK_SIZE);

            this.onProgress(bytesWritten / bytes.length);
        }

        this.onProgress(1);
        return bytesWritten;
    }
}

