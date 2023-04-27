/*
 * index.js
 *
 * Copyright (c) 2023 Zero Byte LLC, All Rights Reserved
 * Licensed under CC BY-ND 4.0 (https://creativecommons.org/licenses/by-nd/4.0/)
 *
 * Module entry-point to export ZeroByteFW object. Methods exposed here are intended for public use. It is not
 * recommended to use API methods exported from anywhere else, as they are considered to be internal and are
 * subject to breaking changes without notice.
 *
 * SPDX-License-Identifier: CC-BY-ND-4.0
 * SPDX-FileCopyrightText: Copyright (c) 2023 Zero Byte LLC (hello@zerobytellc.com) All Rights Reserved
 *
 * @author Timothy C Sweeney-Fanelli, Zero Byte LLC (tim@zerobytellc.com)
 */

import { get_latest_fw_info, retrieve_fw_index, download_fw }
    from './ZeroByteFirmwareUtils'

export const ZeroByteFW = {
    get_latest_fw_info: get_latest_fw_info,
    download_fw:        download_fw
};
