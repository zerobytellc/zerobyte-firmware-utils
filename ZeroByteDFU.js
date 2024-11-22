import RNFetchBlob from 'rn-fetch-blob';
import {Platform} from 'react-native';
import {BleManager} from 'react-native-ble-plx';
import {download_fw, get_latest_fw_info} from "./ZeroByteFirmwareUtils";
import {ZeroByteErrorCodes} from "./ZeroByteErrorCodes";

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

export const OTA_SUCCESS = 1;
export const OTA_FAILURE = 0;
export const OTA_NOUPDATE = -1;

const REBOOT_DELAY_MS = 2500;

let logTrace = (message: string, payload: any) => {
    if ( payload )
        console.trace(message, payload);
    else
        console.trace(message);
}

let logInfo = (message: string, payload: any) => {
    if ( payload )
        console.log(message, payload);
    else
        console.log(message);
}

let logWarning = (message: string, payload: any) => {
    if ( payload )
        console.warn(message, payload);
    else
        console.warn(message);
}

let logError = (message: string, payload: any) => {
    if ( payload )
        console.error(message, payload);
    else
        console.error(message);
}

export function setDFULoggers( infoLogger: (message: string, payload: any)=>void,
                               warnLogger: (message: string, payload: any)=>void,
                               errorLogger: (message: string, payload: any)=>void,
                               traceLogger: (message: string, payload: any)=>void ) {
    logInfo = infoLogger;
    logWarning = warnLogger;
    logError = errorLogger;
    logTrace = traceLogger;
}

/**
 * Turn-key DFU method ... checks for new firmware, downloads the images, and flashes them onto the device.
 *
 * This method ALWAYS applies the latest available firmware to the device. If the latest firmware version in the update
 * channel matches currentFWVersion, no action is taken.
 *
 * @param peripheralId The device.id of the device to update
 * @param bleManager The initialized BleManager instance from the application
 * @param clientName The name of the client. @see ZeroByteFW.get_latest_fw_info for details
 * @param deviceName The device's hardware identifier ... @see ZeroByteFW.get_latest_fw_info for details
 * @param channel The firmware update channel from which the index.json is retrieved (e.g. "prod", "beta", "alpha" or "dev"). @see ZeroByteFW.get_latest_fw_info for details
 * @param currentFWVersion optional (default: undefined). The current FW version used on the device. @see ZeroByteFW.get_latest_fw_info for details
 * @param url_base the url_base from which to obtain firmware indices. @see ZeroByteFW.get_latest_fw_info for details
 * @param isInOTA optional (default: false). Set to true if the device is already in DFU mode prior to the update.
 * @param onDone callback invoked after DFU has completed: (string)=>void
 * @param onProgress callback invoked repeatedly throughout the DFU process: (number)=>void where number = percent complete
 * @param updateStatus callback invoked to pass a status message to the application for display: (string)=>void
 */
