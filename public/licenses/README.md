# HEIC photo conversion

SnoiCafe uses the unmodified **heic-to 1.5.2** library, copyright Hopper Gee,
under LGPL-3.0-or-later. Its browser bundle includes libheif and libde265.
This decoder is loaded only when native HEIC decoding is unavailable.

- Library source and build instructions: https://github.com/hoppergee/heic-to
- Exact published package and included sources: https://registry.npmjs.org/heic-to/-/heic-to-1.5.2.tgz
- libheif source: https://github.com/strukturag/libheif
- libde265 source: https://github.com/strukturag/libde265
- LGPL license: [heic-to.txt](heic-to.txt)
- GPL license incorporated by LGPL: [GPL-3.0.txt](GPL-3.0.txt)

SnoiCafe's source and build instructions are available at
https://github.com/snoidetx/SnoiCafe. To use a modified, interface-compatible
decoder, replace the dependency and run `pnpm build` as described in the main
README. The application's own code remains under its existing license.
