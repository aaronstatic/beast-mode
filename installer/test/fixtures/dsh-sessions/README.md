# The dsh session fixture

This tree stands in for the home directory of dsh, the DeepSeek Harness. A
test sets `DSH_HOME` to this directory, so `installer/readers/dsh.js` reads
`sessions/` here and it reads no real log of the host.

Every test names the project root `/tmp/bm-dsh/project`. That path exists on
no host. The reader encodes the path into the directory name
`--tmp-bm-dsh-project--`, and it compares that name with each directory of
`sessions/`.

## The tree

```
sessions/
  --tmp-bm-dsh-project--/
    session-parent-one/  session.v2.jsonl        the older generation, the reader ignores it
                         session.v3.jsonl.zstd   the winner, compressed, holds one bad line
                         session.lock            not a log name, the reader ignores it
    sub-one/             session.jsonl           plain, generation 0, parentSession as an object
    sub-two/             session.v3.jsonl.zstd   compressed, parentSession as a string
    session-empty/       session.v3.jsonl.zstd   a header and no step, so no session
    session-foreign/     session.jsonl           a header cwd of another path, so no session
  --tmp-bm-dsh-other--/
    session-other/       session.jsonl           another project, the reader returns it never
```

## The numbers

| Session | kind | parent | model | steps | prompt | final | cached | output | created |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `parent-one` | parent | null | `glm-5.3` | 3 | 6600 | 3300 | 6000 | 120 | `2025-09-18T00:00:00.000Z` |
| `sub-one` | subagent | `parent-one` | `qwen3.8-flash` | 2 | 1210 | 660 | 1100 | 30 | `2025-09-18T00:01:00.000Z` |
| `sub-two` | subagent | `parent-one` | `glm-5.3` | 1 | 770 | 770 | 700 | 15 | `2025-09-18T00:02:00.000Z` |

The totals read `sessions=3`, `steps=6`, `promptTokens=8580`, `outputTokens=165`,
and `subagentShare=0.2308`. Each session reports `cacheShare` 0.9091. The read
returns one note, and that note states one skipped line. A window of one day
returns no session. A window of 100000 days returns all three.

`costUsd` stays null for every session, because a dsh log carries no cost.

## What each log proves

- `session-parent-one/session.v3.jsonl.zstd` wins over `session.v2.jsonl`,
  because generation 3 is higher than generation 2. The older log holds the
  model `wrong-pick` and the numbers 999, 9990, and 99, so a wrong pick
  changes the answer.
- `session.lock` matches no log name, so the pick ignores it.
- The body of `parent-one` holds one line that is not JSON. It stands for a
  torn write. The reader counts it and it raises nothing.
- The three steps of `parent-one` name `glm-5.3` two times and
  `qwen3.8-flash` one time, so the model of most steps is `glm-5.3`.
- The two steps of `sub-one` name `qwen3.8-flash` and then `glm-5.3`. The
  count ties, and the earliest step wins, so the model is `qwen3.8-flash`.
- `sub-one` carries `parentSession` as an object, and `sub-two` carries it as
  a string. The reader reads both shapes.
- Each header carries `cwd`, so the second guard of the match rule runs on
  every session of the fixture.
- `session-empty` holds a header and no `assistant/message` event, so it
  gives no session.
- `session-foreign` sits inside the matched directory, because the two paths
  `/tmp/bm-dsh-project` and `/tmp/bm-dsh/project` give the one key
  `--tmp-bm-dsh-project--`. The header names `/tmp/bm-dsh-project`, so the
  working directory guard of the match rule drops the session. The log is
  plain, so a host with no zstd decoder reads it too. It carries the model
  `foreign-model` and 8000 cache read tokens, and no number of that log
  reaches an answer of `/tmp/bm-dsh/project`.
- `--tmp-bm-dsh-other--/session-other` carries 9000 tokens of each kind. No
  number of that log reaches an answer of `/tmp/bm-dsh/project`.

## The compressed logs

