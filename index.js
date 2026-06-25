import { Flasher } from "./js/flasher.js";

const SOFTWARE_VERSION = "2.0.0";

/**
 * Create filters for WebUSB
 * Filter for updating needs to include WCH VID
 * Filter for kit config writing needs to include PID.Codes VID and RE_SWC PID
 */
const WCH_VID = 0x1a86;
const PID_CODES_VID = 0x1209;
const RE_SWC_PID = 0x6789;
const usb_device_filter_update_mode = [{ vendorId: WCH_VID }];
const usb_device_filter_config_mode = [
  { vendorId: PID_CODES_VID, productId: RE_SWC_PID },
];

const HEADUNIT_BRAND_INDEXES = {
  GENERIC_RESISTIVE: 1,
  JVC: 2,
  KENWOOD: 3,
  ALPINE: 4,
  PIONEER: 5,
  USB_HID: 6,
  SONY: 7,
};

const HEADUNIT_BRAND_INDEX_ARRAY = [
  HEADUNIT_BRAND_INDEXES.GENERIC_RESISTIVE,
  HEADUNIT_BRAND_INDEXES.JVC,
  HEADUNIT_BRAND_INDEXES.KENWOOD,
  HEADUNIT_BRAND_INDEXES.ALPINE,
  HEADUNIT_BRAND_INDEXES.PIONEER,
  HEADUNIT_BRAND_INDEXES.USB_HID,
  HEADUNIT_BRAND_INDEXES.SONY,
];

const HEADUNIT_BRAND_NAMES = [
  "Generic Resistive",
  "JVC",
  "Kenwood",
  "Alpine",
  "Pioneer",
  "USB HID",
  "Sony",
];

const OUTPUT_INDEXES = {
  NOT_CONFIGURED: 0,
  VOLUME_UP: 1,
  VOLUME_DOWN: 2,
  MUTE: 3,
  NEXT_TRACK: 4,
  PREVIOUS_TRACK: 5,
  PLAY_PAUSE: 6,
  CHANGE_SOURCE: 7,
};

/**
 * Output Support Matrix
 * This matrix is used as a mask for output support for each brand. Used in conjuction with the
 * OUTPUT_INDEXES object, we can dictate what outputs are supported by each brand/type of headunit
 *
 * Matrix indexes:
 * [NOT_CONFIGURED, VOLUME+, VOLUME-, MUTE, NEXT, PREV, PLAY/PAUSE, CHANGE SOURCE]
 *
 * Note: Gen Res doesn't support output functions as it uses output resistances instead
 */
const HEADUNIT_BRAND_OUTPUT_SUPPORT_MATRIX = [
  [0, 0, 0, 0, 0, 0, 0, 0] /* Padding for non-zero indexed headunit list */,
  [1, 0, 0, 0, 0, 0, 0, 0] /* Gen Res */,
  [1, 1, 1, 1, 1, 1, 0, 0] /* JVC */,
  [1, 1, 1, 1, 1, 1, 1, 0] /* Kenwood */,
  [1, 1, 1, 1, 1, 1, 0, 0] /* Alpine */,
  [1, 1, 1, 1, 1, 1, 0, 1] /* Pioneer */,
  [1, 1, 1, 1, 1, 1, 1, 0] /* USB-HID */,
  [1, 1, 1, 1, 1, 1, 0, 0] /* Sony */,
];

const DEFAULT_CONFIG_ARRAY = [
  1 /* Gen Res mode (index is 1) */,
  OUTPUT_INDEXES.VOLUME_UP /* Volume+ */,
  OUTPUT_INDEXES.VOLUME_DOWN /* Volume- */,
  OUTPUT_INDEXES.MUTE /* Mute */,
  OUTPUT_INDEXES.NEXT_TRACK /* Next track */,
  OUTPUT_INDEXES.PREVIOUS_TRACK /* Previous track */,
  1 /* 1k clockwise */,
  2 /* 2k couter clockwise */,
  5 /* 4k short press */,
  7 /* 6k long press */,
  9 /* Double press kept in but ignored */,
];

