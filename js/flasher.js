/* USB */
const ENDPOINT_OUT = 0x02;

/* Commands */
const WCH_COMMAND_AUTH = 0xa1;
const WCH_COMMAND_END_AND_RESET = 0xa2;
const WCH_COMMAND_START_XOR_KEYGEN = 0xa3;
const WCH_COMMAND_ERASE_FLASH = 0xa4;
const WCH_COMMAND_WRITE_FLASH = 0xa5;
const WCH_COMMAND_VERIFY_FLASH = 0xa6;
const WCH_COMMAND_READ_CONFIG = 0xa7;

/* CH32X035 specific */
const CH32X035_VARIANT = 0x5e;
const CH32X035_DEVICE_TYPE = 0x23;

export class Flasher {
  constructor(usb_interface) {
    this.usb_interface = usb_interface;
    this.xor_key = [];
    this.xor_key_checksum = 0;
    this.config_register = [];
  }

  async write_raw(packet) {
    const result = await this.usb_interface.transferOut(ENDPOINT_OUT, packet);
    if (result.status === "ok") {
      console.log("Bytes written", result.bytesWritten);
    }
    let resp = await this.read_raw();
    if (resp != -1) {
      return resp;
    } else {
      console.log("Failed to write a packet");
      return 0;
    }
  }

  async read_raw() {
    const result = await this.usb_interface.transferIn(2, 64);
    if (result.status === "ok") {
      return result.data;
    }
    return -1;
  }

  async auth_and_identify() {
    let packet = new Uint8Array(0x15);
    const data = [
      WCH_COMMAND_AUTH,
      0x12,
      0x00,
      CH32X035_VARIANT /* Variant */,
      CH32X035_DEVICE_TYPE /* Device type */,
      /* "MCU ISP & WCH.CN" start */
      0x4d,
      0x43,
      0x55,
      0x20,
      0x49,
      0x53,
      0x50,
      0x20,
      0x26,
      0x20,
      0x57,
      0x43,
      0x48,
      0x2e,
      0x43,
      0x4e,
      /* "MCU ISP & WCH.CN" end */
    ];
    packet.set(data, 0);

    let response = await this.write_raw(packet);
    if (response) {
      if (response.getUint8(0x04) === CH32X035_VARIANT) {
        console.log("Auth good!");
        return true;
      } else {
        console.log("Failed to auth!");
        return false;
      }
    }
  }

  async read_configuration() {
    let packet = new Uint8Array(30);
    const data = [WCH_COMMAND_READ_CONFIG, 0x02, 0x00, 0x1f, 0x00];
    packet.set(data, 0);
    let response = await this.write_raw(packet);
    if (response) {
      for (let index = 6; index < 30; index++) {
        this.config_register[index - 6] = response.getUint8(index);
      }
      return true;
    }
    return false;
  }

  calc_unique_id_checksum() {
    let checksum = 0;
    console.log(this.config_register);
    for (let i = 22 - 6; i < 30 - 6; i++) {
      checksum += this.config_register[i];
    }
    console.log(checksum);
    checksum = checksum % 256;
    return checksum;
  }

  async xor_key_calc() {
    let packet = new Uint8Array(33);
    const data = [WCH_COMMAND_START_XOR_KEYGEN, 0x1e, 0x00];
    const seed = Array(30).fill(0x00);
    data.push(...seed);
    packet.set(data, 0);
    let response = await this.write_raw(packet);
    if (response) {
      const checksum = response.getUint8(4);
      if (checksum != 0xfe) {
        this.xor_key_checksum = checksum;
        let device_id_checksum = this.calc_unique_id_checksum();
        console.log(device_id_checksum);
        let temp = new Uint8Array(8).fill(device_id_checksum);
        temp[7] = (device_id_checksum + CH32X035_VARIANT) & 0xff;
        console.log(temp);
        this.xor_key = Array.from(temp);
        console.log(this.xor_key);
      }
      return true;
    }
    return false;
  }

  async erase_flash() {
    let packet = new Uint8Array(7);
    const data = [WCH_COMMAND_ERASE_FLASH, 0x04, 0x00, 0x17, 0x00, 0x00, 0x00];
    packet.set(data, 0);
    let response = await this.write_raw(packet);
    if (response) {
      return true;
    }
    return false;
  }

