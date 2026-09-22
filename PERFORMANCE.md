# Performance

Numbers from `benchmark/real-grf-profile.mjs` on a real archive: the `data.grf` of a bRO client,
3.27 GiB, 205,404 files, names in CP949. Each build runs in a process of its own, after a warm-up pass
so neither one pays for the other's reads from disk.

```bash
yarn build
yarn bench path/to/data.grf node_modules/@chicowall/grf-loader/dist/index.cjs
```

| | 1.1.3 | 1.2.0 |
|---|---:|---:|
| `load()` | 1,558 ms | **426 ms** |
| heap held by the loaded archive | 218 MiB | **77 MiB** |
| `getFile()` x 2,000 files spread over the archive (151 MiB uncompressed) | 1,629 ms | **598 ms** |
| `getFile()` of the largest file (20 MiB) | 211 ms | **53 ms** |
| …and the longest the event loop was blocked while it ran | 209 ms | **12 ms** |
| first `getStats()` (builds the lookup indexes) | 0 ms | 415 ms |

Reading all 205,404 files with both builds gives the same bytes for 205,399 of them (13.47 GiB). The
five that differ are stored entries whose DES alignment padding 1.1.3 returned as part of the file.

## Where it comes from

**`load()`** — the file table is decompressed, then a name and 17 bytes are read per entry.

- Names were decoded one iconv-lite call at a time. They are now copied, NUL-separated, into one buffer
  and decoded in a single call, then split on NUL: no byte of a CP949 or UTF-8 character is 0.
- `rawNameBytes` are views into that buffer instead of one copy per name, which is most of the drop in
  memory.
- The normalized-path and extension indexes are built the first time something needs them
  (`resolvePath` with a name that is not exact, `find`, `getFilesByExtension`, `listExtensions`,
  `getStats`). That is the 415 ms above, and a caller that asks for exact names never pays it.

**`getFile()`** — `GrfNode` inflates with Node's own zlib instead of pako. Entries up to 64 KiB of
output inflate on the main thread, where that costs less than a trip to the thread pool; larger ones
inflate in the pool, which is why reading a 20 MiB map no longer blocks the event loop for a fifth of a
second. zlib gets one output chunk of the size the entry says it has, instead of its default 16 KiB
chunks, each of which costs a copy and, in the pool, a round trip.

`GrfBrowser` still uses pako: browsers have no zlib.

**Memory** — `getFile` keeps decoded files in a cache that had no byte limit, only a count of 50, so 50
maps of 20 MiB could sit in it. `cacheMaxBytes` (64 MiB) now bounds it and `cacheMaxFiles: 0` turns it
off for a caller that caches on its own.

## What was measured before

Earlier versions of this file reported gains measured on `data/with-files.grf`: 655 bytes, 7 entries.
At that size the numbers say more about the overhead of a promise than about the loader -- among them a
"1.46x" for a buffer pool that, on a real archive, handed out buffers nothing ever gave back.
