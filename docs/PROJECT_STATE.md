### Verification

```
$ cd nexus/frontend && npm run typecheck                               # exit 0
$ cd nexus/frontend && npm run build                                   # 10 routes, 84.5 kB shared
$ cd nexus/backend  && python3 -m pytest -q                            # 132 passed
$ node node_modules/tailwindcss/lib/cli.js -c tailwind.config.js \
      -i src/app/globals.css -o <tmp>                                  # 25.7 KB built
```

`npm run build` now runs to completion on this ARM64 device (ADR-017 supersedes the
ADR-013 caveat): the scripts preload the WASM SWC bindings and run the Next workers as
threads. Build output:

```
Route (app)                              Size     First Load JS
┌ ○ /                                    1.95 kB        98.5 kB
├ ○ /_not-found                          885 B          85.3 kB
├ ○ /capture                             1.5 kB           98 kB
├ ○ /collections                         2.64 kB        99.2 kB
├ λ /items/[id]                          6.96 kB         103 kB
├ ○ /library                             2.83 kB        99.4 kB
├ ○ /search                              2.45 kB          99 kB
├ ○ /settings                            3.1 kB         99.6 kB
└ ○ /studio                              3.38 kB        99.9 kB
```
