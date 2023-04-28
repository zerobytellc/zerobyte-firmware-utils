/*
 * ZeroByteErrorCodes.js
 *
 * Copyright (c) 2023 Zero Byte LLC, All Rights Reserved
 * Licensed under CC BY-ND 4.0 (https://creativecommons.org/licenses/by-nd/4.0/)
 *
 * Error codes.
 *
 * SPDX-License-Identifier: CC-BY-ND-4.0
 * SPDX-FileCopyrightText: Copyright (c) 2023 Zero Byte LLC (hello@zerobytellc.com) All Rights Reserved
 *
 * @author Timothy C Sweeney-Fanelli, Zero Byte LLC (tim@zerobytellc.com)
 */
const ZeroByteErrorCodes = Object.freeze({
    /*
     * General Firmware Index Errors: -1000 through -1999
     *   Device Errors in the Firmware Index (-1100 to -1199)
     * Firmware Bundle Errors: -2000 through -2999
     */

    // Indicates an error retrieving the current firmware index
    FIRMWARE_INDEX_UNAVAILABLE: Symbol(-1000),

    // Indicates an error parsing the firmware index as JSON
    FIRMWARE_INDEX_MALFORMED: Symbol(-1001),

    // Indicates that the requested device is not listed in the firmware index
    FIRMWARE_INDEX_DEVICE_UNKNOWN: Symbol(-1002),

    // Latest firmware version can not be determined from the firmware index
    FIRMWARE_INDEX_LATEST_VERSION_UNKNOWN: Symbol(-1100),

    // Unable to download the firmware bundle from the URL in the firmware index
    FIRMWARE_BUNDLE_UNAVAILABLE: Symbol(-2000),

    // Something unknown occurred
    UNKNOWN_ERROR: Symbol(-9999),
});

export {ZeroByteErrorCodes};
