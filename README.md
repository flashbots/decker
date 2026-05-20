> [!WARNING]
> New tool - work in progress!

# decker

_Deck your own devnet_

Decker lets you kickstart and vibecode any dev setup with complete freedom — powered by Deno, TypeScript and agent-first patterns

- **Containers:** k8s-like blueprints
- **Recipes:** compose containers into pods
- **CLI:** build and run any recipe you want
- **Manifests:** work directly on prebuilt recipes
- **Orchestration:** podman and k8s (and more)
- **Observability:** any community tool

Rapidly vibehack your own containers and recipes, manipulate commands, plug in any tool you want! ⚡

Ethereum L1/L2 devnet creation is the main focus area but you can use it for anything.

## Quickstart

Install Deno and podman first (remember to extend the PATH variable to support `deno install` outputs).

Install builder-playground (currently used for artifact generation).

Clone this repo and run
```sh
just install
```
or
```sh
deno install -gAf -n decker cli.ts
```

Start the L1 recipe:
```sh
decker start l1
```

and bam! You have a working devnet.

```
✓ artifacts generated (l1, 740ms)
✓ rendered l1 (15ms)
✓ started 5 pods (3.2s)

  el-1
    rpc        8545
    authrpc    8551
    metrics    9090

  beacon-1
    http       3500
    p2p-tcp    9000
    p2p-udp    9000
    quic       9100

  validator-1  (no ports)

  mev-boost-relay-1
    http       5555

  Dozzle  http://localhost:18080

  ─ Ctrl+C to stop ─
```

Next up, try the rbuilder recipe and ask your agent to add new nodes! 🤖

**TBD:** Standalone `decker.ts` file for projects!

## Background

Sophisticated tools and their abstraction layers speed up humans but slow down LLM problem solving and reduce success. And developers often try to fix tools to satisfy their own use-case specific necessities.

We eliminate this friction by inverting the approach:

- Simple building blocks and scalable patterns for LLM agents and humans

- Relying on LLM training data instead of heavy custom logic and abstractions

- Putting users in control of features instead of restricting to a limited selection

- Leveraging readily available community tools 

## Roadmap

- [ ] Installation script
- [ ] More recipes (e.g. opstack)
- [ ] Observability tools
- [ ] Support host binaries
- [ ] Custom configuration steps
- [ ] Standalone decker.ts file for projects
- [ ] Feature documentation
- [ ] Experiment/alternatives documentation
