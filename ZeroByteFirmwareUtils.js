/*
 * ZeroByteFirmwareUtils.js
 *
 * Copyright (c) 2023 Zero Byte LLC, All Rights Reserved
 * Licensed under CC BY-ND 4.0 (https://creativecommons.org/licenses/by-nd/4.0/)
 *
 * Methods for checking for device firmware updates for IoT Devices designed by Zero Byte LLC.
 *
 * SPDX-License-Identifier: CC-BY-ND-4.0
 * SPDX-FileCopyrightText: Copyright (c) 2023 Zero Byte LLC (hello@zerobytellc.com) All Rights Reserved
 *
 * @author Timothy C Sweeney-Fanelli, Zero Byte LLC (tim@zerobytellc.com)
 */

import RNFetchBlob from 'rn-fetch-blob';
import {Platform} from 'react-native';
const Buffer = require('buffer/').Buffer;

import {ZeroByteErrorCodes} from './ZeroByteErrorCodes';

/*
 * NOTE -- these URLs are subject to change ... DO NOT USE outside of this library.
 */
const default_url_base = 'https://firmware.zerobytellc.com/firmware';
const url_index_file = 'index.json';

/**
 * Lists all the {@link DeviceFirmware} available for each kind of known device.
 *
 * @example
 * {
 *   "device_1": {
 *     "latest": "20220101.abcdef1",
 *     "20220101.abcdef1": {
 *       "name": "device_1_appfw",
 *       "url": "https://someweb.site/device_1_appfw_abcdef1.gbl",
 *       "md5": "47ece1b4cc60e33d5b55e12101da1de0"
 *     },
 *     "20210615.123456a": {
 *       "name": "device_1_appfw",
 *       "url": "https://someweb.site/device_1_appfw_123456a.gbl",
 *       "md5": "47ece1b4cc60e33d5b55e12101da1de0"
 *     }
 *   },
 *   "device_2": {
 *     "latest": "20220101.abcdef1",
 *     "20220101.abcdef1": {
 *       "name": "device_1_appfw",
 *       "url": "https://someweb.site/device_2_appfw_abcdef1.gbl",
 *       "md5": "47ece1b4cc60e33d5b55e12101da1de0"
 *     },
 *   }
 * }
 * @typedef FirmwareIndex
 * @property {DeviceFirmware} * The DeviceFirmware corresponding to the device type `model_token`.
 */

/**
 * Lists all the {@link FirmwareInfo} available for download, and identifies the latest version.
 *
 * @example
 * {
 *  "latest": "20220101.abcdef1",
 *  "20220101.abcdef1": {
 *    "name": "device_1_appfw",
 *    "url": "https://someweb.site/device_1_appfw_abcdef1.gbl",
 *    "md5": "47ece1b4cc60e33d5b55e12101da1de0"
 *  },
 *  "20210615.123456a": {
 *    "name": "device_1_appfw",
 *    "url": "https://someweb.site/device_1_appfw_123456a.gbl",
 *    "md5": "47ece1b4cc60e33d5b55e12101da1de0"
 *  }
 * }
 * @typedef DeviceFirmware
 * @property {string} latest The latest version number
 * @property {FirmwareInfo} * The FirmwareInfo corresponding to firmware version. There may be 0 or more of these present.
 */

/**
 * Describes a single firmware bundle available for download.
 *
 * @example
 * {
 *    "name": "device_1_appfw",
 *    "url": "https://someweb.site/device_1_appfw_versionstring.gbl",
 *    "md5": "47ece1b4cc60e33d5b55e12101da1de0"
 * }
 * @typedef FirmwareInfo
 * @property {string} name the firmware name
 * @property {string} url the url to download the firmware
 * @property {string} md5 the md5 sum of the firmware
 * @property {string} apploader the name of the FirmwareInfo entry for the AppLoader required for this FW (optional)
 */

/**
 * @typedef FirmwareDetails
 * @extends FirmwareInfo
 * @property {string} version the firmware version string
 */

/**
 * Retrieves the current firmware index for the specified client. Returns the json response object.
 *
 * @param {string} client_name        The name of the client, e.g.: hosemonster
 * @param {string} channel            The release channel. Defaults to 'prod' which is the default production release channel
 * @param {string} url_base           The base_url for the index lookup. Index should be found at {base_url}/{client_name}/{channel}/index.json
 * @returns {Promise<FirmwareIndex>}  The response describing available firmware versions for this client.
 * @throws {ZeroByteErrorCodes}       Codes 1000-1999 indicate errors with the firmware index.
 */
