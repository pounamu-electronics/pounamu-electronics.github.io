/* USB */
const WCH_VID = 0x1a86;
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

let usb_device_handle = null;
let firmware_file_content = null;

const connect_button = document.getElementById("connect_button");
connect_button.addEventListener("click", (event) => {
  flash_device();
});

const progress_bar = document.getElementById("progressBar");

const flashing_complete_modal = document.getElementById(
  "flashing_complete_modal"
);
const close_modal_button = document.getElementById("close_modal_button");
close_modal_button.addEventListener("click", function (e) {
  flashing_complete_modal.close();
});

const file_dialog = document.getElementById("fileInput");

file_dialog.addEventListener("change", function (event) {
  const file = event.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.readAsArrayBuffer(file);
    reader.onload = function (e) {
      const arrayBuffer = e.target.result;
      const byteArray = new Uint8Array(arrayBuffer);
      firmware_file_content = byteArray;
      console.log(firmware_file_content);
    };
    reader.onerror = function (e) {
      console.error("Error reading file:", e.target.error);
    };
  }
});

file_dialog.addEventListener("click", function (event) {
  this.value = "";
});

async function flash_device() {
  let device = await navigator.usb.requestDevice({
    filters: [{ vendorId: WCH_VID }],
  });
  console.log("Vendor Id:", device.vendorId);
  console.log("Product Id: ", device.productId);
  await device.open();
  const configs = device.configurations;
  console.log(configs);
  await device.selectConfiguration(1);
  await device.claimInterface(0);

  let flasher_obj = new CH32_Flasher(device);
  flasher_obj.flash_firmware(
    firmware_file_content,
    firmware_file_content.length
  );
}

class CH32_Flasher {
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
      } else {
        console.log("Failed to auth!");
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
    return -1;
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
    }
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
    let bytes_remaining = data_length;
    const header_length_bytes = 8;
    const max_flash_bytes_per_packet = 56;
    let packets_to_send = Math.floor(bytes_remaining / 56) + 1;
    console.log("Total packets to send: ", packets_to_send);

    const max_packet_length_total = 64;
    const packet_header_length = 3;
    const packet_padding_length = 5;
    const max_data_packet_chunk =
      max_packet_length_total - packet_header_length - packet_padding_length;

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
        offset / max_flash_bytes_per_packet,
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
          return;
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
        return;
      }
    }
  }

  async verify_user_flash(data, data_length, offset) {
    let bytes_remaining = data_length;
    let packets_to_send = Math.floor(data_length / 56) + 1;
    console.log("Verifying, total packets to send: ", packets_to_send);

    const max_packet_length_total = 64;
    const packet_header_length = 3;
    const packet_padding_length = 5;
    const max_data_packet_chunk =
      max_packet_length_total - packet_header_length - packet_padding_length;

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
          return;
        } else if (succ != 0x00) {
          console.log(
            "Failed to verify since code is " + succ + ". Panic exit!!!"
          );
          return;
        } else {
          console.log("Chunk verified");
        }
      } else {
        console.log("Failed!");
        return;
      }
      offset += chunk_size;
      bytes_remaining -= chunk_size;
    }
  }

  async reset_device() {
    let packet_data = [WCH_COMMAND_END_AND_RESET, 0x01, 0x00, 0x01];
    let packet = new Uint8Array(packet_data.length);
    packet.set(packet_data, 0);
    let response = await this.write_raw(packet);
    if (response && response.byteLength == 6 && response.getUint8(4) == 0x00) {
      console.log("Reboot succ");
    } else {
      console.log("Reboot failed, response: " + response.values.toHex());
    }
  }

  async flash_firmware(firmware_file_bytes, firmware_file_length) {
    let succ = await this.auth_and_identify();
    succ = await this.read_configuration();
    succ = await this.xor_key_calc();
    succ = await this.erase_flash();
    succ = await this.write_flash(
      firmware_file_bytes,
      firmware_file_length,
      0x00
    );
    succ = await this.xor_key_calc();
    succ = await this.verify_user_flash(
      firmware_file_bytes,
      firmware_file_length,
      0x00
    );
    succ = await this.reset_device();
    flashing_complete_modal.showModal();
  }
}
