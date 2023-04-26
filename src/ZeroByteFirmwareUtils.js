import RNFetchBlob from 'rn-fetch-blob';
import {Platform} from 'react-native';
const Buffer = require('buffer/').Buffer;

const url_base = 'https://static.zerobytellc.com/firmware';
const url_index_file = 'index.json';

/**
 * Retrieves the current firmware index for the specified client. Returns the json response object.
 *
 * @param {string} client_name The name of the client, e.g.: hosemonster
 * @return {Promise<JSON>}     The response describing available firmware versions for this client.
 */
async function zbl_retrieve_fw_index(client_name): Promise<JSON> {
  const indexUrl = `${url_base}/${client_name}/${url_index_file}`;
  console.log(`Retrieving firmware index for ${client_name} from: ${indexUrl}`);
  return fetch(indexUrl, {method: 'GET'})
      .then((response) => response.json());
}

/**
 * Downloads the firmware from the given url and stores it in the applications local file cache. Returns
 * the path to the firmware bundle.
 *
 * @param fw_url {string} The URL to the firmware bundle to download
 * @returns {Promise<string>} The local file path to the downloaded firmware
 */
async function zbl_download_fw(fw_url): Promise<string> {
  return RNFetchBlob.config({
    // add this option that makes response data to be stored as a file,
    // this is much more performant.
    fileCache: true,
    appendExt: 'gbl',
  })
      .fetch('GET', fw_url)
      .then((res) => {
        console.log('Downloaded to: ' + res.path());
        return RNFetchBlob.fs.stat(res.path());
      })
      .then((stats) => {
        console.log(JSON.stringify(stats));
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
 * @param {string} client_name The name of the client, e.g.: 'hosemonster'
 * @param {string} device_name The name of the device, e.g.: 'kraken' or 'arcus'
 * @param {string} current_fw_version (optional) The current firmware version in use, e.g.: '20220101.abc123f'
 * @return {Array<string>} A list of paths to firmware updates, which must be applied in order.
 */
async function zbl_get_latest_fw_urls(client_name, model_name, current_fw_version = undefined): Promise<string[]> {
  let fw_index = await zbl_retrieve_fw_index(client_name);

  if (!fw_index.hasOwnProperty(model_name)) {
    console.log("WARN: No fw index data for device type: " + model_name);
    return [];
  }

  let urls = [];
  let latest_fw_version = fw_index[model_name].latest;

  if (current_fw_version !== latest_fw_version) {
    let fw_url = fw_index[model_name][latest_fw_version].url;
    console.log(`Required FW URL: ${fw_url}`)
    urls.push(fw_url);
  }

  return urls;
}

/**
 * Downloads the firmware updates at the given URLs to the device's temporary storage. Returns a list of local paths
 * in the same order.
 *
 * @param urls {Array} The URLs to download
 * @returns {Promise<string[]>} Returns an array of local file paths for each downloaded url.
 */
async function zbl_download_firmware_bundles(urls): Promise<string[]> {
  let paths = [];

  for ( let i = 0; i < urls.length; ++i ) {
    paths.push(await zbl_download_fw(urls[i]));
  }

  return paths;
}

export { zbl_get_latest_fw_urls, zbl_retrieve_fw_index, zbl_download_fw }