async function _retrieve_fw_index(client_name, channel = 'prod', url_base=default_url_base) {
    let indexUrl = `${url_base}/${client_name}` ;
    if ( channel === undefined ) {
        indexUrl += `/${url_index_file}`;
    } else {
        indexUrl += `/${channel}/${url_index_file}`
    }

    console.log(`Firmware Index URL: ${indexUrl}`);

    let response = await fetch(indexUrl, {method: 'GET', cache: 'no-cache'});
    if (!response.ok) {
        console.log('ZeroByteFW ERROR: Got HTTP Status Code %d retrieving firmware index', response.status);
        console.log(JSON.stringify(response.json()));
        throw ZeroByteErrorCodes.FIRMWARE_INDEX_UNAVAILABLE;
    }

    let responseData;
    try {
        responseData = response.json();
    } catch ( error ) {
        console.log('ZeroByteFW ERROR: Could not parse Firmware Index as JSON: %s', error);
        throw ZeroByteErrorCodes.FIRMWARE_INDEX_MALFORMED;
    }

    return responseData;
}

/**
 * Downloads the firmware from the given url and stores it in the applications local file cache. Returns
 * the path to the firmware bundle.
 *
 * @param fw_info {object}      The firmware information returned by get_latest_fw_info
 * @returns {Promise<string>}   The local file path to the downloaded firmware
 * @throws {ZeroByteErrorCodes} Codes 2000-2999 indicate errors with the firmware bundles
 */
async function download_fw(fw_info) {
    return RNFetchBlob.config({
        // add this option that makes response data to be stored as a file,
        // this is much more performant.
        fileCache: true,
        appendExt: 'gbl',
    })
        .fetch('GET', fw_info.url)
        .then((res) => {
            console.log(JSON.stringify(res.respInfo));
            if (res.respInfo.status !== 200) {
                console.log('ZeroByteFW ERROR: Got HTTP Status Code %d retrieving firmware bundle', res.status);
                throw ZeroByteErrorCodes.FIRMWARE_BUNDLE_UNAVAILABLE;
            }

            return RNFetchBlob.fs.stat(res.path());
        })
        .then((stats) => {
            console.log('Downloaded %s firmware version %s to: %s', fw_info.name, fw_info.version, stats.path);
            return `${stats.path}`;
        })
        .catch((error) => {
            console.log("ZeroByteFW ERROR: %s", error);
            throw ZeroByteErrorCodes.UNKNOWN_ERROR;
        })
}

/**
 * Obtains a list of URLs for firmware updates to apply to the device. It is possible that a firmware update is
 * comprised of multiple parts, in which case more than URL will be returned. Apply the firmware updates to the device
 * in the order returned.
 *
 * If current_fw_version is specified and is the same as the currently available firmware, then an empty list is
 * returned indicating no newer updates are available.
 *
 * @param {string} client_name        The name of the client, e.g.: 'hosemonster'
 * @param {string} model_name        The name of the device, e.g.: 'kraken' or 'arcus'
 * @param {string} current_fw_version (optional) The current firmware version in use, e.g.: '20220101.abc123f'
 * @param {string} channel            (optional) The firmware release channel. Defaults to 'prod', which is the default production release channel name.
 * @param {string} url_base           (optional) The base URL for firmware deployments. This module expects to find the firmware index published at "${url_base}/${client_name}/${module_name}/${channel}/index.json". Defaults to https://static.zerobytellc.com/firmware
 * @return {Promise<FirmwareDetails>} A list of updates available for this device.
 * @throws {ZeroByteErrorCodes}       An error code if something has gone wrong. See {@link ZeroByteErrorCodes}
 */
async function get_latest_fw_info(client_name, model_name, current_fw_version = undefined, channel = 'prod', url_base = undefined) {
    if ( url_base === undefined )
        url_base = default_url_base;

    let fw_index = await _retrieve_fw_index(client_name, channel, url_base);
    if (!fw_index.hasOwnProperty(model_name)) {
        console.log('ZeroByteFW ERROR: Requesting firmware update for unknown device: %s', model_name);
        throw ZeroByteErrorCodes.FIRMWARE_INDEX_DEVICE_UNKNOWN;
    }

    let model_infos = fw_index[model_name];

    let latest_fw_version;
    if (!model_infos.hasOwnProperty('latest')) {
        let versions = Object.keys(model_infos);

        // If there's only one version given, let's just assume it's the latest.
        // Otherwise, we can probably sort by date? But for now let's just give up.
        if ( versions.length > 1 )
            throw ZeroByteErrorCodes.FIRMWARE_INDEX_LATEST_VERSION_UNKNOWN;

        latest_fw_version = Object.keys(model_infos)[0];
    } else {
        latest_fw_version = model_infos.latest;
    }

    let infos = [];
    if (current_fw_version !== latest_fw_version) {
        let info = model_infos[latest_fw_version];
        info['version'] = latest_fw_version;

        infos.push(info);

        if (info.hasOwnProperty('apploader')) {
            let apploader_version = info.apploader;
            console.log('App firmware %s requires apploader %s. Adding to update list', latest_fw_version, apploader_version);

            let apploader_info = model_infos[apploader_version];
            infos.push(apploader_info)
        }

    } else {
        console.log('%s firmware version %s is already up to date.', model_name, current_fw_version);
    }

    console.log(infos)
    return infos;
}


export { get_latest_fw_info, download_fw }