window.onload = function () {
  const version_label = document.getElementById("version_label");
  const update_button = document.getElementById("update_button");
  const modal = document.getElementById("modal");
  const write_config_button = document.getElementById("write_config_button");
  const read_config_button = document.getElementById("read_config_button");
  const headunit_select = document.getElementById("headunit_select");

  version_label.innerHTML = `Software Version: ${SOFTWARE_VERSION}`;

  if ("usb" in navigator) {
    update_button.addEventListener("click", (event) => {
      const file_dialog = document.getElementById("fileInput");
      const file = file_dialog.files[0];
      console.log(file_dialog.files);
      if (file) {
        const reader = new FileReader();
        reader.readAsArrayBuffer(file);
        reader.onload = function (e) {
          const arrayBuffer = e.target.result;
          const byteArray = new Uint8Array(arrayBuffer);
          console.log(byteArray);
          flash_device(byteArray);
        };
        reader.onerror = function (e) {
          console.error("Error reading file:", e.target.error);
        };
      } else {
        show_modal(
          "Error! No firmware file selected",
          "Please choose a firmware file to upload (.bin)"
        );
      }
    });

    const close_modal_button = document.getElementById("close_modal_button");
    close_modal_button.addEventListener("click", function (e) {
      modal.close();
    });

    write_config_button.addEventListener("click", function () {
      console.log("Writing config");
      let output_mapping = [];
      if (headunit_select.value == "Generic Resistive") {
        console.log("Getting res values");
        output_mapping = get_gen_res_selected();
      } else {
        output_mapping = get_functions_selected(headunit_select.value);
      }
      if (output_mapping.length) {
        write_config_to_device(output_mapping);
      }
    });

    read_config_button.addEventListener("click", function () {
      console.log("Reading config");
      read_device_config();
    });

    headunit_select.addEventListener("change", function () {
      const headunit_index = parseInt(headunit_select.value, 10);
      if (headunit_index == HEADUNIT_BRAND_INDEXES.GENERIC_RESISTIVE) {
        update_gen_res_range();
      } else {
        update_output_functions_select(headunit_index);
      }
    });

    for (let i = 0; i < HEADUNIT_BRAND_NAMES.length; i++) {
      const option = new Option(
        HEADUNIT_BRAND_NAMES[i],
        HEADUNIT_BRAND_INDEX_ARRAY[i]
      );
      headunit_select.add(option);
    }
    const myFieldset = document.getElementById("gen_res_range_fieldset");
    const range_inputs = myFieldset.querySelectorAll("input");
    const range_outputs = myFieldset.querySelectorAll("output");
    let config_index = 6;
    let range_index = 0;
    for (const range_input of range_inputs) {
      range_input.value = DEFAULT_CONFIG_ARRAY[config_index];
      for (const range_output of range_outputs) {
        const output_for = range_output.htmlFor;
        if (output_for == range_input.id) {
          range_output.innerHTML = range_input.value + "k ohms";
        }
      }
      range_input.addEventListener("input", function (event) {
        let range_id = event.target.id;
        for (const range_output of range_outputs) {
          const output_for = range_output.htmlFor;
          if (output_for == range_id) {
            range_output.innerHTML = event.target.value + "k ohms";
          }
        }
      });
      config_index += 1;
      range_index += 1;
    }
    update_output_functions_select(HEADUNIT_BRAND_INDEXES.GENERIC_RESISTIVE);
  } else {
    console.error("No USB functions available in this browser");
    show_modal("ERROR! No USB access!", "Please use a supported browser");
  }
};

function update_supported_outputs(headunit_chosen_index) {
  const output_function_selection_fieldset = document.getElementById(
    "output_function_selection_fieldset"
  );
  const output_selectors =
    output_function_selection_fieldset.querySelectorAll("select");
  var default_index = 1; // Avoid using the Not Assigned as default
  for (const selector of output_selectors) {
    const options = selector.querySelectorAll("option");
    selector.selectedIndex = default_index;
    default_index++;
    var output_option_index = 0;
    for (const option of options) {
      if (
        HEADUNIT_BRAND_OUTPUT_SUPPORT_MATRIX[headunit_chosen_index][
          output_option_index
        ]
      ) {
        option.disabled = false;
      } else {
        option.disabled = true;
      }
      output_option_index++;
    }
  }
}

function update_output_functions_select(headunit_chosen_index) {
  if (headunit_chosen_index == HEADUNIT_BRAND_INDEXES.GENERIC_RESISTIVE) {
    change_gen_res_range_visibility(true);
    change_output_function_visibility(false);
  } else {
    update_supported_outputs(headunit_chosen_index);
    change_gen_res_range_visibility(false);
    change_output_function_visibility(true);
  }
}