  async write_flash(data, data_length, offset) {
    const max_packet_length_total = 64;
    const packet_header_length = 3;
    const packet_padding_length = 5;
    const max_data_packet_chunk =
      max_packet_length_total - packet_header_length - packet_padding_length;
    let bytes_remaining = data_length;
    let packets_to_send =
      Math.floor(bytes_remaining / max_data_packet_chunk) + 1;
    console.log("Total packets to send: ", packets_to_send);

    let encrypted_data = new Uint8Array(data_length);

    // Encrypt the data
    for (let i = 0; i < data.length; i++) {
      encrypted_data[i] = this.xor_key[i % 8] ^ data[i];
    }

    while (bytes_remaining) {
      let chunk_size = 0;
      if (bytes_remaining <= max_data_packet_chunk) {
        chunk_size = bytes_remaining;
      } else {
        chunk_size = max_data_packet_chunk;
      }
      let packet_data = [
        WCH_COMMAND_WRITE_FLASH,
        chunk_size + packet_padding_length,
        0x00,
        offset & 0xff,
        (offset >> 8) & 0xff,
        (offset >> 16) & 0xff,
        (offset >> 24) & 0xff,
        0xec, // Unknown or unimportant
      ];

      for (let index = 0; index < chunk_size; index++) {
        packet_data.push(encrypted_data[offset + index]);
      }

      let packet = new Uint8Array(chunk_size + 8);
      packet.set(packet_data, 0);

      console.log(
        "Encrypted packet ",
        offset / max_data_packet_chunk,
        ": ",
        packet.toHex()
      );

      // Write to device
      let response = await this.write_raw(packet);
      if (!response) {
        console.log("Failed to write btyes!!!");
      }

      if (response && response.byteLength == 6) {
        const succ = response.getUint8(4);
        if (succ != 0) {
          console.log("Error writing data!");
          return false;
        }
      }

      offset += chunk_size;
      bytes_remaining -= chunk_size;
    }
    /* Now we write one final write packet at the end according to spec */
    let packet_data = [
      WCH_COMMAND_WRITE_FLASH,
      0x05,
      0x00,
      offset & 0xff,
      (offset >> 8) & 0xff,
      (offset >> 16) & 0xff,
      (offset >> 24) & 0xff,
      0x00, // Unknown or unimportant
    ];
    let packet = new Uint8Array(8);
    packet.set(packet_data, 0);
    let response = await this.write_raw(packet);
    if (response && response.byteLength == 6) {
      const succ = response.getUint8(4);
      if (succ != 0) {
        console.log("Error writing data!");
        return false;
      }
    }
    return true;
  }

  async verify_user_flash(data, data_length, offset) {
    let packets_to_send = Math.floor(data_length / 56) + 1;
    console.log("Verifying, total packets to send: ", packets_to_send);

    const max_packet_length_total = 64;
    const packet_header_length = 3;
    const packet_padding_length = 5;
    const max_data_packet_chunk =
      max_packet_length_total - packet_header_length - packet_padding_length;

    /* We need to pad the total data to make sure it is a multiple of 8 for 
    verifying as bootloader expects chunks of 8 multiples */
    let padded_data_array;
    let padded_data_array_length;

    padded_data_array_length =
      data_length % 8 ? data_length + (8 - (data_length % 8)) : data_length;

    console.log(
      `data_length: ${data_length}\nPadded array length: ${padded_data_array_length}`
    );

    padded_data_array = new Uint8Array(padded_data_array_length);
    padded_data_array.set(data, 0);
    if (padded_data_array_length != length) {
      let padding = new Uint8Array(8 - (data_length % 8));
      padding.fill(0xff);
      padded_data_array.set(padding, data_length);
    }

    console.log(padded_data_array);

    console.log(`Padded data is of length: ${padded_data_array_length}`);

    let encrypted_data = new Uint8Array(padded_data_array_length);
    // Encrypt the data
    for (let i = 0; i < padded_data_array_length; i++) {
      encrypted_data[i] = this.xor_key[i % 8] ^ padded_data_array[i];
    }

    let bytes_remaining = padded_data_array_length;
    while (bytes_remaining) {
      let chunk_size = 0;
      if (bytes_remaining <= max_data_packet_chunk) {
        chunk_size = bytes_remaining;
      } else {
        chunk_size = max_data_packet_chunk;
      }
      let packet_data = [
        WCH_COMMAND_VERIFY_FLASH,
        chunk_size + packet_padding_length,
        0x00,
        offset & 0xff,
        (offset >> 8) & 0xff,
        (offset >> 16) & 0xff,
        (offset >> 24) & 0xff,
        0xec, // Unknown or unimportant
      ];

      for (let index = 0; index < chunk_size; index++) {
        packet_data.push(encrypted_data[offset + index]);
      }

      let packet = new Uint8Array(chunk_size + 8);

      packet.set(packet_data, 0);
      // Write to device
      let response = await this.write_raw(packet);
      if (!response) {
        console.log("Failed to write btyes. Panic and exit!!!");
        return;
      }
      if (response && response.byteLength == 6) {
        const succ = response.getUint8(4);
        if (succ == 0xf5) {
          console.log("Failed to verify  Non matching data! (0xF5)");
          return false;
        } else if (succ != 0x00) {
          console.log(
            "Failed to verify since code is " + succ + ". Panic exit!!!"
          );
          return false;
        } else {
          console.log("Chunk verified");
        }
      } else {
        console.log("Failed!");
        return false;
      }
      offset += chunk_size;
      bytes_remaining -= chunk_size;
    }
    return true;
  }

