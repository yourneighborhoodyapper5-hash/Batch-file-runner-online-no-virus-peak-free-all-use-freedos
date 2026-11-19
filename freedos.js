(() => {
  "use strict";

  const V86_BASE = "./assets/v86/";
  const FREEDOS_IMAGE = "./assets/freedos722.img";
  const FLOPPY_SIZE = 1_474_560;
  const SECTOR_SIZE = 512;
  const DATA_START_SECTOR = 33;
  let emulator;
  let runId = 0;

  function writeFatEntry(fat, cluster, value) {
    const offset = Math.floor(cluster * 3 / 2);
    if (cluster % 2 === 0) {
      fat[offset] = value & 0xff;
      fat[offset + 1] = (fat[offset + 1] & 0xf0) | ((value >> 8) & 0x0f);
    } else {
      fat[offset] = (fat[offset] & 0x0f) | ((value << 4) & 0xf0);
      fat[offset + 1] = (value >> 4) & 0xff;
    }
  }

  function createBatchFloppy(source) {
    const contents = new TextEncoder().encode(source.replace(/\r\n?/g, "\n").replace(/\n/g, "\r\n"));
    const clustersNeeded = Math.max(1, Math.ceil(contents.length / SECTOR_SIZE));
    const clusterCount = 2880 - DATA_START_SECTOR;
    if (clustersNeeded > clusterCount) {
      throw new Error("This batch file is too large to fit on the temporary DOS floppy.");
    }

    const image = new Uint8Array(FLOPPY_SIZE);
    const view = new DataView(image.buffer);
    image.set([0xeb, 0x3c, 0x90], 0);
    image.set(new TextEncoder().encode("MSDOS5.0"), 3);
    view.setUint16(11, SECTOR_SIZE, true);
    image[13] = 1;
    view.setUint16(14, 1, true);
    image[16] = 2;
    view.setUint16(17, 224, true);
    view.setUint16(19, 2880, true);
    image[21] = 0xf0;
    view.setUint16(22, 9, true);
    view.setUint16(24, 18, true);
    view.setUint16(26, 2, true);
    image.set(new TextEncoder().encode("FREEDOS "), 43);
    image.set(new TextEncoder().encode("FAT12   "), 54);
    image[510] = 0x55;
    image[511] = 0xaa;

    const firstFatOffset = SECTOR_SIZE;
    const fatSize = 9 * SECTOR_SIZE;
    for (const fatOffset of [firstFatOffset, firstFatOffset + fatSize]) {
      image.set([0xf0, 0xff, 0xff], fatOffset);
      for (let index = 0; index < clustersNeeded; index++) {
        const cluster = index + 2;
        writeFatEntry(image.subarray(fatOffset, fatOffset + fatSize), cluster,
          index === clustersNeeded - 1 ? 0x0fff : cluster + 1);
      }
    }

    const rootOffset = 19 * SECTOR_SIZE;
    image.set(new TextEncoder().encode("RUN     BAT"), rootOffset);
    image[rootOffset + 11] = 0x20;
    view.setUint16(rootOffset + 26, 2, true);
    view.setUint32(rootOffset + 28, contents.length, true);

    const dataOffset = DATA_START_SECTOR * SECTOR_SIZE;
    image.set(contents, dataOffset);
    return image.buffer;
  }

  function waitForEvent(instance, eventName, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("Timed out while loading the FreeDOS virtual machine."));
      }, timeoutMs);
      const onEvent = () => {
        cleanup();
        resolve();
      };
      const onError = event => {
        cleanup();
        const url = event.file_name || "an emulator resource";
        reject(new Error(`Could not load ${url}. Check your network connection and try again.`));
      };
      const cleanup = () => {
        window.clearTimeout(timeout);
        instance.remove_listener(eventName, onEvent);
        instance.remove_listener("download-error", onError);
      };
      instance.add_listener(eventName, onEvent);
      instance.add_listener("download-error", onError);
    });
  }

  async function run(source, screen, onStatus) {
    if (!window.WebAssembly) throw new Error("This browser does not support WebAssembly.");
    if (!window.V86) throw new Error("The bundled emulator library could not be loaded. Reload the page and try again.");
    if (emulator) await stop();
    const activeRunId = ++runId;

    const floppy = createBatchFloppy(source);
    screen.querySelector("canvas").hidden = false;
    onStatus("Starting the FreeDOS virtual machine...");
    emulator = new window.V86({
      wasm_path: `${V86_BASE}build/v86.wasm`,
      memory_size: 16 * 1024 * 1024,
      vga_memory_size: 2 * 1024 * 1024,
      screen_container: screen,
      bios: { url: `${V86_BASE}bios/seabios.bin` },
      vga_bios: { url: `${V86_BASE}bios/vgabios.bin` },
      fda: { url: FREEDOS_IMAGE, size: 737280 },
      fdb: { buffer: floppy },
      autostart: true,
      fastboot: true,
      disable_speaker: true
    });

    const runningEmulator = emulator;
    await waitForEvent(runningEmulator, "emulator-loaded", 60_000);
    if (activeRunId !== runId || runningEmulator !== emulator) {
      throw new Error("FreeDOS startup was cancelled.");
    }
    onStatus("Booting FreeDOS...");
    const promptFound = await runningEmulator.wait_until_vga_screen_contains("A:\\>", { timeout_msec: 60_000 });
    if (activeRunId !== runId || runningEmulator !== emulator) return;
    if (!promptFound) {
      throw new Error("FreeDOS did not reach its command prompt. You can try booting again.");
    }
    runningEmulator.keyboard_send_text("B:\\RUN.BAT\r");
    onStatus("Running your batch file in FreeDOS. It is also available as B:\\RUN.BAT.");
  }

  async function stop() {
    runId++;
    if (!emulator) return;
    const current = emulator;
    emulator = null;
    await current.destroy();
  }

  window.FreeDosRunner = { run, stop };
})();
