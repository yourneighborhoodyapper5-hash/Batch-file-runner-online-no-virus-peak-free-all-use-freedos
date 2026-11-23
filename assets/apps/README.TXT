Place DOS applications, scripts, and other files in this folder, then add each
relative file path to manifest.json. Nested paths use forward slashes.

When the emulator boots from a floppy disk, the files are available at C:\APPS.
In Windows 95, they are available at D:\APPS.

Files are copied into a DOS FAT16 disk each time the emulator starts. Names are
converted to DOS 8.3 format, for example MYPROGRAM.EXE or START.BAT.

Run these at the FreeDOS emulator prompt (not the browser's "Run in prompt"):
  C:\APPS\HELLO
  C:\APPS\SELFTEST
