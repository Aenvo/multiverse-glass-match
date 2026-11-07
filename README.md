# Multiverse Glass Match

English · [简体中文](README.zh.md)

A non-commercial browser match-3 game rendered with WebGL2. Explore imagined multiverse planets in **Otherworld Mode**, or turn on **Planet Mode** to play with familiar worlds. Matched worlds fuse inside connected liquid glass as a black hole forms and absorbs them.

[Play in your browser](https://aenvo.github.io/multiverse-glass-match/) · [Credits and asset sources](CREDITS.md) · [Licensing](LICENSE.md)

## Play

Use a browser with WebGL2 enabled and a mouse.

- Drag a world with the left mouse button to swap it with an adjacent cell. A horizontal or vertical match of at least three triggers fusion, clearing, falling pieces and cascades.
- Leave the planet switch off for **Otherworld Mode**. Its 34 appearances include 33 animated Orbkit shaders and Azure world, a procedurally generated fantasy planet.
- Turn on **Planet Mode** for Earth, the Moon, Mercury, Venus, Mars and Jupiter. Each game uses four selected appearances.
- Open the book button to browse the current mode's gallery and GLSL sources. Use the gear button to select four worlds, then choose **Apply**.
- Use the refresh button to randomize the current mode's four worlds and restart the board.
- Use the theme switch for light or dark glass. Appearance and theme choices are saved in the current tab's session storage.

Switching modes preserves the board's current arrangement. A switch requested during a drag or animation takes effect when the board settles. Otherworld black-hole halos sample colors from the actual world shaders. Familiar planets use a warm black-hole palette. The connected glass contains the fusion and black-hole effects.

## Run locally

Python 3 and a WebGL2 browser are required. Serve the repository through HTTP.

```sh
git clone https://github.com/Aenvo/multiverse-glass-match.git
cd multiverse-glass-match
```

### Windows

Double-click [start.cmd](start.cmd), or run it from the repository directory.

```cmd
start.cmd
```

The launcher locates Python through `py -3`, `python` or `python3`. Open the address printed in its terminal. Press `Ctrl+C` there to stop the server.

### Other environments

Run this command from the repository root, then open the address printed by Python.

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

With Node.js and npm available, `npm start` runs the same Python command.

## Development

The frontend uses native JavaScript modules, CSS and GLSL. Files load directly from a static server. Planet materials are implemented in [src/planet-shaders.js](src/planet-shaders.js), using licensed surface textures and shader-generated procedural noise.

Run the existing Node.js test suite from the repository root.

```sh
npm test
```

Tests cover board generation, legal swaps, connected match groups, falling and cascades, reshuffling, drag inertia, appearance restoration and black-hole geometry.

GitHub Pages serves the static project from the root of `main`. Resource URLs resolve relative to their modules or the page, including under the repository's Pages subpath.

## Credits and non-commercial use

This is a non-commercial creative and educational project. Third-party code, shaders and assets remain subject to their respective licenses and attribution requirements.

- **XorDev** authored the shaders behind 19 Orbkit appearances. Their terms require non-commercial use, attribution and retained notices.
- **zzzzshawn** created Orbkit's runtime and 14 original appearances under MIT.
- **Solar System Scope / INOVE** provides the Moon, Mercury, Venus, Mars and Jupiter textures under the CC BY 4.0 license. Earth textures are credited to **NASA Visible Earth / Blue Marble**, subject to NASA's media guidelines.
- Glass rendering references, the liquid-glass switch and black-hole lighting references retain their respective MIT notices.

The [credits](CREDITS.md) map authors and fixed upstream versions to local files and explain the adaptations. The [license overview](LICENSE.md) describes project-specific permission and the individual third-party terms.
