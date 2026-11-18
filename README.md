# Context Store demo

You can open the demo at https://pavelslaninka.github.io/context-store-demo/. It runs entirely in your browser. Nothing is installed, and nothing is sent anywhere.

## The idea

A user keeps one small store of what AI assistants know about them.
- Assistants from different companies read the store.
- Assistants can only propose changes, and the user accepts or rejects each one in the store's own screen, outside the chat.
- Every entry records who proposed it, and whether the user said it or an assistant inferred it.
- Fixed checks hold back or block proposals that look like memory poisoning.

This is a student project for the Digital Innovation course at the University of Antwerp (November 2026).

![Proposals screen: a poisoned proposal is held back](docs/screens/3c-proposal-held-back_1920x1080.png)

## Using the demo

- The demo has six screens. They show your context, the connected assistants, the proposals, "same you, different assistant", connecting a new assistant, and the history with undo.
- The right arrow key or PageDown goes to the next screen, and the left arrow key or PageUp goes back. 1–6 jump to a screen, Home returns to the start, and a presentation clicker works too.
- "Reset demo" in the footer starts the story again. You need it because the app remembers its state between reloads.
- Sofie and Assistants A to D are made up. The chat answers on screen 4 are filled in from the store, and no AI writes them. The attack texts use only the reserved example domains `shop.example` and `mailbox.example`.

## The small real part

`server/` holds a minimal [MCP](https://modelcontextprotocol.io) server in Python (official `mcp` SDK) with two tools.
- `context_get` reads entries by scope.
- `context_propose` files a proposal and runs the same checks as the app.

No tool can accept a proposal. The user reviews proposals with the command-line tool `server/ctx_review.py`.

```bash
uv sync
```
```bash
.venv/bin/python -I server/ctx_server.py --connector assistant-a
```
```bash
.venv/bin/python -I -m unittest discover -s tests
```

The rule checks are the same in Python and JavaScript, and `tests/firewall_cases.json` holds their shared test cases. Code comments mention "T3", which is the project's internal design note on defences against memory poisoning.
