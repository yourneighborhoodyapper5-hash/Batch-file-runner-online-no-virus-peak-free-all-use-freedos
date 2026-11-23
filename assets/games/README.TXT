GAME LIBRARY

Open Emulator section in FreeDOS Studio, then choose Open Game Library.
The standalone game menu uses a dark console-style layout. Selecting a tile
opens the game in a new tab and fills the page. Use its Fullscreen button to
hide browser controls; browsers require that separate click for fullscreen.

Add one folder per game under assets/games, then list each folder name in
manifest.json. Folder names must be unique and use 1-8 letters, numbers,
underscores, or hyphens. Each folder needs a game.json file.
You can also put a .gb, .gbc, .nes, .n64, .z64, or .v64 file directly in
assets/games and add its filename to manifest.json; its title is taken from
the filename.

HTML game:
  {"id":"mygame","title":"My Game","description":"A short description.",
   "system":"html","entry":"index.html"}
Put the game's HTML and supporting files in its folder. The game runs in a
sandboxed frame.

Game Boy, Game Boy Color, NES, or Nintendo 64:
  {"id":"mygame","title":"My Game","description":"A short description.",
   "system":"gb","rom":"game.gb"}
Use system "gb", "gbc", "nes", or "n64" and a matching ROM file. Nintendo 64
supports .n64, .z64, and .v64 ROMs.
Game Boy and Game Boy Color run locally with the bundled Binjgb emulator and
do not need an internet connection. Its MIT licenses are in assets/binjgb.
Controls: arrows, Z (B), X (A), Enter (Start), and Tab (Select). Battery saves
are kept in this browser.
NES and Nintendo 64 games use EmulatorJS and need an internet connection.

DOS game:
  {"id":"dosgame","title":"My DOS Game","description":"A short description.",
   "system":"dos","launch":"GAME.EXE","files":["GAME.EXE","DATA.DAT"]}
List every required game file in files. DOS paths and names must use 8.3
format. The game launches in the bundled FreeDOS virtual machine, with its
files available under C:\APPS\GAMES\<ID>.

All paths are relative to the game's folder. Do not include copyrighted
game files unless you have permission to use them.