  async reset_device() {
    let packet_data = [WCH_COMMAND_END_AND_RESET, 0x01, 0x00, 0x01];
    let packet = new Uint8Array(packet_data.length);
    packet.set(packet_data, 0);
    let response = await this.write_raw(packet);
    if (response && response.byteLength == 6 && response.getUint8(4) == 0x00) {
      console.log("Reboot succ");
      return true;
    } else {
      console.log("Reboot failed, response: " + response.values.toHex());
      return false;
    }
  }

  async flash_firmware(firmware_file_bytes, firmware_file_length) {
    let succ = true;
    succ &= await this.auth_and_identify();
    succ &= await this.read_configuration();
    succ &= await this.xor_key_calc();
    succ &= await this.erase_flash();
    succ &= await this.write_flash(
      firmware_file_bytes,
      firmware_file_length,
      0x00
    );
    succ &= await this.xor_key_calc();
    succ &= await this.verify_user_flash(
      firmware_file_bytes,
      firmware_file_length,
      0x00
    );
    succ &= await this.reset_device();
    return succ;
  }

  async secondary_bootloader_request_firmware_version_string() {
    let packet = new Uint8Array(4);
    packet[0] = 0xb0; // Command
    packet[1] = 0x00; // Length
    let response = await this.write_raw(packet);
    if (response.byteLength >= 4) {
      if (response.getUint8(0x00) != 0xb0 || response.getUint8(0x02) == 0) {
        console.log("Bootloader firmware version request failed");
        console.log(response);
        return false;
      }
      // const firmware_version_bytes = response.subarray(0x04);
      const response_bytes = response.buffer;
      const firmware_version_bytes = response_bytes.slice(
        0x04,
        0x04 + response.getUint8(2)
      );
      const decoder = new TextDecoder();
      const firmware_version = decoder.decode(firmware_version_bytes);
      console.log(`Firmware version: v${firmware_version}`);
      return firmware_version;
    } else {
      console.log("Failed to request firmware version. No response");
      console.log(response.byteLength);
      return false;
    }
  }

  async write_eeprom_bytes(eeprom_bytes) {
    let packet = new Uint8Array(eeprom_bytes.length + 2);
    packet[0] = 0xa9; // Command
    packet[1] = eeprom_bytes.length; // Length
    packet.set(eeprom_bytes, 2);
    console.log(packet);

    let response = await this.write_raw(packet);
    if (response.byteLength >= 4) {
      if (response.getUint8(0x00) != 0xa9) {
        console.log("Bootloader incorrect response code");
        console.log(response);
        return false;
      }
      console.log("Config is written");
      packet = new Uint8Array(1);
      packet[0] = 0xa2; // reset
      response = await this.write_raw(packet);
      if (response.getUint8(0x00) === 0xa2) {
        console.log("Device is rebooting");
      } else {
        console.log("Failed to reset the device");
        return false;
      }
    } else {
      console.log("Failed to write config. No response");
      console.log(response.byteLength);
      return false;
    }
    return true;
  }
}
