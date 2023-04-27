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

/*
 * NOTE -- these URLs are subject to change ... DO NOT USE outside of this library.
 */
const url_base = 'https://static.zerobytellc.com/firmware';
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
 */

/**
 * Retrieves the current firmware index for the specified client. Returns the json response object.
 *
 * @param {string} client_name The name of the client, e.g.: hosemonster
 * @returns {Promise<FirmwareIndex>}     The response describing available firmware versions for this client.
 */
async function retrieve_fw_index(client_name) {
  const indexUrl = `${url_base}/${client_name}/${url_index_file}`;
  return fetch(indexUrl, {method: 'GET'})
      .then((response) => response.json());
}

/**
 * Downloads the firmware from the given url and stores it in the applications local file cache. Returns
 * the path to the firmware bundle.
 *
 * @param fw_info {object}    The firmware information returned by get_latest_fw_info
 * @returns {Promise<string>} The local file path to the downloaded firmware
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
        console.log('Downloaded to: ' + res.path());
        return RNFetchBlob.fs.stat(res.path());
      })
      .then((stats) => {
        console.log('Downloaded %s firmware version %s to: %s', fw_info.name, fw_info.version, stats.path);
        return `${stats.path}`;
      });
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
 * @param {string} device_name        The name of the device, e.g.: 'kraken' or 'arcus'
 * @param {string} current_fw_version (optional) The current firmware version in use, e.g.: '20220101.abc123f'
 * @return {Promise<FirmwareInfo>}    A list of updates available for this device.
 */
async function get_latest_fw_info(client_name, model_name, current_fw_version = undefined) {
  let fw_index = await retrieve_fw_index(client_name);

  if (!fw_index.hasOwnProperty(model_name)) {
    console.log("WARN: No fw index data for device type: " + model_name);
    return [];
  }

  let infos = [];
  let latest_fw_version = fw_index[model_name].latest;

  if (current_fw_version !== latest_fw_version) {
    let info = fw_index[model_name][latest_fw_version];
    info['version'] = latest_fw_version;

    // Figure out how to encode the pre-req bundles and push their info here.

    infos.push(info);
  } else {
    console.log('%s firmware version %s is already up to date.', model_name, current_fw_version);
  }

  return infos;
}


export { get_latest_fw_info, retrieve_fw_index, download_fw }