function get_gen_res_selected() {
  const myFieldset = document.getElementById("gen_res_range_fieldset");
  let output_mapping = [];
  for (const default_config of DEFAULT_CONFIG_ARRAY) {
    output_mapping.push(default_config);
  }
  const ranges = myFieldset.querySelectorAll("input");
  let index = 6;
  ranges.forEach((range) => {
    output_mapping[index] = ((range.value * 1000 - 75) / (100000 / 128)) | 0;
    index++;
  });
  console.log("Output mapping: " + output_mapping);
  return output_mapping;
}

function get_functions_selected(headunit_index) {
  const myFieldset = document.getElementById(
    "output_function_selection_fieldset"
  );
  let output_mapping = [];
  for (const default_config of DEFAULT_CONFIG_ARRAY) {
    output_mapping.push(default_config);
  }
  output_mapping[0] = headunit_index;
  const selects = myFieldset.querySelectorAll("select");
  let index = 1;
  selects.forEach((select) => {
    output_mapping[index] = select.selectedIndex;
    index++;
  });
  console.log("Output mapping: " + output_mapping);
  return output_mapping;
}

function update_gen_res_range() {
  /* First hide anything in the other section */
  change_output_function_visibility(false);
  change_gen_res_range_visibility(true);
}

function change_output_function_visibility(is_visible) {
  const output_function_fieldset = document.getElementById(
    "output_function_selection_fieldset"
  );
  output_function_fieldset.hidden = !is_visible;
}

function change_gen_res_range_visibility(is_visible) {
  const gen_res_ranges_fieldset = document.getElementById(
    "gen_res_range_fieldset"
  );
  gen_res_ranges_fieldset.hidden = !is_visible;
}

async function flash_device(firmware_file_bytes) {
  try {
    let device = await navigator.usb.requestDevice({
      filters: usb_device_filter_update_mode,
    });
    if (device) {
      console.log("Vendor Id:", device.vendorId);
      console.log("Product Id: ", device.productId);
      await device.open();
      await device.selectConfiguration(1);
      await device.claimInterface(0);

      let flasher_obj = new Flasher(device);
      let succ = await flasher_obj.flash_firmware(
        firmware_file_bytes,
        firmware_file_bytes.length
      );
      if (succ) {
        show_modal("Flashing Complete", "Device will auto-reboot");
      } else {
        show_modal(
          "Error during flashing!",
          "Please check the log in developer options"
        );
      }
    }
  } catch (error) {
    console.error(error);
    if (error.name != "NotFoundError") {
      show_modal(
        "Error with USB transfer",
        `Failed to flash the device. Please see log in developer tools \n Error: ${error} `
      );
    }
  }
}

async function read_device_config() {
  try {
    let device = await navigator.usb.requestDevice({
      filters: usb_device_filter_config_mode,
    });
    await device.open();
    await device.selectConfiguration(1);
    await device.claimInterface(0);
    let flasher_obj = new Flasher(device);
    const succ =
      flasher_obj.secondary_bootloader_request_firmware_version_string();
    if (succ) {
      console.log(succ);
    }
  } catch (error) {
    console.error(error);
    if (error.name != "NotFoundError") {
      console.error(`Operation failed: ${error}`);
      show_modal(
        "ERROR!",
        `Failed to read device config. Please see log in developer tools\n\nError: ${error}`
      );
    }
  }
}

async function write_config_to_device(config_array) {
  try {
    let device = await navigator.usb.requestDevice({
      filters: usb_device_filter_config_mode,
    });
    await device.open();
    await device.selectConfiguration(1);
    await device.claimInterface(0);
    let flasher_obj = new Flasher(device);
    const succ = flasher_obj.write_eeprom_bytes(config_array);
    if (succ) {
      show_modal(
        "Success!",
        "Config written to RE_SWC. Device will auto-reboot"
      );
      return true;
    } else {
      show_modal(
        "ERROR!",
        "Failed to write config to device. Please see log in developer tools"
      );
    }
  } catch (error) {
    console.error(error);
    if (error.name != "NotFoundError") {
      console.error(`Operation failed: ${error}`);
      show_modal(
        "ERROR!",
        `Failed to write config to device. Please see log in developer tools\n\nError: ${error}`
      );
    }
  }
  return false;
}

function show_modal(title, text) {
  const modal = document.getElementById("modal");
  const modal_title = document.getElementById("modal_title");
  const modal_text = document.getElementById("modal_text");
  modal_title.innerHTML = title;
  if (text) {
    modal_text.innerHTML = text;
  }
  modal.showModal();
}
