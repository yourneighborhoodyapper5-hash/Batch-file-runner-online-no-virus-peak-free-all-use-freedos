Place DOS applications, scripts, and other files in this folder. Nested folders are included.

When the emulator boots from a floppy disk, the files are available at C:\APPS.
In Windows 95, they are available at D:\APPS.

Files are copied into a DOS FAT16 disk each time the emulator starts. Names are
converted to DOS 8.3 format, for example MYPROGRAM.EXE or START.BAT.
The web server must allow directory listings; the included Python server does.