Each `.zstd` file holds two zstd frames: one frame for the header line, and
one frame for the body lines. A real log of dsh holds one frame for each group
of events, and a log of one hour reaches over one thousand frames.
`zlib.zstdDecompressSync` stops at the end of the first frame, so the reader
walks the frame headers and it decodes one frame at a time. The two frames of
this fixture prove that walk.

### `--tmp-bm-dsh-project--/session-parent-one/session.v3.jsonl.zstd`

`parent-one.header.jsonl`, the first frame:

```json
{"type":"session","version":3,"id":"session-parent-one","createdAt":1758153600000,"cwd":"/tmp/bm-dsh/project","isSeeded":false,"origin":"user","delegationDepth":0,"agentPreset":"standard"}
```

`parent-one.body.jsonl`, the second frame. Line 6 is the bad line:

```json
{"type":"turn/start","data":{"turn":1}}
{"type":"request/context","data":{"contextWindow":200000}}
{"type":"assistant/message","data":{"turn":1,"step":1,"message":{"source":{"model":"glm-5.3"},"content":[{"type":"text","text":"the first step"}]},"usage":{"inputTokens":100,"cacheReadTokens":1000,"outputTokens":20,"totalTokens":1120}}}
{"type":"assistant/message","data":{"turn":1,"step":2,"message":{"source":{"model":"glm-5.3"},"content":[{"type":"tool-call","id":"call-1","name":"read_file"}]},"usage":{"inputTokens":200,"cacheReadTokens":2000,"outputTokens":40,"totalTokens":2240}}}
{"type":"tool/result","data":{"message":{"source":{"callId":"call-1"},"content":[{"type":"text","text":"the content of the file"}]}}}
{"type":"assistant/message","data":{"turn":1,"step":3,"message":
{"type":"assistant/message","data":{"turn":1,"step":3,"message":{"source":{"model":"qwen3.8-flash"},"content":[{"type":"text","text":"the last step"}]},"usage":{"inputTokens":300,"cacheReadTokens":3000,"outputTokens":60,"totalTokens":3360}}}
```

### `--tmp-bm-dsh-project--/sub-two/session.v3.jsonl.zstd`

`sub-two.header.jsonl`, the first frame:

```json
{"type":"session","version":3,"id":"sub-two","createdAt":1758153720000,"cwd":"/tmp/bm-dsh/project","parentSession":"session-parent-one","isSeeded":false,"origin":"subagent","delegationDepth":1,"agentPreset":"standard"}
```

`sub-two.body.jsonl`, the second frame:

```json
{"type":"turn/start","data":{"turn":1}}
{"type":"assistant/message","data":{"turn":1,"step":1,"message":{"source":{"model":"glm-5.3"},"content":[{"type":"text","text":"the only step of the second subagent"}]},"usage":{"inputTokens":70,"cacheReadTokens":700,"outputTokens":15,"totalTokens":785}}}
```

### `--tmp-bm-dsh-project--/session-empty/session.v3.jsonl.zstd`

`empty.header.jsonl`, the first frame:

```json
{"type":"session","version":3,"id":"session-empty","createdAt":1758153780000,"cwd":"/tmp/bm-dsh/project","isSeeded":false,"origin":"user","delegationDepth":0,"agentPreset":"standard"}
```

`empty.body.jsonl`, the second frame:

```json
{"type":"turn/start","data":{"turn":1}}
{"type":"user/message","data":{"message":{"content":[{"type":"text","text":"the user writes and the session stops"}]}}}
```

## The rebuild command

Write the plaintext of the section above into a temporary directory. Give each
file the name of its heading, for example `parent-one.header.jsonl`. End each
file with one line separator. Then run the command below for each of the three
logs.

```bash
zstd -f header.jsonl -o h.zst && zstd -f body.jsonl -o b.zst && cat h.zst b.zst > session.v3.jsonl.zstd
```

Move `session.v3.jsonl.zstd` to its session directory of the tree. Delete
`header.jsonl`, `body.jsonl`, `h.zst`, and `b.zst`. The tree holds the three
`.zstd` files and the five plain files only.

The three `.zstd` files are committed binary files. A rebuild with another
version of zstd gives other bytes, and it gives the same answer.
