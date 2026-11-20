(() => {
  "use strict";

  const STORAGE_KEY = "freedos-studio-files-v1";
  const DEFAULT_FILES = {
    "START.BAT": "@ECHO OFF\r\nREM Welcome to FreeDOS Studio!\r\nECHO Hello, DOS world!\r\nECHO.\r\nECHO Your batch file is running in the browser.\r\nECHO Type HELP in the prompt to see what you can do.\r\n",
    "README.TXT": "Welcome to FreeDOS Studio!\r\n\r\nEdit START.BAT and click Run batch.\r\nYour files live in this browser's local storage.\r\nType HELP in the command prompt for supported commands.\r\n"
  };
  const BOOT_IMAGES = {
    msdos: { file: "MS-DOS.img", drive: "fda", name: "MS-DOS", memorySize: 16 * 1024 * 1024 },
    kolibri: { file: "KolibriOS.img", drive: "fda", name: "KolibriOS", memorySize: 32 * 1024 * 1024 },
    windows95: { file: "win95.img", drive: "hda", name: "Windows 95", memorySize: 128 * 1024 * 1024 }
  };
  const MAX_BATCH_STEPS = 1000;

  const editor = document.querySelector("#editor");
  const workspace = document.querySelector(".workspace");
  const explorerToggle = document.querySelector("#toggle-explorer");
  const windowTitle = document.querySelector("#window-title");
  const fileList = document.querySelector("#file-list");
  const output = document.querySelector("#terminal-output");
  const commandInput = document.querySelector("#command-input");
  const promptPath = document.querySelector("#prompt-path");
  const lineNumbers = document.querySelector("#line-numbers");
  const cursorPosition = document.querySelector("#cursor-position");
  const editorMode = document.querySelector("#editor-mode");
  const unsavedMarker = document.querySelector("#unsaved-marker");
  const fileCount = document.querySelector("#file-count");
  const fileInput = document.querySelector("#import-file-input");
  const dosDialog = document.querySelector("#dos-dialog");
  const dosScreen = document.querySelector("#dos-screen");
  const dosStatus = document.querySelector("#dos-status");
  const emulatorOptions = document.querySelector("#emulator-options");
  const emulatorOsInput = document.querySelector("#emulator-os");
  const emulatorImageName = document.querySelector("#emulator-image-name");
  const files = loadFiles();
  const directories = new Set(["C:\\"]);
  const variables = Object.create(null);
  const commandHistory = [];
  let historyIndex = 0;
  let currentFile = Object.keys(files)[0];
  let currentDirectory = "C:\\";
  let echoEnabled = true;
  let batchRunning = false;

  function loadFiles() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && typeof saved === "object" && !Array.isArray(saved)) {
        const valid = Object.create(null);
        for (const [name, content] of Object.entries(saved)) {
          if (isValidFileName(name) && typeof content === "string") valid[name.toUpperCase()] = content;
        }
        if (Object.keys(valid).length) return valid;
      }
    } catch (error) {
      console.warn("Could not load saved DOS files:", error);
    }
    return { ...DEFAULT_FILES };
  }

  function isValidFileName(name) {
    return /^[A-Z0-9_][A-Z0-9_.-]{0,30}$/i.test(name) && !/[. ]$/.test(name);
  }

  function persistFiles() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(files));
      return true;
    } catch (error) {
      appendOutput(`Unable to save files in this browser: ${error.message}`, "error");
      return false;
    }
  }

  function appendOutput(text, kind = "") {
    const line = document.createElement("div");
    line.className = `terminal-line ${kind}`.trim();
    line.textContent = text;
    output.append(line);
    output.scrollTop = output.scrollHeight;
  }

  function printPrompt(command) {
    const line = document.createElement("div");
    line.className = "terminal-line";
    const prompt = document.createElement("span");
    prompt.className = "line-prompt";
    prompt.textContent = `${currentDirectory}> `;
    line.append(prompt, document.createTextNode(command));
    output.append(line);
    output.scrollTop = output.scrollHeight;
  }

  function normalizePath(path) {
    let input = path.replaceAll("/", "\\").trim();
    let base;
    if (/^[A-Z]:\\/i.test(input)) {
      input = input.slice(3);
      base = [];
    } else {
      base = currentDirectory.slice(3).split("\\").filter(Boolean);
    }
    for (const part of input.split("\\")) {
      if (!part || part === ".") continue;
      if (part === "..") base.pop();
      else base.push(part);
    }
    return `C:\\${base.join("\\")}${base.length ? "\\" : ""}`;
  }

  function resolveFile(path) {
    const normalized = normalizePath(path);
    const name = normalized.slice(3).replace(/\\$/, "").toUpperCase();
    if (!name || name.includes("\\")) return null;
    return name;
  }

  function expandVariables(text, args = []) {
    return text.replace(/%%|%([^%]+)%|%(\d+|\*)/g, (match, key, positional) => {
      if (match === "%%") return "%";
      if (positional) {
        if (positional === "*") return args.join(" ");
        return args[Number(positional) - 1] ?? "";
      }
      if (/^\d+$/.test(key)) return args[Number(key) - 1] ?? "";
      return variables[key.toUpperCase()] ?? "";
    });
  }

  function tokenize(line) {
    const parts = [];
    const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let match;
    while ((match = pattern.exec(line)) !== null) parts.push(match[1] ?? match[2] ?? match[3]);
    return parts;
  }

  function executeCommand(rawLine, args = []) {
    let line = expandVariables(rawLine.trim(), args);
    if (!line || /^REM(?:\s|$)/i.test(line) || line.startsWith(":")) return;
    if (line.startsWith("@")) line = line.slice(1).trim();
    if (/^ECHO\.$/i.test(line)) line = "ECHO .";
    if (echoEnabled && !/^ECHO(?:\s|$)/i.test(line)) appendOutput(`${currentDirectory}> ${line}`);
    const tokens = tokenize(line);
    const command = (tokens.shift() || "").toUpperCase();
    const rest = line.replace(/^\S+\s*/, "");

    switch (command) {
      case "ECHO": {
        if (/^OFF$/i.test(rest)) { echoEnabled = false; return; }
        if (/^ON$/i.test(rest)) { echoEnabled = true; return; }
        appendOutput(rest === "." ? "" : rest.replace(/^"|"$/g, ""));
        break;
      }
      case "CLS":
      case "CLEAR":
        output.replaceChildren();
        break;
      case "HELP":
        appendOutput("Supported: DIR, CD, ECHO, TYPE, COPY, DEL, REN, MD, RD, SET, IF EXIST, GOTO, CALL, CLS, VER, HELP, EXIT");
        appendOutput("Files are virtual and stay in this browser. Commands never access your computer.");
        break;
      case "VER":
        appendOutput("FreeDOS Studio DOS-compatible browser interpreter v1.0");
        break;
      case "DIR": {
        appendOutput(` Directory of ${currentDirectory}`);
        const prefix = currentDirectory.slice(3).toUpperCase();
        const entries = Object.keys(files).filter(name => {
          if (!prefix) return !name.includes("\\");
          return name.startsWith(prefix) && !name.slice(prefix.length).includes("\\");
        });
        if (!entries.length) appendOutput("File not found");
        for (const name of entries) appendOutput(`${String(files[name].length).padStart(8)}  ${name.split("\\").pop()}`);
        appendOutput(`${entries.length} file(s)`);
        break;
      }
      case "CD":
      case "CHDIR": {
        if (!tokens.length) { appendOutput(currentDirectory); break; }
        const target = normalizePath(tokens[0]);
        if (directories.has(target.toUpperCase())) {
          currentDirectory = target;
          promptPath.textContent = `${currentDirectory}>`;
        } else appendOutput("The system cannot find the path specified.", "error");
        break;
      }
      case "MD":
      case "MKDIR": {
        if (!tokens.length) { appendOutput("Required parameter missing.", "error"); break; }
        const target = normalizePath(tokens[0]);
        directories.add(target.toUpperCase());
        break;
      }
      case "RD":
      case "RMDIR": {
        if (!tokens.length) { appendOutput("Required parameter missing.", "error"); break; }
        const target = normalizePath(tokens[0]).toUpperCase();
        if (target === "C:\\") { appendOutput("Cannot remove the root directory.", "error"); break; }
        if ([...directories].some(dir => dir.startsWith(target) && dir !== target) ||
            Object.keys(files).some(name => name.startsWith(target.slice(3)))) {
          appendOutput("Directory is not empty.", "error");
        } else if (!directories.delete(target)) appendOutput("The system cannot find the path specified.", "error");
        break;
      }
      case "TYPE": {
        const name = tokens[0] && resolveFile(tokens[0]);
        if (name && Object.hasOwn(files, name)) appendOutput(files[name]);
        else appendOutput("File not found.", "error");
        break;
      }
      case "COPY": {
        if (tokens.length < 2) { appendOutput("Syntax: COPY source destination", "error"); break; }
        const source = resolveFile(tokens[0]);
        const destination = resolveFile(tokens[1]);
        if (!source || !destination || !Object.hasOwn(files, source)) appendOutput("File not found.", "error");
        else {
          files[destination] = files[source];
          persistFiles();
          renderFiles();
          appendOutput("        1 file(s) copied.");
        }
        break;
      }
      case "DEL":
      case "ERASE": {
        const name = tokens[0] && resolveFile(tokens[0]);
        if (!name || !Object.hasOwn(files, name)) appendOutput("File not found.", "error");
        else {
          delete files[name];
          persistFiles();
          if (currentFile === name) currentFile = Object.keys(files)[0] || "";
          renderFiles();
          showCurrentFile();
          appendOutput("        1 file(s) deleted.");
        }
        break;
      }
      case "REN":
      case "RENAME": {
        if (tokens.length < 2) { appendOutput("Syntax: REN oldname newname", "error"); break; }
        const oldName = resolveFile(tokens[0]);
        const newName = resolveFile(tokens[1]);
        if (!oldName || !newName || !Object.hasOwn(files, oldName)) appendOutput("File not found.", "error");
        else if (Object.hasOwn(files, newName)) appendOutput("A file with that name already exists.", "error");
        else {
          files[newName] = files[oldName];
          delete files[oldName];
          if (currentFile === oldName) currentFile = newName;
          persistFiles();
          renderFiles();
          showCurrentFile();
        }
        break;
      }
      case "SET": {
        const assignment = rest.match(/^([^=]+)=(.*)$/);
        if (assignment) variables[assignment[1].trim().toUpperCase()] = assignment[2];
        else for (const [key, value] of Object.entries(variables)) appendOutput(`${key}=${value}`);
        break;
      }
      case "IF": {
        const match = rest.match(/^(NOT\s+)?EXIST\s+("[^"]+"|\S+)\s+(.+)$/i);
        if (!match) { appendOutput("Syntax: IF [NOT] EXIST filename command", "error"); break; }
        const operand = match[2].replace(/^"|"$/g, "");
        const exists = Boolean(resolveFile(operand) && Object.hasOwn(files, resolveFile(operand)));
        if (exists !== Boolean(match[1])) executeCommand(match[3], args);
        break;
      }
      case "GOTO":
      case "CALL":
        return { control: command, target: tokens[0] || "" };
      case "PAUSE":
        appendOutput("Press any key to continue . . .");
        break;
      case "EXIT":
        return { control: "EXIT" };
      case "DATE":
      case "TIME":
        appendOutput("This command is not available in the browser interpreter.", "error");
        break;
      default:
        appendOutput(`'${command}' is not recognized as an internal or external command.`, "error");
    }
  }

  async function runBatch(source, args = []) {
    if (batchRunning) return;
    batchRunning = true;
    echoEnabled = true;
    try {
      await runNestedBatch(source, args, 0);
    } finally {
      batchRunning = false;
    }
  }

  async function runNestedBatch(source, args, depth) {
    if (depth >= 8) { appendOutput("CALL nesting limit reached.", "error"); return; }
    const lines = source.replace(/\r\n?/g, "\n").split("\n");
    const labels = new Map();
    lines.forEach((line, index) => {
      const label = line.trim().match(/^:([^\s]+)/);
      if (label) labels.set(label[1].toUpperCase(), index);
    });
    let steps = 0;
    let i = 0;
    for (; i < lines.length && steps < MAX_BATCH_STEPS; i++, steps++) {
      const line = lines[i].trim();
      if (!line || line.startsWith(":")) continue;
      const result = executeCommand(line, args);
      if (result?.control === "EXIT") return "EXIT";
      if (result?.control === "GOTO") {
        if (result.target.toUpperCase() === "EOF") break;
        const labelIndex = labels.get(result.target.replace(/^:/, "").toUpperCase());
        if (labelIndex === undefined) { appendOutput(`Label not found: ${result.target}`, "error"); break; }
        i = labelIndex;
      } else if (result?.control === "CALL") {
        const callTokens = tokenize(line.replace(/^@?CALL\s+/i, ""));
        const calledFile = resolveFile(result.target);
        if (calledFile && Object.hasOwn(files, calledFile)) {
          const nestedResult = await runNestedBatch(files[calledFile], callTokens.slice(1), depth + 1);
          if (nestedResult === "EXIT") return "EXIT";
        } else appendOutput(`Cannot find batch file: ${result.target}`, "error");
      }
      if (steps % 100 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (steps >= MAX_BATCH_STEPS && i < lines.length) appendOutput("Batch stopped after the 1,000-command safety limit.", "error");
    return;
  }

  function renderFiles() {
    fileList.replaceChildren();
    const names = Object.keys(files).sort((a, b) => a.localeCompare(b));
    for (const name of names) {
      const row = document.createElement("div");
      row.className = `file-row${name === currentFile ? " selected" : ""}`;
      row.setAttribute("role", "button");
      row.tabIndex = 0;
      row.addEventListener("click", () => selectFile(name));
      row.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectFile(name);
        }
      });
      const icon = document.createElement("span");
      icon.className = "row-file-icon";
      icon.textContent = name.endsWith(".BAT") ? "▤" : "▧";
      const label = document.createElement("span");
      label.textContent = name;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "delete-file";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Delete ${name}`);
      remove.addEventListener("click", event => {
        event.stopPropagation();
        if (!window.confirm(`Delete ${name}?`)) return;
        delete files[name];
        if (currentFile === name) currentFile = Object.keys(files)[0] || "";
        persistFiles();
        renderFiles();
        showCurrentFile();
      });
      row.append(icon, label, remove);
      fileList.append(row);
    }
    fileCount.textContent = `${names.length} FILE${names.length === 1 ? "" : "S"}`;
  }

  function showCurrentFile() {
    editor.value = currentFile ? files[currentFile] : "";
    document.querySelector("#tab-name").textContent = currentFile || "NO FILE";
    document.querySelector("#file-path").textContent = currentFile ? `C:\\${currentFile}` : "C:\\";
    windowTitle.textContent = `${currentFile || "No file"} — FreeDOS Studio`;
    editorMode.textContent = currentFile && /\.(BAT|CMD)$/i.test(currentFile) ? "DOS BATCH" : "PLAIN TEXT";
    unsavedMarker.hidden = true;
    updateEditorMeta();
  }

  function selectFile(name) {
    saveCurrentFile();
    currentFile = name;
    showCurrentFile();
    renderFiles();
  }

  function saveCurrentFile() {
    if (!currentFile) return;
    files[currentFile] = editor.value;
    persistFiles();
    unsavedMarker.hidden = true;
    renderFiles();
  }

  function createFile() {
    const name = window.prompt("New file name (for example, HELLO.BAT):", "NEW.BAT");
    if (name === null) return;
    const normalized = name.trim().toUpperCase();
    if (!isValidFileName(normalized)) {
      window.alert("Use a simple filename with letters, numbers, dots, dashes, or underscores.");
      return;
    }
    if (Object.hasOwn(files, normalized)) {
      window.alert("A file with that name already exists.");
      return;
    }
    files[normalized] = "";
    persistFiles();
    currentFile = normalized;
    renderFiles();
    showCurrentFile();
    editor.focus();
  }

  async function importFile(file) {
    const name = file.name.trim().toUpperCase();
    if (!isValidFileName(name) || !/\.(BAT|CMD)$/i.test(name)) {
      window.alert("Choose a .BAT or .CMD file with a simple filename.");
      return;
    }
    if (file.size > 512 * 1024) {
      window.alert("Batch files must be smaller than 512 KB.");
      return;
    }
    if (Object.hasOwn(files, name) && !window.confirm(`Replace ${name}?`)) return;
    saveCurrentFile();
    files[name] = await file.text();
    currentFile = name;
    persistFiles();
    renderFiles();
    showCurrentFile();
  }

  async function runInFreeDos() {
    saveCurrentFile();
    if (!currentFile) {
      appendOutput("Create or import a batch file first.", "error");
      return;
    }
    if (!/\.BAT$/i.test(currentFile)) {
      appendOutput("FreeDOS runs .BAT files. Select or import a .BAT file first.", "error");
      return;
    }

    prepareEmulatorScreen("FREEDOS EMULATOR");
    dosStatus.textContent = "Loading the FreeDOS emulator. The first launch may take a moment.";
    dosDialog.showModal();
    try {
      await window.FreeDosRunner.run(files[currentFile], dosScreen, status => {
        dosStatus.textContent = status;
      });
    } catch (error) {
      console.error("Could not start FreeDOS:", error);
      dosStatus.textContent = `Unable to start FreeDOS: ${error.message}`;
    }
  }

  function prepareEmulatorScreen(title) {
    document.querySelector("#dos-dialog-title").textContent = title;
    emulatorOptions.hidden = true;
    dosScreen.hidden = false;
    dosScreen.querySelector("div").textContent = "";
    dosScreen.querySelector("canvas").hidden = true;
  }

  function openEmulatorSection() {
    document.querySelector("#dos-dialog-title").textContent = "EMULATOR SECTION";
    emulatorOptions.hidden = false;
    dosScreen.hidden = true;
    updateEmulatorImageName();
    dosStatus.textContent = "Ready.";
    if (!dosDialog.open) dosDialog.showModal();
  }

  function updateEmulatorImageName() {
    emulatorImageName.textContent = `assets/${BOOT_IMAGES[emulatorOsInput.value].file}`;
  }

  async function loadBootImage(imageFileName) {
    const response = await fetch(`./assets/${imageFileName}`);
    if (!response.ok) {
      throw new Error(`Could not load assets/${imageFileName}. Add the bootable image to the assets folder and try again.`);
    }
    const image = await response.arrayBuffer();
    if (!image.byteLength) throw new Error(`assets/${imageFileName} is empty.`);
    if (image.byteLength > 256 * 1024 * 1024) {
      throw new Error(`assets/${imageFileName} must be 256 MB or smaller.`);
    }
    return image;
  }

  async function runInMsDos() {
    saveCurrentFile();
    if (!currentFile || !/\.BAT$/i.test(currentFile)) {
      appendOutput("MS-DOS runs .BAT files. Select or import a .BAT file first.", "error");
      return;
    }

    prepareEmulatorScreen("MS-DOS BATCH RUNNER");
    dosStatus.textContent = "Loading assets/MS-DOS.img...";
    if (!dosDialog.open) dosDialog.showModal();
    try {
      const image = await loadBootImage(BOOT_IMAGES.msdos.file);
      if (image.byteLength < 160 * 1024 || image.byteLength > 2.88 * 1024 * 1024 || image.byteLength % 512 !== 0) {
        throw new Error("assets/MS-DOS.img must be a bootable floppy image between 160 KB and 2.88 MB.");
      }
      if (!dosDialog.open) return;
      await window.FreeDosRunner.runMsDos(files[currentFile], image, dosScreen, status => {
        dosStatus.textContent = status;
      });
    } catch (error) {
      console.error("Could not start MS-DOS:", error);
      dosStatus.textContent = `Unable to start MS-DOS: ${error.message}`;
    }
  }

  async function startSelectedEmulator() {
    const bootImage = BOOT_IMAGES[emulatorOsInput.value];
    if (!bootImage) {
      dosStatus.textContent = "Choose a supported operating system.";
      return;
    }
    const { file, drive, name: osName, memorySize } = bootImage;
    prepareEmulatorScreen(`${osName.toUpperCase()} EMULATOR`);
    dosStatus.textContent = `Loading assets/${file}...`;

    if (typeof dosScreen.requestFullscreen !== "function") {
      dosStatus.textContent = "Fullscreen is unavailable in this browser. The emulator was not started.";
      return;
    }
    try {
      await dosScreen.requestFullscreen();
    } catch (error) {
      console.warn("Could not enter fullscreen mode:", error);
      dosStatus.textContent = `Could not enter fullscreen mode: ${error.message}`;
      return;
    }

    try {
      const image = await loadBootImage(file);
      if (!dosDialog.open) return;
      await window.FreeDosRunner.runImage(image, drive, dosScreen, status => {
        dosStatus.textContent = status;
      }, osName, memorySize);
    } catch (error) {
      console.error(`Could not start ${osName}:`, error);
      dosStatus.textContent = `Unable to start ${osName}: ${error.message}`;
    }
  }

  async function closeFreeDos() {
    await window.FreeDosRunner.stop();
    if (document.fullscreenElement && document.exitFullscreen) {
      try {
        await document.exitFullscreen();
      } catch (error) {
        console.warn("Could not exit fullscreen mode:", error);
      }
    }
    if (dosDialog.open) dosDialog.close();
  }

  function updateEditorMeta() {
    const start = editor.selectionStart;
    const before = editor.value.slice(0, start);
    const rows = before.split("\n");
    cursorPosition.textContent = `Ln ${rows.length}, Col ${rows[rows.length - 1].length + 1}`;
    lineNumbers.textContent = Array.from({ length: Math.max(editor.value.split("\n").length, 1) }, (_, index) => index + 1).join("\n");
    lineNumbers.scrollTop = editor.scrollTop;
  }

  function submitCommand(command) {
    const text = command.trim();
    if (!text) return;
    printPrompt(text);
    commandHistory.push(text);
    historyIndex = commandHistory.length;
    executeCommand(text);
    renderFiles();
  }

  document.querySelector("#new-file").addEventListener("click", createFile);
  document.querySelector("#new-file-small").addEventListener("click", createFile);
  explorerToggle.addEventListener("click", () => {
    const isOpen = workspace.classList.toggle("explorer-collapsed") === false;
    explorerToggle.classList.toggle("active", isOpen);
    explorerToggle.setAttribute("aria-pressed", String(isOpen));
  });
  document.querySelector("#import-file").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    try {
      await importFile(file);
    } catch (error) {
      console.error("Could not import batch file:", error);
      window.alert(`Unable to import file: ${error.message}`);
    }
  });
  document.querySelector("#save-file").addEventListener("click", saveCurrentFile);
  document.querySelector("#run-file").addEventListener("click", async () => {
    saveCurrentFile();
    if (!currentFile) { appendOutput("Create or select a batch file first.", "error"); return; }
    if (!/\.(BAT|CMD)$/i.test(currentFile)) { appendOutput("Select a .BAT or .CMD file to run.", "error"); return; }
    printPrompt(`CALL ${currentFile}`);
    await runBatch(files[currentFile]);
    renderFiles();
  });
  document.querySelector("#run-freedos").addEventListener("click", runInFreeDos);
  document.querySelector("#run-msdos").addEventListener("click", () => {
    runInMsDos();
  });
  document.querySelector("#open-emulators").addEventListener("click", openEmulatorSection);
  emulatorOsInput.addEventListener("change", updateEmulatorImageName);
  updateEmulatorImageName();
  document.querySelector("#start-emulator").addEventListener("click", startSelectedEmulator);
  document.querySelector("#close-dos").addEventListener("click", closeFreeDos);
  dosDialog.addEventListener("cancel", event => {
    event.preventDefault();
    closeFreeDos();
  });
  dosDialog.addEventListener("close", () => window.FreeDosRunner.stop());
  document.querySelector("#download-file").addEventListener("click", () => {
    if (!currentFile) { appendOutput("Create or select a file to export.", "error"); return; }
    saveCurrentFile();
    const blob = new Blob([editor.value], { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = currentFile;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
  });
  document.querySelector("#clear-terminal").addEventListener("click", () => output.replaceChildren());
  document.querySelector("#command-form").addEventListener("submit", event => {
    event.preventDefault();
    submitCommand(commandInput.value);
    commandInput.value = "";
  });
  editor.addEventListener("input", () => {
    unsavedMarker.hidden = false;
    updateEditorMeta();
  });
  editor.addEventListener("click", updateEditorMeta);
  editor.addEventListener("keyup", updateEditorMeta);
  editor.addEventListener("scroll", () => { lineNumbers.scrollTop = editor.scrollTop; });
  editor.addEventListener("keydown", event => {
    if (event.key === "Tab") {
      event.preventDefault();
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      editor.setRangeText("    ", start, end, "end");
      editor.dispatchEvent(new Event("input"));
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) document.querySelector("#run-file").click();
  });
  commandInput.addEventListener("keydown", event => {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (historyIndex > 0) commandInput.value = commandHistory[--historyIndex];
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      if (historyIndex < commandHistory.length - 1) commandInput.value = commandHistory[++historyIndex];
      else { historyIndex = commandHistory.length; commandInput.value = ""; }
    }
  });

  renderFiles();
  showCurrentFile();
})();
