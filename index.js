import { zbl_get_latest_fw_info, zbl_retrieve_fw_index, zbl_download_fw }
    from './src/ZeroByteFirmwareUtils'

export const ZeroByteFW = {
    get_latest_fw_info: zbl_get_latest_fw_info,
    download_fw: zbl_download_fw
};