export function startDFU(peripheralId, bleManager, clientName, deviceName, channel, currentFWVersion = undefined, url_base=undefined, isInOTA = false, onDone, onProgress, updateStatus) {
    logInfo('Starting firmware update for ' + peripheralId + " - " + deviceName);

    // We're really just wrapping DFUHandler in a convenient package here ...
    // all the work starts in ota_update_firmware.
    let dfu = new DFUHandler(peripheralId, bleManager, clientName, deviceName, channel, currentFWVersion, url_base, isInOTA, updateStatus, onProgress);
    dfu.ota_turnkey_firmware_update().then((status) => {
        logTrace('Got status: ' + status);
        let message;
        switch (status) {
            case OTA_FAILURE:
                message = 'Update failed...';
                break;
            case OTA_NOUPDATE:
                message = 'No update available...';
                break;
            case OTA_SUCCESS:
                message = 'Update completed successfully...';
                break;
            default:
                message = 'Unexpected result from firmware update. Please contact support.';
                break;
        }

        onDone(message);
    });
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
     * @param clientName The client name
     * @param deviceName The device model name (e.g. "arcus", "kraken"...)
     * @param channel The update channel to use (e.g. "prod", "beta", "alpha" or "dev")
     * @param currentFWVersion The current firmware version on the device we're updating. Used to determine if the latest available is already applied. May be undefined.
     * @param url_base The url_base from which to retrieve firmware indices
     * @param isInOTA Defaults to false. Set to true if you're calling this for a peripheral that is already in DFU mode.
     * @param updateStatus A callback with signature (string)=>void, used to send status messages to the app for display to the user...
     * @param onProgress A callback with signature (number)=>void, used to send progress updates to the app for display to the user...
     **/
    constructor(peripheralId, bleManager, clientName, deviceName, channel, currentFWVersion, url_base, isInOTA, updateStatus, onProgress) {
        this.peripheralId = peripheralId;
        this.bleManager = bleManager;
        this.clientName = clientName;
        this.deviceName = deviceName;
        this.updateStatus = updateStatus;
        this.channel = channel;
        this.currentFWVersion = currentFWVersion;
        this.url_base = url_base;
        this.isInOTA = isInOTA;
        this.onProgress = onProgress;
    }

    /**
     * Obtains the array of firmware modules that need to be applied to the device
     *
     * @param currentFW
     * @returns {Promise<[]>}
     */
    async ota_get_firmware_modules(): Promise<string[]> {
        let modules = [];
        let latest_fw_infos = await get_latest_fw_info(this.clientName, this.deviceName, this.currentFWVersion, this.channel, this.url_base).catch((error) => {
            switch (error) {
                case ZeroByteErrorCodes.FIRMWARE_INDEX_UNAVAILABLE:
                    logError('Unable to fetch the firmware index right now...',);
                    return modules;

                case ZeroByteErrorCodes.FIRMWARE_INDEX_LATEST_VERSION_UNKNOWN:
                    logError('Unable to determine the latest version ...',);
                    return modules;
            }
        });

        if ( latest_fw_infos === undefined ) {
            logInfo("Unable to obtain firmware information" );
            return modules;
        }

        if (latest_fw_infos.length > 0 && this.currentFWVersion === latest_fw_infos[0].version) {
            logInfo('Device already has latest available firmware version: ' + latest_fw_infos[0].version,);
            return modules;
        }
        this.updateStatus("Applying updates..." )

        for (let i = 0; i < latest_fw_infos.length; ++i) {
            let latest_fw_info = latest_fw_infos[i];
            let message ='Downloading ' + this.deviceName + ' FW Version: ' + latest_fw_info.version;
            logInfo(message)
            this.updateStatus(message)
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
        logInfo(`Getting stats for ${filePath}`);
        logInfo(`Type of filePath: ${typeof filePath}`);
        let stats = await RNFetchBlob.fs.stat(`${filePath}`);

        let firmwareSize = stats.size;
        let firmwareBuffer = new ArrayBuffer(firmwareSize);
        let firmwareBytes = new Uint8Array(firmwareBuffer);
        let done = false;
        logInfo(`Firmware bundle is ${firmwareSize} bytes.`);

        if (stats.size > 0) {
            RNFetchBlob.fs.readStream(filePath, 'ascii').then((stream) => {
                let bytesRead = 0;

                stream.open();
                stream.onError((err) => {
                    logError(err);
                });
                stream.onData((chunk) => {
                    firmwareBytes.set(chunk, bytesRead);
                    bytesRead += chunk.length;
                    this.onProgress(bytesRead / firmwareSize);
                });
                stream.onEnd(() => {
                    logInfo('Done reading firmware file from storage.');
                    done = true;
                });
            });

            while (!done) {
                await this.ota_delay(100);
            }
        }

        logInfo('Returning firmware bytes.');
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
        logInfo('Flashing firmware at path: ' + firmwarePath);
        this.updateStatus('Reading firmware...');

        let firmwareBytes = await this.ota_read_firmware_bytes(firmwarePath);
        let result = await this.ota_perform_device_update(this.peripheralId, firmwareBytes, skipReboot, counts,)
        if ( false === result ) {
            logInfo("Unexpected error occurred ... cancelling connection to the device and attempting to retry...");
            await this.bleManager.cancelDeviceConnection(this.peripheralId);
            await this.ota_delay(REBOOT_DELAY_MS);
            result = await this.ota_perform_device_update(this.peripheralId, firmwareBytes, skipReboot, counts,);
        }

        return result;
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
        let firmwarePaths = await this.ota_get_firmware_modules();
        if (firmwarePaths.length === 0) {
            this.onProgress(100);
            return -1;
        }

        let result = true;
        let skipReboot = this.isInOTA;
        this.updateStatus('Obtained firmware modules...');

        for (let i = firmwarePaths.length - 1; result && (i >= 0); --i) {
            let firmwarePath = firmwarePaths[i];
            this.updateStatus('Beginning update (Step ' + (firmwarePaths.length - i) + ' of ' + firmwarePaths.length + ')...',);

            try {
                await this.bleManager.cancelDeviceConnection(this.peripheralId);
            } catch (error) {
                logWarning('You can safely ignore this if it is a BleError: device not connected error',);
                logWarning(error);
            }

            result &&= await this.ota_flash(firmwarePath, skipReboot, [firmwarePaths.length - i, firmwarePaths.length,]);

            logInfo('Pausing for reboot after module installation...');
            this.updateStatus('Waiting for device to reboot...');
            await this.ota_delay(REBOOT_DELAY_MS);

            // Device will automatically load into DFU mode after the first update of a
            // two-part update.
            skipReboot = true;
        }

        return result ? 1 : 0;
    }

    async ota_write_start_command_to_control(): Promise<boolean> {
        let newValueBuffer = Buffer.alloc(1);
        newValueBuffer.writeUInt8(CTL_START);

        let result = false;

        try {
            logInfo('Sending CTL_START (0x00)');
            await this.bleManager
                .writeCharacteristicWithResponseForDevice(this.peripheralId, OTA_SERVICE, OTA_CONTROL_ATTRIBUTE, newValueBuffer.toString('base64'));
            result = true;

            await this.ota_one_second_delay();
        } catch (error) {
            logError(error);
        }

        return result;
    }

    async ota_end_upload_process(): Promise<> {
        let doneBuffer = Buffer.alloc(1);
        let closeBuffer = Buffer.alloc(1);

        doneBuffer.writeUInt8(CTL_DONE);
        closeBuffer.writeUInt8(CTL_CLOSE);

        let result = false;

        try {
            logInfo('Sending CTL_END (0x03)');
            await this.bleManager
                .writeCharacteristicWithResponseForDevice(this.peripheralId, OTA_SERVICE, OTA_CONTROL_ATTRIBUTE, doneBuffer.toString('base64'));
            await this.ota_one_second_delay();

            logInfo('Sending CTL_CLOSE (0x04)');
            await this.bleManager
                .writeCharacteristicWithoutResponseForDevice(this.peripheralId, OTA_SERVICE, OTA_CONTROL_ATTRIBUTE, closeBuffer.toString('base64'));
            await this.ota_one_second_delay();

            result = true;
        } catch (error) {
            logError('THERE!');
            logError(error);
        }

        return result;
    }

    async ota_confirm_device_in_dfu(): Promise<boolean> {
        let result = false
        await this.bleManager.readCharacteristicForDevice(
            this.peripheralId,
            OTA_SERVICE,
            GECKO_BOOTLOADER_VERSION
        ).then((characteristic) => {
            let b = new Buffer(characteristic.value, 'base64');
            logInfo("Read Gecko Bootloader Version: " + b.toString());
            result = true;
            return b.toString();
        }).catch((error) => {
            logError("Error confirming device in DFU: " + error);
            result = false;
        });

        return result;
    }

    async ota_perform_device_update(deviceId, firmwareBytes: Uint8Array, skip_reboot?: boolean, counts: number[]): Promise<boolean> {
        let totalBytesWritten = 0;
        let proceed = true;

        try {
            this.updateStatus('Connecting to device...');
            proceed &&= await this.ota_connect_and_discover();
            if ( !proceed ) {
                logError("Failed to establish initial connection to device...");
                return false;
            }

            logInfo("Initiating update sequence...");
            if ( skip_reboot && await this.ota_confirm_device_in_dfu() ) {
                logInfo("Confirmed device is in DFU, skipping reboot.")
            } else {
                this.updateStatus('Restarting to DFU...');
                proceed = await this.ota_reboot_device_into_dfu();
                if ( !proceed ) {
                    logError("Failed to reboot the device into DFU mode");
                    return false;
                }

                // Re-establish connection after reboot ..
                proceed &&= await this.ota_connect_and_discover();
                proceed &&= await this.ota_confirm_device_in_dfu();

                if ( !proceed ) {
                    logError("Failed to reboot the device into DFU mode");
                    return false;
                }
            }

            // Reset the progress indicator and send a status message to the application:
            let message = 'Flashing firmware';
            if (counts) {
                message += ' (Update ' + counts[0] + ' of ' + counts[1] + ')';
            }
            message += '...';

            this.onProgress(0.0);
            this.updateStatus(message);
            logInfo(message);

            // Upload the image to the device...
            totalBytesWritten = await this.ota_write_firmware_to_device_in_dfu(deviceId, Array.from(firmwareBytes));

            // The device is supposed to initiate the disconnect after we write 0x04 to the control
            // attribute, which is done at the end of ota_write_firmware_to_device_in_dfu, but in practice
            // we do not see that consistently. Canceling the connection here as a safety. The disconnect,
            // regardless of where it is initiated, triggers the device reboot.
            await this.bleManager.cancelDeviceConnection(this.peripheralId);
        } catch (error) {
            logError('An unexpected error occurred in ota_perform_device_update ... ' + error,);
        }

        return (totalBytesWritten === firmwareBytes.length);
    }

    // await this method for a 1 second delay...
    // Note -- we originally inserted delays all over the place very early in
    //         development ... they are almost certainly not needed, our async/awaits
    //         were a disaster back then.
    //
    //         @todo: remove calls to this method and test OTA without the delays.
    async ota_one_second_delay() {
        return this.ota_delay(1000);
    }

    async ota_delay(delay_ms: number) {
        return new Promise((resolve) => setTimeout(resolve, delay_ms));
    }

    async ota_reboot_device_into_dfu() {
        let newValueBuffer = Buffer.alloc(1);
        newValueBuffer.writeUInt8(CTL_START);

        let result = false;

        try {
            await this.bleManager.writeCharacteristicWithResponseForDevice(this.peripheralId, OTA_SERVICE, OTA_CONTROL_ATTRIBUTE, newValueBuffer.toString('base64'))
            await this.bleManager.cancelDeviceConnection(this.peripheralId);
            result = true;
        } catch (error) {
            logError('Error occurred rebooting into DFU: ' + error);
            await this.bleManager.cancelDeviceConnection(this.peripheralId);
        }

        await this.ota_one_second_delay();
        return result;
    }

    /**
     * Attempts to establish a connection to the device with MTU = this.REQUEST_MTU
     *
     * Upon successful connection, we will also discover all services and characteristics to
     * refresh the gatt db for this device.
     *
     * @returns {Promise<void>}
     */
    async ota_connect_and_discover(): Promise<boolean> {
        let result = false;
        try {
            await this.ota_one_second_delay();

            if (await this.bleManager.isDeviceConnected(this.peripheralId)) {
                logInfo("Already connected to device ... ");
            } else {
                logInfo("Connecting to device ...");
                await this.bleManager.connectToDevice(this.peripheralId, {
                    requestMTU: this.REQUEST_MTU,
                });

                logInfo('Attempting to discover services and characteristics.');
                await this.bleManager.discoverAllServicesAndCharacteristicsForDevice(this.peripheralId);
            }

            // May be a redundant MTU request ... but we need the dev instance to get the
            // the actual negotiated mtu anyway...
            let dev = await this.bleManager.requestMTUForDevice(this.peripheralId, this.REQUEST_MTU);

            // We transfer (mtu-8) bytes per block.
            this.BLOCK_SIZE = (dev.mtu > 8) ? (dev.mtu - 8) : 1;
            result = true;
        } catch ( error ) {
            logError("An error occurred during ota_connect_and_discover: " + error);
        }

        return result;
    }

    async ota_write_firmware_to_device_in_dfu(deviceId, bytes: Array): Promise<number> {
        let index = 0;
        let bytesWritten = 0;
        let currentSlice = bytes.slice(index, index + this.BLOCK_SIZE);

        if ( ! await this.ota_write_start_command_to_control() )
            return 0;

        logInfo("Writing firmware: " + bytes.length + " bytes.");
        while (currentSlice.length > 0) {
            let currentData = Buffer.from(currentSlice).toString('base64');
            // logTrace('Current slice index: ' + index + ', length: ' + Math.min(this.BLOCK_SIZE, currentSlice.length));

            await this.bleManager
                .writeCharacteristicWithoutResponseForDevice(this.peripheralId, OTA_SERVICE, OTA_DATA_ATTRIBUTE, currentData,)
                .catch((error) => {
                    logError("Error uploading firmware to device: " + error);
                    return bytesWritten;
                });

            index += this.BLOCK_SIZE;
            bytesWritten += Math.min(currentSlice.length, this.BLOCK_SIZE);
            currentSlice = currentSlice = bytes.slice(index, index + this.BLOCK_SIZE);

            this.onProgress(bytesWritten / bytes.length);
        }

        // Arbitrary delay that we probably don't actually need ... I think this was added for UX purposes so we could
        // observe the 100% status.
        await this.ota_one_second_delay();

        // Send the CTL_END (0x03) and CTL_CLOSE (0x04) commands to the device
        if ( ! await this.ota_end_upload_process() )
            return 0;

        this.onProgress(1);
        return bytesWritten;
    }
}

