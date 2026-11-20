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
    image.set(new TextEncoder().encode("BATCHRUN"), 43);
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

  function createAppsDisk(files) {
    const root = { name: "APPS", directory: true, children: new Map() };
    let fileBytes = 0;
    for (const file of files) {
      const parts = file.path.split("/").filter(part => part && part !== ".");
      if (!parts.length || parts.some(part => part === "..")) continue;
      let directory = root;
      for (const part of parts.slice(0, -1)) {
        if (!directory.children.has(part)) {
          directory.children.set(part, { name: part, directory: true, children: new Map() });
        }
        directory = directory.children.get(part);
        if (!directory.directory) throw new Error(`An app file conflicts with a folder: ${file.path}`);
      }
      const name = parts[parts.length - 1];
      if (directory.children.has(name)) throw new Error(`Duplicate app file: ${file.path}`);
      const data = new Uint8Array(file.data);
      directory.children.set(name, { name, directory: false, data });
      fileBytes += data.byteLength;
    }

    function assignNames(directory) {
      const used = new Set();
      for (const child of directory.children.values()) {
        const dot = child.name.lastIndexOf(".");
        const rawBase = dot > 0 ? child.name.slice(0, dot) : child.name;
        const rawExtension = dot > 0 ? child.name.slice(dot + 1) : "";
        const base = rawBase.toUpperCase().replace(/[^A-Z0-9_$%'-@~`!(){}^#&]/g, "_") || "FILE";
        const extension = rawExtension.toUpperCase().replace(/[^A-Z0-9_$%'-@~`!(){}^#&]/g, "_").slice(0, 3);
        let shortBase = base.slice(0, 8);
        let alias = `${shortBase.padEnd(8, " ")}${extension.padEnd(3, " ")}`;
        for (let suffix = 1; used.has(alias); suffix++) {
          const tail = `~${suffix}`;
          shortBase = `${base.slice(0, 8 - tail.length)}${tail}`;
          alias = `${shortBase.padEnd(8, " ")}${extension.padEnd(3, " ")}`;
        }
        used.add(alias);
        child.alias = alias;
        if (child.directory) assignNames(child);
      }
    }
    assignNames(root);

    const bytesPerSector = 512;
    const rootEntries = 512;
    const rootSectors = rootEntries * 32 / bytesPerSector;
    const directories = [];
    function collectDirectories(directory) {
      directories.push(directory);
      for (const child of directory.children.values()) {
        if (child.directory) collectDirectories(child);
      }
    }
    collectDirectories(root);

    const clusterCountForDirectories = directories.reduce((total, directory) => {
      const entryCount = directory.children.size + 2;
      return total + Math.ceil(entryCount * 32 / (bytesPerSector * 4));
    }, 0);
    const requiredBytes = fileBytes + clusterCountForDirectories * bytesPerSector * 4;
    if (requiredBytes > 128 * 1024 * 1024) {
      throw new Error("Files in assets/apps exceed the 128 MB DOS apps disk limit.");
    }

    let sectorsPerCluster = 1;
    while (Math.ceil(requiredBytes / (bytesPerSector * sectorsPerCluster)) > 65_000) {
      sectorsPerCluster *= 2;
    }
    let clusterCount = Math.max(4_085, Math.ceil(requiredBytes / (bytesPerSector * sectorsPerCluster)));
    if (clusterCount > 65_524) throw new Error("Files in assets/apps are too large for a DOS FAT16 disk.");
    const fatSectors = Math.ceil((clusterCount + 2) * 2 / bytesPerSector);
    const totalSectors = 1 + fatSectors * 2 + rootSectors + clusterCount * sectorsPerCluster;
    const partitionStart = 63;
    const image = new Uint8Array((partitionStart + totalSectors) * bytesPerSector);
    const view = new DataView(image.buffer);

    const partition = 446;
    image[partition + 1] = 1;
    image[partition + 2] = 1;
    image[partition + 4] = 0x06;
    image[partition + 5] = 0xfe;
    image[partition + 6] = 0xff;
    image[partition + 7] = 0xff;
    view.setUint32(partition + 8, partitionStart, true);
    view.setUint32(partition + 12, totalSectors, true);
    image[510] = 0x55;
    image[511] = 0xaa;

    const volumeOffset = partitionStart * bytesPerSector;
    image.set([0xeb, 0x3c, 0x90], volumeOffset);
    image.set(new TextEncoder().encode("MSDOS5.0"), volumeOffset + 3);
    view.setUint16(volumeOffset + 11, bytesPerSector, true);
    image[volumeOffset + 13] = sectorsPerCluster;
    view.setUint16(volumeOffset + 14, 1, true);
    image[volumeOffset + 16] = 2;
    view.setUint16(volumeOffset + 17, rootEntries, true);
    view.setUint16(volumeOffset + 19, totalSectors <= 0xffff ? totalSectors : 0, true);
    image[volumeOffset + 21] = 0xf8;
    view.setUint16(volumeOffset + 22, fatSectors, true);
    view.setUint16(volumeOffset + 24, 63, true);
    view.setUint16(volumeOffset + 26, 16, true);
    view.setUint32(volumeOffset + 28, partitionStart, true);
    view.setUint32(volumeOffset + 32, totalSectors > 0xffff ? totalSectors : 0, true);
    image[volumeOffset + 36] = 0x80;
    image[volumeOffset + 38] = 0x29;
    view.setUint32(volumeOffset + 39, 0x41505053, true);
    image.set(new TextEncoder().encode("DOS_APPS   "), volumeOffset + 43);
    image.set(new TextEncoder().encode("FAT16   "), volumeOffset + 54);
    image[volumeOffset + 510] = 0x55;
    image[volumeOffset + 511] = 0xaa;

    const fatOffset = volumeOffset + bytesPerSector;
    const fat = new Uint16Array(image.buffer, fatOffset, fatSectors * bytesPerSector / 2);
    fat[0] = 0xfff8;
    fat[1] = 0xffff;
    const clusterBytes = bytesPerSector * sectorsPerCluster;
    const dataOffset = volumeOffset + (1 + fatSectors * 2 + rootSectors) * bytesPerSector;
    let nextCluster = 2;
    function allocate(data, minimumClusters = 0) {
      const count = Math.max(minimumClusters, Math.ceil((data?.byteLength || 0) / clusterBytes));
      if (!count) return 0;
      if (nextCluster + count > clusterCount + 2) throw new Error("Files in assets/apps do not fit on the DOS apps disk.");
      const firstCluster = nextCluster;
      for (let index = 0; index < count; index++) {
        const cluster = nextCluster++;
        fat[cluster] = index === count - 1 ? 0xffff : cluster + 1;
      }
      if (data?.byteLength) {
        const start = dataOffset + (firstCluster - 2) * clusterBytes;
        image.set(data, start);
      }
      return firstCluster;
    }

    for (const directory of directories) {
      const entryCount = directory.children.size + 2;
      directory.firstCluster = allocate(null, Math.ceil(entryCount * 32 / clusterBytes));
    }
    function allocateFiles(directory) {
      for (const child of directory.children.values()) {
        if (child.directory) allocateFiles(child);
        else child.firstCluster = allocate(child.data);
      }
    }
    allocateFiles(root);

    function writeEntry(buffer, offset, alias, attributes, firstCluster, size) {
      for (let index = 0; index < 11; index++) buffer[offset + index] = alias.charCodeAt(index) || 0x20;
      buffer[offset + 11] = attributes;
      const entryView = new DataView(buffer.buffer, buffer.byteOffset + offset, 32);
      entryView.setUint16(26, firstCluster, true);
      entryView.setUint32(28, size, true);
    }
    function writeDirectory(directory) {
      const entryCount = directory.children.size + 2;
      const entries = new Uint8Array(Math.ceil(entryCount * 32 / clusterBytes) * clusterBytes);
      writeEntry(entries, 0, ".          ", 0x10, directory.firstCluster, 0);
      const parentCluster = directory === root ? 0 : directory.parent.firstCluster;
      writeEntry(entries, 32, "..         ", 0x10, parentCluster, 0);
      let offset = 64;
      for (const child of directory.children.values()) {
        writeEntry(entries, offset, child.alias, child.directory ? 0x10 : 0x20,
          child.firstCluster, child.directory ? 0 : child.data.byteLength);
        offset += 32;
        if (child.directory) {
          child.parent = directory;
          writeDirectory(child);
        }
      }
      image.set(entries, dataOffset + (directory.firstCluster - 2) * clusterBytes);
    }
    writeDirectory(root);

    const rootOffset = volumeOffset + (1 + fatSectors * 2) * bytesPerSector;
    writeEntry(image, rootOffset, "APPS       ", 0x10, root.firstCluster, 0);
    const secondFatOffset = fatOffset + fatSectors * bytesPerSector;
    image.copyWithin(secondFatOffset, fatOffset, fatOffset + fatSectors * bytesPerSector);
    return image.buffer;
  }

  function waitForEvent(instance, eventName, timeoutMs, osName) {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out while loading the ${osName} virtual machine.`));
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

  async function startMachine({ disks, appFiles, memorySize, osName, screen, onStatus, batch = false }) {
    if (!window.WebAssembly) throw new Error("This browser does not support WebAssembly.");
    if (!window.V86) throw new Error("The bundled emulator library could not be loaded. Reload the page and try again.");
    if (emulator) await stop();
    const activeRunId = ++runId;

    screen.querySelector("canvas").hidden = false;
    onStatus(`Starting the ${osName} virtual machine...`);
    const machineDisks = { ...disks };
    machineDisks[machineDisks.hda ? "hdb" : "hda"] = { buffer: createAppsDisk(appFiles) };
    emulator = new window.V86({
      wasm_path: `${V86_BASE}build/v86.wasm`,
      memory_size: memorySize,
      vga_memory_size: 2 * 1024 * 1024,
      screen_container: screen,
      bios: { url: `${V86_BASE}bios/seabios.bin` },
      vga_bios: { url: `${V86_BASE}bios/vgabios.bin` },
      ...machineDisks,
      autostart: true,
      fastboot: true,
      disable_speaker: true
    });

    const runningEmulator = emulator;
    await waitForEvent(runningEmulator, "emulator-loaded", 60_000, osName);
    if (activeRunId !== runId || runningEmulator !== emulator) {
      throw new Error(`${osName} startup was cancelled.`);
    }
    onStatus(`Booting ${osName}...`);
    if (batch) {
      const promptFound = await runningEmulator.wait_until_vga_screen_contains("A:\\>", { timeout_msec: 60_000 });
      if (activeRunId !== runId || runningEmulator !== emulator) return;
      if (!promptFound) {
        throw new Error(`${osName} did not reach its A:\\> prompt. Check that the selected floppy image is bootable.`);
      }
      runningEmulator.keyboard_send_text("B:\\RUN.BAT\r");
      onStatus(`Running your batch file in ${osName}. It is also available as B:\\RUN.BAT. Apps are on C:\\APPS.`);
    }
  }

  async function run(source, appFiles, screen, onStatus) {
    const floppy = createBatchFloppy(source);
    await startMachine({
      disks: {
        fda: { url: FREEDOS_IMAGE, size: 737280 },
        fdb: { buffer: floppy }
      },
      appFiles,
      memorySize: 16 * 1024 * 1024,
      osName: "FreeDOS",
      screen,
      onStatus,
      batch: true
    });
  }

  async function runMsDos(source, bootImage, appFiles, screen, onStatus) {
    if (!(bootImage instanceof ArrayBuffer) || !bootImage.byteLength) {
      throw new Error("Choose a non-empty MS-DOS floppy image.");
    }
    const floppy = createBatchFloppy(source);
    await startMachine({
      disks: {
        fda: { buffer: bootImage },
        fdb: { buffer: floppy }
      },
      appFiles,
      memorySize: 16 * 1024 * 1024,
      osName: "MS-DOS",
      screen,
      onStatus,
      batch: true
    });
  }

  async function runImage(image, drive, appFiles, screen, onStatus, osName, memorySize) {
    if (!(image instanceof ArrayBuffer) || !image.byteLength) {
      throw new Error("Choose a non-empty bootable disk image.");
    }
    if (!["fda", "hda", "cdrom"].includes(drive)) {
      throw new Error("Choose a supported disk image type.");
    }
    const disks = { [drive]: { buffer: image } };
    await startMachine({ disks, appFiles, memorySize, osName, screen, onStatus });
  }

  async function stop() {
    runId++;
    if (!emulator) return;
    const current = emulator;
    emulator = null;
    await current.destroy();
  }

  window.FreeDosRunner = { run, runMsDos, runImage, stop };
})();
